# Week 3 — Backend + UI Handoff (RAG Doc Q&A)

Status snapshot for starting fresh in a new conversation. The app is
functionally complete: full 8-screen UI, ingest/query/compare backends, and
a real calibration pass on the one tunable constant. What's below is state
and caveats — read it before touching `MIN_SIMILARITY`, `/compare`, or the
Supabase indexes again.

## Stack

Next.js App Router + TypeScript, Tailwind v4 (`px-3!` canonical-important
syntax), React 19, Supabase (pgvector), LangChain (`@langchain/openai`,
`@langchain/textsplitters`, `@langchain/core`), Zod v4. Project root:
`d:\AI_Automation_Roadmap\repos\projects\week-3`. `.env.local` already has
real working credentials — don't overwrite it.

## Built and verified working

**Backend routes:**

- **`app/api/ingest/route.ts`** — PDF upload → duplicate-filename check
  (409 if a document with that name already exists) → `pdf-parse` (per-page
  text) → `RecursiveCharacterTextSplitter` (800/150) → embed → insert into
  `documents` via `supabaseAdmin`, batched 100 rows/insert. Returns
  `{ filename, chunksCreated, pagesProcessed }`.
- **`app/api/query/route.ts`** — question → `embeddings.embedQuery()` →
  `hybrid_search_documents` RPC (30 candidates) → two-part relevance gate →
  per-document quota down to 12 → `queryModel.withStructuredOutput` →
  answer. Returns `{ answer, answerSource, citations: [{filename, page,
  quote}], documentsNotCovered, retrievedChunks }`. The prompt also receives a **library manifest** (every
  filename, via `listDocumentFilenames()`), so "what have I uploaded" and
  "who wrote this" don't depend on a title page winning a similarity race.
  See the over-refusal section below before changing any of it.
  `MIN_SIMILARITY` is still exported so `/api/compare` reuses the same
  constant — no duplicated threshold anywhere.
- **`app/api/documents/route.ts`** (GET) — aggregates the chunk-level
  `documents` table into one row per filename (`{filename, pages, chunks,
  uploadedAt}`) plus totals. There's no per-document table, so this is a JS
  aggregation over paginated chunk rows (paged by
  `fetchChunkMetadataRows()` in `lib/corpus.ts`, shared with the query
  route's manifest) — fine at current scale, would want to become a SQL view
  if the corpus grows a lot.
- **`app/api/documents/[filename]/route.ts`** (DELETE) — deletes every chunk
  row for a filename. Filename is the identity since chunks have no
  document-level id.
- **`app/api/compare/route.ts`** — diagnostic endpoint, see MMR section
  below.

**UI:** all 8 screens from the original spec are built — Ask (chat with
citations, upload panel when empty, documents summary row), Documents
(list/delete/upload, duplicate-name rejection surfaced in the dialog),
Compare (`/compare`, reached via a button on Documents, not in nav), shared
header with Clear-conversation / Ask / Docs ordering, mobile breakpoints,
custom favicon. Session storage persists the Ask conversation across
navigation.

- **`lib/models.ts`** — exports `groqModel`, `embeddings`, `EMBEDDING_MODEL`
  (`text-embedding-3-small`), `queryModel` (real OpenAI `gpt-4o-mini`,
  deliberate deviation from Groq to avoid Week 2's rate-limit issues),
  `supabase`, `supabaseAdmin`.
- **`supabase/schema.sql`** — `documents` table, `match_documents`
  (vector-only RPC), `content_tsv` + GIN index, `hybrid_search_documents` RPC
  (vector + full-text fused with RRF).

## ⚠️ Read this before trusting any Supabase ANN index again

**Symptom:** at 908 chunks (up from the ~9–15 the schema was built and
tested at), `match_documents` — used by `/compare`'s "Plain similarity"
column and as MMR's candidate pool, **not** used by `/api/query` — was
returning wrong, sparse results. Some queries got 0 rows at every `k`
(5/20/100) despite the table having 908 rows and `hybrid_search_documents`
returning correct, varying results on the same queries.

**Root cause:** an IVFFlat approximate-nearest-neighbor index whose
centroids were computed when the table had ~15 rows and never rebalanced as
it grew to 908. Classic IVFFlat failure mode — recall degrades hard once the
table outgrows the row count the index was built at.

**Measured impact (brute-force exact recall, before fix):**
`match_documents` **17%** (5/30), `hybrid_search_documents` **93%** (28/30,
the misses were RRF re-ranking on keyword relevance, working as designed).

**Fix applied directly in the Supabase SQL editor** (already run — nothing
to redo):

```sql
DO $
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS idx
    FROM pg_index x
    JOIN pg_class c  ON c.oid  = x.indexrelid
    JOIN pg_class t  ON t.oid  = x.indrelid
    JOIN pg_am    am ON am.oid = c.relam
    WHERE t.relname = 'documents'
      AND am.amname IN ('ivfflat', 'hnsw')
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.idx);
    RAISE NOTICE 'dropped ANN index: %', r.idx;
  END LOOP;
END $;
```

With no ANN index, both RPCs fall back to exact (sequential) search —
correct at this corpus size, just not sublinear. **Verified post-fix**:
`match_documents` now returns results matching a brute-force baseline
exactly. First query after the DDL took ~44s (cold cache/plan); four
consecutive warm calls after that settled to 344–713ms, in the same range as
`hybrid_search_documents`. Not a lasting regression.

**If the corpus grows past ~50k chunks**, rebuild an ANN index rather than
running exact search forever:

```sql
create index on documents using hnsw (embedding vector_cosine_ops);
```

HNSW over IVFFlat — it degrades far more gracefully as a table grows, so
this failure mode shouldn't recur. Whoever adds it back should re-run a
recall check afterward the same way this was diagnosed (brute-force
dot-product baseline vs RPC output, see below).

## ⚠️ SUPERSEDED — the app used to refuse questions it had the answer to

Found when the CEO tested the deployed app against a second, literary
document (Dostoevsky's *White Nights*, added alongside the Dalio book).
Two obvious questions both got "I couldn't find that in the provided
documents":

| question | what actually happened |
|---|---|
| "name of main character in white nights" | 5/5 chunks cleared the floor, **4 of them contain the word "Nastenka"** — the model was handed the name and refused anyway |
| "who is dostoevsky?" | 4 of 5 chunks were cut by the 0.35 floor for scoring **0.337–0.347**. The one that survived was the title page, which names him as the author — and it still refused |

Neither was a retrieval failure. Both were **over-refusal at the generation
step**, plus a floor that was mis-calibrated for this corpus. Three things
were wrong and are now changed:

1. **The system prompt** optimised for never hallucinating by never being
   useful. "Answer using ONLY the information in the context" + "if the
   answer is not contained in the context, say so" means the model refuses
   anything requiring one step of inference — and no novel contains the
   sentence "the main character is named Nastenka"; it's shown in dialogue.
   The prompt now expects inference over retrieved text, prefers partial
   answers to refusals, and never says "the document doesn't contain X"
   when it can only know "the retrieved excerpts don't cover X".
2. **`MATCH_COUNT` 5 → 12.** At 5, every hit for the White Nights question
   was a thematic match on the title/opening pages; the chunk that actually
   introduces her by name (p18, "My name is Nastenka") never made the cut.
3. **The floor is now two-part**: `max(MIN_SIMILARITY, topSimilarity −
   RELATIVE_WINDOW)`, with `MIN_SIMILARITY` lowered 0.35 → 0.25 and
   `RELATIVE_WINDOW` 0.12. Absolute thresholds don't transfer between
   corpora; the shape of a result set does.

**Answers can now come from outside the documents** — a deliberate product
decision, not a loosening by accident. `answerSource` is `"documents"` |
`"general_knowledge"` | `"none"`; when the library doesn't cover a question
the model answers from its own knowledge, says so in the answer text, and
the UI badges it "Not from your documents · general knowledge". The
protection against fake grounding is no longer the prompt's strictness — it
is structural: the route drops any citation whose filename+page pair isn't
one of the entries the model was actually shown, and drops citations
entirely unless `answerSource` is `"documents"`.

Verified against the live corpus after the change:

| question | answerSource | result |
|---|---|---|
| name of main character | documents | names Nastenka, notes the narrator is unnamed |
| who is dostoevsky? | documents | author of *White Nights*, cited to p1 |
| main character? (terse) | documents | correct |
| what documents do you have | documents | both filenames, from the manifest |
| what does dalio say about reserve currencies | documents | correct, 3 citations |
| who won the 2022 world cup? | general_knowledge | "That isn't covered in your documents, but Argentina…", 0 citations |

## The 15-query eval, and what it killed

A second pass ran 15 queries in the register real users type — terse,
misspelled, context-dependent, ambiguous across a two-document library —
against the live corpus. Script and results are not committed; rebuild it
from the table below if needed.

**Scored 8 pass / 2 partial / 5 fail, then 10 / 2 / 3 after the fixes.**

The headline finding is a negative one: **query rewriting was planned and
then dropped, because the eval showed it fixes nothing here.** All five
terse and misspelled queries already passed ("main character?", "who is
dostoyev**ks**y", "**nastinka** grandmother"), and none of the five failures
had phrasing as its cause. The decisive test was "how old is nastenka":

- the answer is on p28 ("now I am seventeen"), and that chunk was never
  retrieved;
- querying with the **near-verbatim sentence** scores it only **0.372**,
  because the age is one clause inside an 800-char chunk that's mostly about
  lessons and the grandmother — the embedding averages it away;
- a HyDE-style expansion ("Nastenka is twenty years old and lives with her
  blind grandmother"), which is what a rewriter would generate, still didn't
  surface it.

So the lever for that class is **chunk size, not query phrasing**. Don't
spend the latency of an extra LLM hop on rewriting; it was measured and it
doesn't pay.

### Fixed off the back of it

- **Multi-document ambiguity.** "What is this book about" answered about
  Dalio alone and never mentioned a second document existed — confidently
  incomplete, which reads worse than a refusal. Retrieval now pulls
  `CANDIDATE_COUNT` 30 and `selectWithDocumentQuota()` reserves
  `PER_DOCUMENT_FLOOR` slots per document before filling the rest by rank,
  so 908 Dalio chunks can't crowd out ~90 from White Nights. Trade-off: a
  document-specific question can pull in two off-topic chunks, which the
  model ignores but does pay for in tokens.
- **Scope disclosure is computed, not prompted.** Told explicitly in the
  prompt which documents it had no excerpts for, gpt-4o-mini *still*
  answered as if the library held one document. So `documentsNotCovered`
  is derived in the route and rendered by the UI ("No matching excerpts came
  from X…"). It's suppressed when the question names a document that *was*
  covered ("what does **dalio** say about…"), where it would be noise — but
  not when the named document is the one that came back empty, which is
  exactly when it's needed. Lesson worth keeping: **when a guarantee
  matters, compute it; don't ask the model for it.**
- **Citations were being silently dropped.** The old check required the
  model's `filename::page` to match a retrieved chunk, and it reports the
  page printed *inside* the document instead — "summarize the main idea"
  emitted two real Dalio citations, both discarded, leaving a "from your
  documents" answer with no sources. `resolveCitation()` now matches on the
  **quote text** and re-anchors filename and page from the chunk the quote
  actually came from, falling back to the locator and dropping only what
  matches neither.

## Conversational follow-ups — built, and NOT with memory classes

`/api/query` now accepts an optional `history: {role, content}[]`. The
browser already held the transcript (React state + sessionStorage); it was
simply never sent. Nothing is stored server-side.

**Why not `ConversationBufferMemory` / `ConversationSummaryMemory`:** they
don't exist in what's installed. `@langchain/core` 1.2.9 ships only the
abstract `BaseMemory` / `BaseChatMessageHistory`; the concrete classes live
in the `langchain` package, which isn't a dependency — and adding it risks
the same zod v3/v4 peer conflict that already blocked `@langchain/community`.
They also exist to feed the `Chain` abstraction this app doesn't use (it
calls `queryModel.withStructuredOutput(...).invoke([...])` directly). And
`ConversationSummaryMemory` solves "the transcript outgrew the context
window", which a 6-turn cap on gpt-4o-mini does not have. **Supabase-backed
history is a different feature** — surviving a device or browser change —
and is still deliberately not built.

**How it works** (`lib/follow-up.ts`):

- `looksContextDependent()` gates the rewrite so a first question pays
  nothing. Loose on purpose — the resolver echoes a standalone question back
  unchanged, so firing needlessly is cheap and missing one is not.
- `resolveFollowUp()` rewrites against the transcript: "what about her
  grandmother?" → "What is Nastenka's grandmother like in White Nights?".
  **The rewrite is what gets embedded, and what goes to `query_text`** — the
  raw follow-up embeds to nothing and reduces to stopwords on the keyword
  half. The user's original wording still goes to the answering step, so a
  bad rewrite degrades retrieval rather than changing the question answered.
  On failure it falls back to the question as typed.
- `bareReferenceKind()` handles a conversation that *opens* with a reference.
  Personal ("what about her?") is unanswerable however many documents are
  loaded, so it's refused without a model call in ~30ms. Impersonal ("how
  does it end") is only ambiguous with more than one document, so that check
  waits until the manifest is known and then names the documents to choose
  between. With a single-document library it just answers.
- Clarifications return `answerSource: "clarification"` and render as a
  question, not the orange failure card.

**Two things the eval caught**, both worth remembering:

1. The resolver initially asked for clarification on "and what causes
   empires to decline?" — a complete question whose leading "and" it read as
   a reference. Broad is not the same as ambiguous, and asking someone to
   narrow a perfectly good question is worse than answering it. The prompt
   now says so explicitly.
2. It asked "Which empire are you referring to?" in response to "what about
   her?" — clarifying against the *previous topic* rather than the
   unresolved word. It now asks about the reference itself.

Multi-turn eval (7 conversations, each played through for real with the
prior answer fed back as history): pronoun across turns, ellipsis, cross-
document pronoun, mid-chat topic switch, bare pronoun with and without
history, and "explain that more simply" — **all 7 pass**, with the 15
single-turn queries unregressed.

### Still open, in priority order

1. **Chunk dilution and position-blindness.** "How old is nastenka" (fact
   buried in a big chunk) and "how does it end" (retrieval has no notion of
   where a chunk sits in the document, so it returns the emotional peak
   rather than the last pages) both need ingest-level work — smaller chunks
   or sentence-window retrieval, plus positional metadata.
2. **Mojibake in stored text.** Curly quotes were mangled at ingest
   (`oneâs soul`, `donât read them`) and leak into quoted citations.
   Encoding bug in the PDF parse step. Fix it with (2), since both need a
   re-ingest of the corpus.

### Historical — why 0.35 looked right at the time

Kept because the method is still sound, and because it's the clearest
example of a calibration that was real but corpus-specific. It was checked
against a 30-question spread (19 answerable, 4 near-miss, 7 clearly
irrelevant) run through the actual `/api/query` path at 908 chunks:

| group | n | min similarity | median | max |
|---|---|---|---|---|
| answerable | 19 | 0.382 | 0.628 | 0.772 |
| irrelevant | 7 | 0.129 | 0.191 | 0.278 |

0.35 sat in a clean, unoccupied gap (0.278 → 0.382): **19/19** answerable
questions passed the floor, **0/7** irrelevant ones leaked through. All of
that was true — of *that* corpus. On literary prose the whole distribution
sits lower (0.31–0.48 for a good question), the gap closes, and the same
number starts cutting correct chunks by thousandths. That's the lesson
worth keeping: **an absolute similarity floor is a property of the corpus it
was tuned on, not of the app.** Re-check it whenever the corpus changes
character, or keep it relative.

One apparent counterexample turned out not to be one: a question that
looked "wrongly refused" ("three main types of productivity") retrieved 5
chunks all above the floor (0.448–0.479) — the refusal came from
`gpt-4o-mini` itself, correctly, because the source document doesn't contain
that taxonomy. Worth remembering as a pattern: a refusal doesn't always mean
the similarity floor fired. Check `retrievedChunks` before assuming the
threshold is the problem.

The original miscalibration *theory* was actually the ANN index bug above —
`/compare`'s Plain/MMR columns were showing misleadingly sparse results,
which looked like over-aggressive filtering but wasn't.

## MMR retrieval comparison (`/compare`) — built, results table is stale

`POST /api/compare` runs one question through three strategies (plain
similarity via `match_documents`, hybrid via `hybrid_search_documents`, MMR
via `maximalMarginalRelevance` from `@langchain/core/utils/math` reading
stored embeddings — not `SupabaseVectorStore`, which won't install here due
to a `zod` v3/v4 peer conflict via `@browserbasehq/stagehand`) and returns
each strategy's chunks plus a **redundancy** score (mean pairwise cosine
similarity across the returned set — lower = more diverse). `/compare`
shows all three side by side, with each chunk's raw cosine and a "below
relevance floor" badge (dimmed, never removed — the point of the page is
seeing real retrieval behavior, junk included).

**⚠️ The 10-question results table below predates the ANN index fix.**
`match_documents` had 17% recall when these numbers were measured, so both
the Plain column and MMR's candidate pool (which reads from
`match_documents`) were working off wrong data. Treat every number below as
unreliable until re-run.

**Re-running it isn't a rerun of the same script** — the corpus that
produced these numbers (`mmr-test-document.pdf` + `test-knowledge-base.pdf`,
15 chunks total) has since been deleted; the corpus currently holds only
Ray Dalio's *The Changing World Order* (908 chunks). Re-running the original
spec faithfully needs those two test PDFs re-ingested first. Don't do this
without checking whether that's actually wanted — it was flagged as a
follow-up, not requested yet.

<details>
<summary>Stale results (pre-fix, kept for reference only)</summary>

Corpus at the time: `mmr-test-document.pdf` (10 chunks) +
`test-knowledge-base.pdf` (5).

| Q  | kind    | plain | hybrid | MMR   | Δ vs plain |
| -- | ------- | ----- | ------ | ----- | ---------- |
| 1  | trap    | 0.708 | 0.687  | 0.341 | −0.367     |
| 2  | trap    | 0.708 | 0.708  | 0.378 | −0.330     |
| 3  | trap    | 0.661 | 0.661  | 0.462 | −0.199     |
| 4  | trap    | 0.708 | 0.708  | 0.311 | −0.397     |
| 5  | trap    | 0.687 | 0.687  | 0.401 | −0.286     |
| 6  | control | 0.465 | 0.465  | 0.302 | −0.163     |
| 7  | control | 0.375 | 0.375  | 0.247 | −0.128     |
| 8  | control | 0.599 | 0.599  | 0.246 | −0.353     |
| 9  | control | 0.615 | 0.615  | 0.260 | −0.355     |
| 10 | trap    | 0.661 | 0.661  | 0.288 | −0.373     |

Findings that are still conceptually true regardless of the bad numbers
(worth re-checking, not re-deriving from scratch): MMR reduced redundancy on
every question and never increased it; MMR's diversification effect wasn't
specific to duplicated content, it affected control questions too; plain and
hybrid look near-identical at small corpus sizes because RRF has almost
nothing to re-rank with so few chunks (this specifically should look
different now at 908 chunks); MMR's redundancy win came partly from
including chunks below the relevance floor — diversity and relevance are
independent axes, and a diverse set of irrelevant chunks is still diverse
(the "Who won the 2022 World Cup?" row scored MMR's *best* redundancy while
returning nothing relevant at all).

</details>

## Background — why raw `similarity` exists alongside `rrf_score`

`hybrid_search_documents` returns raw cosine `similarity` per chunk
alongside `rrf_score`, because RRF is rank-based: the #1 full-text hit
scores the same whether it's a great match or a mediocre one. That makes
`rrf_score` unusable as a "is anything here actually relevant?" cutoff.
`similarity` is the absolute signal both `MIN_SIMILARITY` and `/compare`'s
relevance floor use.

## How the index bug and the calibration numbers were actually measured

Not committed anywhere (all scratch scripts), but worth knowing the method
if this needs to be redone at a different corpus size:

- **Exact recall check**: pull every row's embedding via raw PostgREST
  (`${SUPABASE_URL}/rest/v1/documents?select=id,embedding`), compute
  brute-force dot-product nearest neighbors client-side as ground truth,
  compare IDs against what the RPC actually returned. Fetching all
  embeddings this way is slow (~200s for 200 rows) — page it or run it once
  and reuse the baseline rather than re-fetching per check.
- **Calibration sweep**: call `/api/query` directly (not `/compare` — it
  uses the production hybrid path) across a hand-built set of
  answerable/near-miss/irrelevant questions, record each returned chunk's
  `similarity`, look for the gap between the irrelevant-question max and the
  answerable-question min.

## Response shapes for UI/eval work

```ts
// POST /api/ingest
{ filename: string, chunksCreated: number, pagesProcessed: number }
// 409 { error: string } if a document with this filename already exists

// POST /api/query
{
  answer: string,
  // "general_knowledge" is a real answer the docs didn't cover, not a failure —
  // the UI badges it. Only "none" renders as "couldn't find that".
  answerSource: "documents" | "general_knowledge" | "none",
  citations: { filename: string, page: number, quote: string }[],
  // Library documents this answer does NOT speak for (nothing relevant retrieved
  // from them). Computed in the route, rendered by the UI — see the eval section.
  documentsNotCovered: string[],
  retrievedChunks: {
    id: number,
    content: string,
    metadata: { filename: string, pageNumber: number, uploadedAt: string } | null,
    rrf_score: number,
    similarity: number,
  }[]
}

// GET /api/documents
{
  documents: { filename: string, pages: number, chunks: number, uploadedAt: string | null }[],
  totals: { documents: number, pages: number, chunks: number }
}

// DELETE /api/documents/:filename
{ filename: string, chunksDeleted: number }
// 404 { error: string } if no document with that filename exists

// POST /api/compare — see lib/compare.ts for full types
{
  question: string,
  matchCount: number,
  mmr: { fetchK: number, lambda: number },
  minSimilarity: number,
  embedMs: number,
  strategies: { id: "plain" | "hybrid" | "mmr", label: string, description: string,
    scoreLabel: string, ms: number, redundancy: number | null, aboveThreshold: number,
    chunks: { id: number, rank: number, filename: string, page: number | null,
      score: number | null, similarity: number | null, content: string }[] }[]
}
```

`retrievedChunks` on `/api/query` is the full 30-candidate set (for
debugging/eval), before the relevance gate and the per-document quota —
`citations` only ever reflects chunks that survived both, were shown to the
model, and matched `resolveCitation()`. `citations: []` is not a failure
signal on its own: read `answerSource`.

## Not built

Streaming answers, LangSmith eval, re-ranking beyond MMR, chat history
persisted server-side (session storage only, client-side). History nav was
a deliberate spec deviation, not an oversight — don't add it back without
checking first.

**Conversational follow-ups** are the biggest remaining gap for real users —
see "Still open" in the eval section above for that and the two behind it.
