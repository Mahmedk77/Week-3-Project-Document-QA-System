import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { embeddings, queryModel, supabaseAdmin } from "@/lib/models";
import { listDocumentFilenames } from "@/lib/corpus";
import { bareReferenceKind, looksContextDependent, resolveFollowUp } from "@/lib/follow-up";
import type { ChatTurn } from "@/lib/documents";

export const runtime = "nodejs";

const MAX_QUESTION_LENGTH = 2000;

/** Turns of transcript accepted from the client, newest kept. */
const MAX_HISTORY_TURNS = 6;

/** Per-turn cap, so a long earlier answer can't crowd out the retrieved context. */
const MAX_HISTORY_TURN_LENGTH = 1200;

/**
 * Chunks handed to the model.
 *
 * Was 5, which was too tight once real users started asking short questions
 * about long documents: for "name of the main character in White Nights" the
 * top 5 were all thematic matches on the title and opening pages, and the one
 * chunk that actually introduces her by name ("My name is Nastenka", p18)
 * never made the cut. Recall matters more than precision here — the model is
 * now expected to judge which of the entries are relevant, and gpt-4o-mini
 * reads a dozen 800-char chunks without trouble.
 */
const MATCH_COUNT = 12;

/**
 * Candidates pulled from the RPC before the per-document quota below picks the
 * final MATCH_COUNT. Wider than what the model sees so a large document can't
 * crowd a small one out of the running before the quota gets a chance to run:
 * "summarize the main idea" returned 12 Dalio chunks and zero from White
 * Nights, purely because that book is 908 chunks against ~90.
 */
const CANDIDATE_COUNT = 30;

/**
 * Slots reserved per document that has any surviving candidate, so every
 * document in the library gets a voice on a question that names none of them.
 * Remaining slots are filled by global rank, so a question that really is about
 * one document still gets mostly that document.
 */
const PER_DOCUMENT_FLOOR = 2;

/**
 * Absolute noise floor on raw cosine similarity.
 *
 * Chunks below this are unrelated to the question, not merely weak, and get
 * dropped so the model isn't asked to reason about noise. `rrf_score` can't be
 * used for this (see the comment on hybrid_search_documents in
 * supabase/schema.sql), so it gates on raw cosine similarity instead.
 *
 * Lowered from 0.35, which was calibrated against a single nonfiction corpus
 * (Ray Dalio, 908 chunks) and did not transfer: on literary prose the whole
 * similarity distribution sits lower, and "who is dostoevsky?" lost four of its
 * five retrieved chunks to scores of 0.337–0.347 — i.e. by three thousandths.
 * See HANDOFF.md.
 */
export const MIN_SIMILARITY = 0.25;

/**
 * Relative floor: chunks more than this far below the best hit are dropped.
 *
 * Absolute thresholds don't transfer between corpora, but the *shape* of a
 * result set does — a chunk far behind the leader is filler regardless of the
 * genre being searched. Applied alongside MIN_SIMILARITY, whichever is higher.
 */
const RELATIVE_WINDOW = 0.12;

const responseSchema = z.object({
  answer: z.string(),
  /**
   * Where the answer came from. Drives how the UI frames it — a general-
   * knowledge answer is shown with a badge saying it isn't from the user's
   * documents, rather than as a failure.
   */
  answerSource: z.enum(["documents", "general_knowledge", "none"]),
  // "clarification" is produced by the route itself, never by this model — the
  // follow-up resolver decides it before retrieval has happened.
  citations: z.array(
    z.object({
      filename: z.string(),
      page: z.number(),
      quote: z.string(),
    })
  ),
});

interface RetrievedChunkMetadata {
  filename?: string;
  pageNumber?: number;
  uploadedAt?: string;
}

interface RetrievedChunk {
  id: number;
  content: string;
  metadata: RetrievedChunkMetadata | null;
  rrf_score: number;
  similarity: number;
}

/**
 * Picks the chunks the model will see, guaranteeing each document that cleared
 * the relevance gate at least PER_DOCUMENT_FLOOR slots before the rest are
 * filled by rank. Input must already be in rank order; output preserves it.
 */
function selectWithDocumentQuota(chunks: RetrievedChunk[], limit: number): RetrievedChunk[] {
  const byDocument = new Map<string, RetrievedChunk[]>();
  for (const chunk of chunks) {
    const filename = chunk.metadata?.filename ?? "unknown file";
    const group = byDocument.get(filename);
    if (group) group.push(chunk);
    else byDocument.set(filename, [chunk]);
  }

  const picked = new Set<RetrievedChunk>();
  for (const group of byDocument.values()) {
    for (const chunk of group.slice(0, PER_DOCUMENT_FLOOR)) picked.add(chunk);
  }
  // A library with more documents than slots would overshoot the limit on
  // reservations alone, so rank still decides who survives.
  for (const chunk of chunks) {
    if (picked.size >= limit) break;
    picked.add(chunk);
  }

  return chunks.filter((chunk) => picked.has(chunk)).slice(0, limit);
}

/**
 * Reads the transcript the client posted, defensively — it's user input like
 * any other. Anything malformed is dropped rather than rejected: a follow-up
 * answered without history is a worse answer, but an error is a worse product.
 */
function parseHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];

  const turns: ChatTurn[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;

    const trimmed = content.trim();
    if (trimmed.length === 0) continue;
    turns.push({ role, content: trimmed.slice(0, MAX_HISTORY_TURN_LENGTH) });
  }

  return turns.slice(-MAX_HISTORY_TURNS);
}

/** Generic filename debris that identifies no document in particular. */
const FILENAME_STOPWORDS = new Set(["copy", "file", "final", "draft", "document", "version"]);

/**
 * Distinctive words in a filename — "The-Changing-World-Order_Ray-Dalio_copy.pdf"
 * yields changing, world, order, dalio. Used to tell whether a question named a
 * particular document.
 */
function filenameTokens(filename: string): string[] {
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !FILENAME_STOPWORDS.has(token));
}

/** Lowercased, punctuation-stripped, whitespace-collapsed — for quote matching. */
function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Verifies a citation against the chunks the model was actually shown, and
 * repairs it where possible.
 *
 * Matching on the model's own filename+page alone was too brittle: asked to
 * "summarize the main idea" it cited real content with page numbers that
 * matched no retrieved chunk (it reports the page printed inside the document,
 * not the one on the context header), and both citations were silently dropped
 * — leaving a "from your documents" answer with no visible sources at all.
 *
 * So the quote is the primary key: find the chunk the quoted text actually came
 * from and take the filename and page from *that*. The locator is only trusted
 * as a fallback, and a citation matching neither is dropped, which is what
 * keeps a fabricated quote off the screen.
 */
function resolveCitation(
  citation: { filename: string; page: number; quote: string },
  chunks: RetrievedChunk[]
): { filename: string; page: number; quote: string } | null {
  const normalizedQuote = normalizeForMatching(citation.quote);

  if (normalizedQuote.length > 0) {
    // Long quotes get truncated or elided by the model, so a prefix counts too.
    const probe = normalizedQuote.slice(0, 60);
    const source = chunks.find((chunk) => {
      const content = normalizeForMatching(chunk.content);
      return content.includes(normalizedQuote) || content.includes(probe);
    });

    if (source) {
      return {
        filename: source.metadata?.filename ?? citation.filename,
        page: source.metadata?.pageNumber ?? citation.page,
        quote: citation.quote,
      };
    }
  }

  const locatorMatches = chunks.some(
    (chunk) =>
      chunk.metadata?.filename === citation.filename &&
      chunk.metadata?.pageNumber === citation.page
  );
  return locatorMatches ? citation : null;
}

/**
 * The previous prompt optimised for never hallucinating and succeeded at it by
 * never being useful: told to answer using ONLY what the context contains and
 * to declare anything else "not contained in the context", the model refused
 * questions it demonstrably had the evidence for — it was handed four chunks
 * containing the word "Nastenka" and still said the main character's name
 * wasn't there, because no sentence literally states "the main character is
 * named Nastenka".
 *
 * So the rules below draw the line somewhere else: inference over retrieved
 * text is expected, partial answers beat refusals, and when the documents
 * genuinely don't cover something the model may fall back on its own knowledge
 * as long as it says so. The guard against fabricated grounding is no longer
 * the prompt's strictness — it's `answerSource` plus the citation check the
 * route runs below, which drops any citation not matching a real context entry.
 */
const SYSTEM_PROMPT = `You are DocuSearch, a document Q&A assistant. Real people ask short, casual, half-specified questions ("main character?", "who is dostoevsky?", "what's this about"). Read them charitably and be genuinely useful.

You are given the filenames of every document in the user's library, plus numbered context entries retrieved from those documents for this question. The context is a small excerpt of each document, not the whole thing.

How to answer:
1. Prefer the documents. If the context supports an answer — even partially, even by reasonable inference — give it. Evidence does not have to be a sentence that states the answer outright: a character repeatedly addressed by name in dialogue tells you their name, and a title page tells you a work's title, author and translator.
2. Never refuse because of phrasing. Answer what the user meant, not the literal string they typed.
3. Lead with what you do know. A partial answer that names what's missing is always better than "not found" — if the documents show one character's name but not another's, say exactly that.
4. If the documents genuinely don't cover the question, you may answer from your own general knowledge. Say so plainly in the answer itself (for example: "That isn't covered in your documents, but ...").
5. Only when you can't answer from either source, say what you'd need in order to.
6. Absence of an excerpt is not evidence of absence in the document. Say "the retrieved excerpts don't cover it", never "the document does not contain it".
7. The library listing is itself knowledge about the user's documents. Questions like "what have I uploaded" or "who wrote this" are answered from it, and count as document-sourced even though a filename is not a citable context entry.
8. When the library holds more than one document and the question names none of them ("what is this about", "summarize the main idea", "how does it end"), never answer as if only one existed. Cover every document the context supports. Where the excerpts only reach some of the library, name the document you answered for, name the ones you couldn't, and offer to cover them — an answer that silently ignores half the library is worse than one that admits its scope. Always say which document an answer is about whenever the library holds more than one.

Set answerSource to:
- "documents" — the answer comes wholly or mainly from the context entries or the library listing.
- "general_knowledge" — the documents didn't cover it and you answered from your own knowledge.
- "none" — you gave no answer at all. If you answered the question in any form, this is the wrong value.

Citations:
- Cite only claims actually drawn from the context. Each citation's filename and page must appear on a context entry above, and each quote must be copied verbatim from that entry — not paraphrased.
- Citations are for answerSource "documents" only. When answering from general knowledge, citations must be an empty array. Never attach a citation to a claim it doesn't support just to make an answer look grounded.`;

export async function POST(request: NextRequest) {
  try {
    let body: unknown; // safer than "any" — forces us to check its shape before use
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    const question = (body as { question?: unknown } | null)?.question;

    if (typeof question !== "string" || question.trim().length === 0) {
      return NextResponse.json(
        { error: "'question' is required and must be a non-empty string." },
        { status: 400 }
      );
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        { error: `'question' must be ${MAX_QUESTION_LENGTH} characters or fewer.` },
        { status: 400 }
      );
    }

    const history = parseHistory((body as { history?: unknown } | null)?.history);

    // step 0: a follow-up has to be made standalone before it's embedded —
    // "what about her?" carries no meaning on its own, and its keywords are all
    // stopwords. Gated so a first question pays nothing for this.
    const isFollowUp = history.length > 0 && looksContextDependent(question);
    const openingReference = history.length === 0 ? bareReferenceKind(question) : null;

    const { standaloneQuestion, clarification } = isFollowUp
      ? await resolveFollowUp(question, history)
      : {
          standaloneQuestion: question,
          // Opening a conversation with "what about her?" names a person no
          // library can disambiguate, so it's settled here without a model
          // call. An impersonal reference ("how does it end") waits until the
          // library is known — with one document, "it" is that document.
          clarification:
            openingReference === "personal"
              ? "Who do you mean? Name the person or character and I'll look them up."
              : null,
        };

    // Asking beats guessing: with nothing in the conversation to resolve the
    // reference against, retrieval would run on an invented antecedent and
    // return confidently wrong sources.
    if (clarification) {
      return NextResponse.json({
        answer: clarification,
        answerSource: "clarification",
        citations: [],
        documentsNotCovered: [],
        retrievedChunks: [],
      });
    }

    // step 1: turn the question into a vector so we can search by meaning, not just keywords
    const queryEmbedding = await embeddings.embedQuery(standaloneQuestion);

    // step 2: ask the db for the best-matching chunks (keyword + vector, fused
    // server-side), and in parallel read what's in the library at all — the
    // manifest answers a whole class of questions retrieval can't ("what have I
    // uploaded", "who wrote this") without depending on a title page happening
    // to win a similarity race.
    const [search, filenames] = await Promise.all([
      supabaseAdmin.rpc("hybrid_search_documents", {
        // The resolved question drives the keyword half too — the raw follow-up
        // would reduce to stopwords and contribute nothing to the fusion.
        query_text: standaloneQuestion,
        query_embedding: queryEmbedding,
        match_count: CANDIDATE_COUNT,
      }),
      listDocumentFilenames().catch((error: unknown) => {
        // The manifest is an enhancement — a failure here shouldn't cost the
        // user their answer, so it degrades to "no manifest" and logs.
        console.error("[/api/query] manifest lookup failed:", error);
        return [] as string[];
      }),
    ]);

    if (search.error) {
      throw search.error;
    }

    // "How does it end" is a fair question of a one-document library and an
    // unanswerable one of a two-document library. Deferred to here because it
    // needs the manifest; the retrieval above is wasted only on this rare path.
    if (openingReference === "impersonal" && filenames.length > 1) {
      return NextResponse.json({
        answer: `Which document do you mean — ${filenames.join(", or ")}?`,
        answerSource: "clarification",
        citations: [],
        documentsNotCovered: [],
        retrievedChunks: [],
      });
    }

    const retrievedChunks = (search.data ?? []) as RetrievedChunk[];

    // Two-part gate: an absolute noise floor, plus a relative one anchored to
    // the best hit in this particular result set. Anything surviving both is
    // shown to the model, which is now responsible for deciding what's actually
    // relevant — that judgement reads context far better than a fixed number.
    const topSimilarity = retrievedChunks[0]?.similarity ?? 0;
    const floor = Math.max(MIN_SIMILARITY, topSimilarity - RELATIVE_WINDOW);
    const relevantChunks = selectWithDocumentQuota(
      retrievedChunks.filter((chunk) => chunk.similarity >= floor),
      MATCH_COUNT
    );

    // chunks are already ranked (best match first) — hybrid_search_documents fused
    // vector + keyword results with RRF before returning them, so just use the order as-is
    // step 3: build the prompt — one clearly-labeled block per chunk, so the model can cite filename+page
    const contextBlock = relevantChunks
      .map((chunk, i) => {
        const filename = chunk.metadata?.filename ?? "unknown file";
        const page = chunk.metadata?.pageNumber ?? "unknown page";
        return `[Context ${i + 1} | filename: ${filename} | page: ${page}]\n${chunk.content}`;
      })
      .join("\n\n");

    const manifestBlock =
      filenames.length > 0
        ? filenames.map((filename) => `- ${filename}`).join("\n")
        : "(the library is empty)";

    // An empty context is no longer a short-circuit: the model is told the
    // search came back with nothing so it can answer from general knowledge and
    // label it, which is the behaviour a flat "no relevant context" refusal was
    // getting wrong.
    // Stating coverage as a fact about *this* request, rather than leaving the
    // prompt's multi-document rule to be inferred: told only "cover the whole
    // library", the model still answered "summarize the main idea" about the
    // larger document alone and never mentioned the other one existed.
    const coveredDocuments = new Set(
      relevantChunks.map((chunk) => chunk.metadata?.filename).filter(Boolean)
    );
    const uncoveredDocuments = filenames.filter((filename) => !coveredDocuments.has(filename));
    const coverageParts: string[] = [];
    if (filenames.length > 1 && coveredDocuments.size > 0) {
      coverageParts.push(`These excerpts come from: ${[...coveredDocuments].join(", ")}.`);
      if (coveredDocuments.size > 1) {
        // Left to the general rule alone, the model picks one document and
        // answers as though the others weren't there — so the instruction is
        // repeated against this request's actual spread. Conditional, because a
        // question that does single out a document shouldn't drag in the rest.
        coverageParts.push(
          "If the question doesn't single out one document, address each of them; if it clearly concerns one, answer for that one."
        );
      }
      if (uncoveredDocuments.length > 0) {
        coverageParts.push(
          `Nothing was retrieved from ${uncoveredDocuments.join(", ")}, so you cannot speak for ${
            uncoveredDocuments.length > 1 ? "those documents" : "that document"
          } — name it and offer to look.`
        );
      }
    }
    const coverageNote = coverageParts.length > 0 ? `\n\nCoverage: ${coverageParts.join(" ")}` : "";

    const contextSection =
      relevantChunks.length > 0
        ? `Context entries:\n\n${contextBlock}${coverageNote}`
        : "Context entries: (nothing in the library matched this question)";

    // step 4: ask the model to answer + cite, forced into our exact schema (no free-form JSON to parse)
    const structuredQueryModel = queryModel.withStructuredOutput(responseSchema);

    // The transcript goes in as real turns, so the answer can follow on from
    // what was already said instead of reintroducing the same document every
    // time. The question asked is the user's own wording, not the rewrite —
    // the rewrite exists to steer retrieval, not to put words in their mouth.
    const result = await structuredQueryModel.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      {
        role: "user",
        content: `Documents in the user's library:\n${manifestBlock}\n\n${contextSection}\n\nQuestion: ${question}`,
      },
    ]);

    // Structural backstop on the looser prompt: every citation is checked
    // against the entries the model was actually shown — and re-anchored to the
    // chunk its quote came from — while citations are dropped entirely unless
    // the answer claims to be grounded.
    const citations =
      result.answerSource === "documents"
        ? result.citations
            .map((citation) => resolveCitation(citation, relevantChunks))
            .filter((citation): citation is NonNullable<typeof citation> => citation !== null)
        : [];

    // Told which documents it couldn't speak for, the model still answered as
    // though the library held only the one it had excerpts from — so scope is
    // reported as data the UI renders, not left to prose it may or may not
    // write. Only meaningful for a document-sourced answer: a general-knowledge
    // one already says it isn't from the library at all.
    // Suppressed when the user already named a document ("what does *dalio*
    // say about…"), where listing the rest of the library is noise rather than
    // a correction — but not when they named one that returned nothing, which
    // is precisely when they need to be told.
    const askedAbout = (filename: string) => {
      // The resolved question, since a follow-up like "and its main idea?" only
      // names a document once the reference has been filled in.
      const asked = standaloneQuestion.toLowerCase();
      return filenameTokens(filename).some((token) => asked.includes(token));
    };
    const namedACoveredDocument =
      [...coveredDocuments].some((filename) => filename && askedAbout(filename)) &&
      !uncoveredDocuments.some(askedAbout);

    const documentsNotCovered =
      result.answerSource === "documents" &&
      filenames.length > 1 &&
      coveredDocuments.size > 0 &&
      !namedACoveredDocument &&
      // A citation naming the document means it was covered after all.
      !citations.some((citation) => uncoveredDocuments.includes(citation.filename))
        ? uncoveredDocuments
        : [];

    return NextResponse.json({
      answer: result.answer,
      answerSource: result.answerSource,
      citations,
      documentsNotCovered,
      retrievedChunks, // the full pre-filter set, so you can see near-misses and their scores
    });
  } catch (error) {
    console.error("[/api/query] failed:", error);
    return NextResponse.json(
      { error: "Failed to answer the question. Please try again." },
      { status: 500 }
    );
  }
}
