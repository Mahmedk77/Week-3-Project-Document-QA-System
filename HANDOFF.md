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

## ✅ RESOLVED — `supabase/schema.sql` has been re-run

The original open item (below) is closed. Verified live on 2026-09-01:
`retrievedChunks` now comes back with keys
`['id','content','metadata','rrf_score','similarity']`, and
"What is the refund window?" returns a cited answer
("...a standard refund window of 30 days...") instead of a refusal.

History, for the record: there was a window where the RPC still returned the
old column set. It failed *silently* rather than erroring —
`chunk.similarity >= MIN_SIMILARITY` evaluated `undefined >= 0.35` → false,
so every chunk was filtered and every question got the canned "No relevant
context" answer. Worth remembering as a failure mode: a missing field in an
RPC response degrades into a blanket refusal, not a visible error.

## ⚠️ Still open — `MIN_SIMILARITY` is not calibrated

`MIN_SIMILARITY = 0.35` (top of `app/api/query/route.ts`) remains an untuned
starting guess.

One real data point, from "What is the refund window?":

| chunk | similarity | passes 0.35 |
| ----- | ---------- | ----------- |
| 1     | 0.601      | yes         |
| 2     | 0.483      | yes         |
| 3     | 0.258      | no          |
| 4     | 0.239      | no          |
| 5     | 0.237      | no          |

The threshold lands in a wide empty gap (0.483 → 0.258) with nothing near
0.35, so it's holding up here. That's one question, though. Needs a spread of
questions — especially ones that *should* be refused — to check whether
anything relevant ever falls just under, or anything irrelevant sneaks just
over.

## MMR retrieval comparison (`/compare`) — built, with one flagged deviation

`POST /api/compare` runs one question through three strategies and returns each
one's chunks plus a **redundancy** score (mean pairwise cosine similarity across
the returned set — lower = more diverse coverage). Page at `/compare`, reached
from a "Compare retrieval" button on the Documents page. Deliberately *not* in
the header nav or the 3-item mobile bar: it's a diagnostic, not a feature.

**DEVIATION — MMR does not use `SupabaseVectorStore`.** The spec asked for
LangChain's MMR "via `SupabaseVectorStore`" from `@langchain/community`. That
package will not install here: it peer-depends on `@browserbasehq/stagehand`,
which pins `zod@^3` against this project's `zod@4.5.4`, so npm fails with
ERESOLVE. Installing it needs `--legacy-peer-deps` plus a permanent `.npmrc`
entry or every future `npm install` breaks.

Instead `/api/compare` imports `maximalMarginalRelevance` from
`@langchain/core/utils/math` — **the identical function `SupabaseVectorStore`
calls internally**, already a dependency. This is not a hand-rolled MMR. It's
also slightly better: `SupabaseVectorStore` re-embeds candidate text on every
call, while this reads the stored vectors, so MMR ranks against the exact
vectors that were indexed with no extra embedding round-trips.

No new dependencies. No SQL added or changed — `match_documents` already has
the LangChain-compatible signature `(query_embedding, match_count, filter)`.

### Results — all 10 spec questions, 2026-09-02

Corpus: `mmr-test-document.pdf` (10 chunks) + `test-knowledge-base.pdf` (5).

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

Mean redundancy — redundant-content questions (1-5, 10): plain **0.689**,
hybrid **0.685**, MMR **0.363**. Control questions (6-9): plain **0.514**,
hybrid **0.514**, MMR **0.264**.

**Findings:**

1. **MMR reduced redundancy on all 10 questions**, never once increased it.
2. The experiment design held: plain similarity really is more repetitive on
   the redundant refund questions (0.689) than on the controls (0.514).
3. **The controls did not behave as the spec predicted.** It expected all three
   strategies to look similar on questions 6-9; MMR cut redundancy there too
   (0.514 → 0.264). So MMR's effect isn't specific to duplicated content — it
   diversifies any result set. Worth knowing before citing the controls as a
   null result.
4. **Plain and hybrid are near-identical** (0.689 vs 0.685; identical on 9 of
   10 questions). Expected at this corpus size — with 15 chunks total, RRF has
   almost nothing to re-rank. This comparison would need a much larger corpus
   to say anything real about hybrid vs plain.

### Relevance floor on `/compare` — and what it exposed

`/compare` originally showed raw top-N per strategy with no relevance signal,
so an out-of-domain question looked indistinguishable from a good one. Each
chunk now carries its raw cosine similarity, chunks under the floor are dimmed
and badged "below relevance floor" (**never filtered out** — seeing real
retrieval behaviour, failures included, is the point of the page), and each
column reports "N of 5 above relevance floor".

⚠️ `MIN_SIMILARITY` is **mirrored** in `lib/compare.ts`, not shared. The query
route declares it as a non-exported `const` and that file is out of scope, so
it can't be imported. Change one, change the other — or add `export` to the
query route's const (a zero-behaviour change) and import it.

**This immediately surfaced a real cost to MMR that the redundancy score alone
hid.** Cosine similarity per returned chunk:

| question                | plain     | hybrid    | MMR                          |
| ----------------------- | --------- | --------- | ---------------------------- |
| "What is the refund policy?" | **5 of 5** above floor | **5 of 5** | **3 of 5** — two chunks at 0.178 and 0.296 |
| "Who won the 2022 World Cup?" | 0 of 5 | 0 of 5 | 0 of 5 (cosines 0.026–0.072) |

So MMR's headline 0.341 redundancy on the refund question is **partly bought by
picking chunks `/api/query` would have discarded**. Diversity and relevance are
independent axes, and MMR trades the second for the first. Any claim that "MMR
performed best" has to be qualified by that — the redundancy number alone
overstates it.

The World Cup row is also the honest illustration of the trap: MMR scores its
*best* redundancy (0.261) on a question where nothing retrieved is relevant at
all. A diverse set of irrelevant chunks is still diverse.

## Background — why `similarity` exists at all

`hybrid_search_documents` returns raw cosine `similarity` per chunk alongside
`rrf_score`, because RRF is rank-based: the #1 full-text hit scores the same
whether it's a great match or a mediocre one. That makes `rrf_score` unusable
as a "is anything here actually relevant?" cutoff. `similarity` is the
absolute signal the relevance floor needs.

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
