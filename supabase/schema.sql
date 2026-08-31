-- Week 3 — hybrid search additions on top of the existing `documents` table.
--
-- Existing state (NOT recreated or modified here):
--   documents(id bigint, content text, metadata jsonb, embedding vector(1536), created_at)
--   RLS enabled, service_role only
--   match_documents(query_embedding vector(1536), match_threshold float, match_count int)
--     -- vector-only search. Left untouched below as a fallback/comparison option.
--
-- Run this file manually in the Supabase SQL editor. It only adds a column,
-- an index, and a new function — nothing here drops or redefines
-- `match_documents` or the `documents` table.
--
-- NOTE: `id bigint` below matches Supabase's standard pgvector quickstart
-- schema. If your `documents.id` column is actually `uuid` (or something
-- else), change the `id` type in the RETURNS TABLE clause of
-- hybrid_search_documents to match before running this.

-- 1. Full-text search column ------------------------------------------------
-- Generated + stored so it's kept in sync with `content` automatically and
-- indexed like a normal column (no trigger to maintain).
alter table documents
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists documents_content_tsv_idx
  on documents using gin (content_tsv);

-- 2. Hybrid search (vector + full-text, fused with Reciprocal Rank Fusion) --
--
-- RRF combines two independently-ranked result lists by rank position alone
-- (not raw score), which avoids having to normalize cosine distance against
-- ts_rank_cd onto the same scale. Each side contributes 1 / (rrf_k + rank) to
-- the fused score; rrf_k (default 50, a common default in the literature)
-- dampens how much the very top of either list dominates the merge.
--
-- `match_documents` above is left in place unchanged, as a fallback or for
-- side-by-side comparison against this function.
--
-- IMPORTANT: rrf_score is a RANK-based score, not a relevance score — a chunk
-- that is the #1 full-text (or vector) hit gets the same rrf_score whether
-- it's a great match or a mediocre one, because RRF only ever sees "this
-- ranked 1st among the candidates fetched," never "how close is this,
-- really." That makes it unsuitable as a cutoff for "is this chunk actually
-- relevant, or should we refuse to answer." `similarity` (raw cosine
-- similarity, independent of rank) is included below so the caller can apply
-- an absolute relevance floor — see MIN_SIMILARITY in app/api/query/route.ts.
--
-- Postgres won't let CREATE OR REPLACE change a function's output columns, so
-- this must be dropped and recreated (safe — same name, same input signature,
-- callers just get one extra output column going forward).
drop function if exists hybrid_search_documents(text, vector, int, int, float, float);

create function hybrid_search_documents(
  query_text text,
  query_embedding vector(1536),
  match_count int default 10,
  rrf_k int default 50,
  full_text_weight float default 1.0,
  semantic_weight float default 1.0
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  rrf_score double precision,
  similarity double precision
)
language sql
stable
as $$
  with full_text as (
    select
      documents.id,
      row_number() over (
        order by ts_rank_cd(documents.content_tsv, websearch_to_tsquery('english', query_text)) desc
      ) as rank_ix
    from documents
    where documents.content_tsv @@ websearch_to_tsquery('english', query_text)
    order by rank_ix
    limit greatest(match_count * 2, 20)
  ),
  semantic as (
    select
      documents.id,
      row_number() over (order by documents.embedding <=> query_embedding) as rank_ix
    from documents
    order by rank_ix
    limit greatest(match_count * 2, 20)
  )
  select
    documents.id,
    documents.content,
    documents.metadata,
    (
      coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
      coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
    ) as rrf_score,
    1 - (documents.embedding <=> query_embedding) as similarity
  from full_text
  full outer join semantic on full_text.id = semantic.id
  join documents on documents.id = coalesce(full_text.id, semantic.id)
  order by rrf_score desc
  limit match_count
$$;
