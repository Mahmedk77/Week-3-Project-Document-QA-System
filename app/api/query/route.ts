import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { embeddings, queryModel, supabaseAdmin } from "@/lib/models";

export const runtime = "nodejs";

const MAX_QUESTION_LENGTH = 2000;
const MATCH_COUNT = 5;
// Hard relevance floor, checked in JS rather than SQL — rrf_score can't be used
// for this (see the comment on hybrid_search_documents in supabase/schema.sql),
// so we gate on raw cosine similarity instead. Starting value — not yet tuned
// against real data, expect to adjust once we see similarity numbers for a
// known-relevant vs. known-irrelevant question.
export const MIN_SIMILARITY = 0.35;

const responseSchema = z.object({
  answer: z.string(),
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

const SYSTEM_PROMPT = `You are a document Q&A assistant. Answer the user's question using ONLY the information in the numbered context entries below.

Rules:
- If the answer is not contained in the context, say so explicitly in "answer" instead of guessing.
- Every citation must use a filename and page number that actually appears in the context below.
- The "quote" for each citation must be text copied directly from that source chunk, not a paraphrase.
- Never invent filenames, page numbers, or quotes that are not present in the context.`; //!Flag: this is just instructions to the model — nothing here forces it to obey, model can still hallucinate.

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

    // step 1: turn the question into a vector so we can search by meaning, not just keywords
    const queryEmbedding = await embeddings.embedQuery(question);

    // step 2: ask the db for the best-matching chunks (keyword + vector, fused server-side)
    const { data, error: rpcError } = await supabaseAdmin.rpc("hybrid_search_documents", {
      query_text: question,
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
    });

    if (rpcError) {
      throw rpcError;
    }

    const retrievedChunks = (data ?? []) as RetrievedChunk[];

    // hard backstop, independent of the prompt: drop chunks the DB call itself
    // isn't confident about, so the model never even sees them as "context"
    const relevantChunks = retrievedChunks.filter((chunk) => chunk.similarity >= MIN_SIMILARITY);

    if (relevantChunks.length === 0) {
      return NextResponse.json({
        answer: "No relevant context was found in the knowledge base for this question.",
        citations: [],
        retrievedChunks, // kept even when empty-after-filter, so you can see the near-misses and their scores
      });
    }

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

    // step 4: ask the model to answer + cite, forced into our exact schema (no free-form JSON to parse)
    const structuredQueryModel = queryModel.withStructuredOutput(responseSchema);

    const result = await structuredQueryModel.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Context:\n\n${contextBlock}\n\nQuestion: ${question}` },
    ]);

    return NextResponse.json({
      answer: result.answer,
      citations: result.citations,
      retrievedChunks,
    });
  } catch (error) {
    console.error("[/api/query] failed:", error);
    return NextResponse.json(
      { error: "Failed to answer the question. Please try again." },
      { status: 500 }
    );
  }
}
