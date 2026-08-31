# Week 3 — Backend Handoff (RAG Doc Q&A)

Status snapshot for starting UI work in a new conversation. Pair this with
your own `docusearch-ui-claude-code-prompt.md` (screens/deviations/contracts) —
this file covers implementation state and caveats that prompt doesn't.

## Stack
Next.js App Router + TypeScript, Tailwind v4, Supabase (pgvector), LangChain
(`@langchain/openai`, `@langchain/textsplitters`), Zod. Project root:
`d:\AI_Automation_Roadmap\repos\projects\week-3`. `.env.local` already has
real working credentials — don't overwrite it.

## Built and verified working

- **`app/api/ingest/route.ts`** — PDF upload → `pdf-parse` (per-page text) →
  `RecursiveCharacterTextSplitter` (800/150) → embed → insert into
  `documents` via `supabaseAdmin`, batched 100 rows/insert. Returns
  `{ filename, chunksCreated, pagesProcessed }`. Tested live with a real PDF
  (4 pages → 5 chunks).
- **`app/api/query/route.ts`** — question → `embeddings.embedQuery()` →
  `hybrid_search_documents` RPC (match_count 5) → similarity-filtered →
  `queryModel.withStructuredOutput(zodSchema)` → cited answer. Returns
  `{ answer, citations: [{filename, page, quote}], retrievedChunks }`.
  Tested live with 4 real questions against the ingested PDF — 4/4 correct,
  citation quotes verbatim, correctly refused an out-of-scope question
  instead of hallucinating.
- **`app/page.tsx`** — working upload UI (file picker, XHR progress,
  uploading/processing/done/error states). This is the "existing basic
  upload page" your UI prompt says to evolve, not discard.
- **`lib/models.ts`** — your real, tested file (not a placeholder anymore).
  Exports: `groqModel`, `embeddings`, `EMBEDDING_MODEL`
  (`text-embedding-3-small`), `queryModel` (real OpenAI `gpt-4o-mini`, added
  for `/api/query` specifically — deliberate deviation from Groq to avoid
  Week 2's rate-limit issues), `supabase`, `supabaseAdmin`.
- **`supabase/schema.sql`** — `documents` table (pre-existing, untouched),
  `match_documents` (pre-existing vector-only RPC, untouched),
  `content_tsv` + GIN index (new), `hybrid_search_documents` RPC (new —
  vector + full-text fused with RRF).

## 🔴 CONFIRMED BROKEN — `supabase/schema.sql` has NOT been re-run

Checked live on 2026-08-31 against the running app. `/api/query` returns
`citations: []` and the canned "No relevant context was found" answer for
**every** question, including ones the ingested PDF plainly answers
("What is the refund window?" — the PDF says 30 days).

Cause: the deployed `hybrid_search_documents` RPC still returns the old
column set. `retrievedChunks[0]` keys come back as
`['id','content','metadata','rrf_score']` — **no `similarity`**. So
`chunk.similarity >= MIN_SIMILARITY` evaluates `undefined >= 0.35` → false,
and every chunk is filtered out. It fails *silently* rather than erroring,
which is worse than the handoff predicted.

**Fix: run the current `supabase/schema.sql` in the Supabase SQL editor.**
It can't be done from this repo — `.env.local` has only the Supabase REST
URL + keys, no Postgres connection string, and the JS client can't execute
DDL. Nothing in the app code needs to change.

Once that's run, re-check `MIN_SIMILARITY = 0.35` against real numbers.

## ⚠️ Original open item (kept for context)

`hybrid_search_documents` was just updated to also return raw cosine
`similarity` per chunk (needed as a hard relevance floor — RRF's `rrf_score`
is rank-based, not an absolute relevance signal, so it can't be used to
detect "nothing here is actually relevant"). This required a
`DROP FUNCTION` + recreate in `supabase/schema.sql`.

**Confirm the updated `supabase/schema.sql` has actually been re-run in the
Supabase SQL editor.** If not, `/api/query` will error — the RPC response
won't have the `similarity` field the route now expects.

`MIN_SIMILARITY = 0.35` (top of `route.ts`) is an untuned starting guess,
not a validated threshold. Flagged in-code as needing calibration against
real similarity numbers once more test questions are run.

## Response shapes for UI work

```ts
// POST /api/ingest
{ filename: string, chunksCreated: number, pagesProcessed: number }

// POST /api/query
{
  answer: string,
  citations: { filename: string, page: number, quote: string }[],
  retrievedChunks: {
    id: number,
    content: string,
    metadata: { filename: string, pageNumber: number, uploadedAt: string } | null,
    rrf_score: number,
    similarity: number,
  }[]
}
```

`retrievedChunks` is always the full top-5 candidates (for debugging/eval),
regardless of the similarity filter — `citations` only ever reflects the
chunks that passed the relevance floor and were actually shown to the model.
An unanswerable question returns `citations: []` with an explanatory
`answer`, not an error.

## Not built (matches your UI prompt's "not in scope" list)

Chat UI, documents-list/delete endpoints, streaming, MMR/re-ranking,
LangSmith eval. Your UI prompt already flags list/delete as new endpoints
to build for the Documents page — none of that backend exists yet.
