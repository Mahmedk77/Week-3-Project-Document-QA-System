import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cosineSimilarity, maximalMarginalRelevance } from "@langchain/core/utils/math";
import { embeddings, supabaseAdmin } from "@/lib/models";
// The real relevance floor, from the route that enforces it — not a copy.
import { MIN_SIMILARITY } from "@/app/api/query/route";
import type { ComparedChunk, CompareResponse, StrategyResult } from "@/lib/compare";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Chunks each strategy returns — matches the match_count `/api/query` uses. */
const MATCH_COUNT = 5;
/** Candidate pool MMR narrows down from. Bigger pool = more room for diversity. */
const MMR_FETCH_K = 20;
/** 1.0 = pure relevance (equivalent to plain similarity), 0.0 = pure diversity. */
const MMR_LAMBDA = 0.5;

const requestSchema = z.object({
  question: z.string().trim().min(1, "A question is required.").max(1000),
});

interface RetrievalRow {
  id: number;
  content: string;
  metadata: { filename?: string; pageNumber?: number } | null;
  similarity?: number;
  rrf_score?: number;
}

function toChunk(row: RetrievalRow, index: number, score: number | null): ComparedChunk {
  return {
    rank: index + 1,
    id: row.id,
    content: row.content,
    filename: row.metadata?.filename ?? "(unknown file)",
    page: typeof row.metadata?.pageNumber === "number" ? row.metadata.pageNumber : null,
    score,
    // Every path here originates from a vector search, so raw cosine
    // similarity is available for all three strategies — including MMR, whose
    // candidate pool comes from match_documents.
    similarity: typeof row.similarity === "number" ? row.similarity : null,
  };
}

function countAboveThreshold(chunks: ComparedChunk[]) {
  return chunks.filter((c) => c.similarity !== null && c.similarity >= MIN_SIMILARITY).length;
}

/**
 * pgvector columns come back over PostgREST as a JSON *string* rather than an
 * array, so both shapes are handled.
 */
function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchStoredEmbeddings(ids: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (ids.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("id, embedding")
    .in("id", ids);
  if (error) throw error;

  for (const row of (data ?? []) as { id: number; embedding: unknown }[]) {
    const vector = parseVector(row.embedding);
    if (vector) map.set(row.id, vector);
  }
  return map;
}

/**
 * Mean pairwise cosine similarity across a result set — the redundancy signal.
 *
 * MMR's whole claim is "you won't get 5 chunks that say the same thing", so
 * this quantifies it: average how alike every pair of returned chunks is.
 */
function meanPairwiseSimilarity(vectors: number[][]): number | null {
  if (vectors.length < 2) return null;

  const matrix = cosineSimilarity(vectors, vectors);
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      sum += matrix[i][j];
      pairs += 1;
    }
  }
  return pairs === 0 ? null : sum / pairs;
}

/**
 * POST /api/compare — runs one question through three retrieval strategies.
 *
 * NEW route. `/api/query`, `/api/ingest`, `lib/models.ts` and both existing
 * RPCs are read-only from here; no SQL was added or changed for this.
 *
 * Strategies run sequentially rather than in parallel so the per-strategy
 * timings are comparable instead of contending with each other.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }
    const { question } = parsed.data;

    // Embedded once and shared, so it isn't counted against any one strategy.
    const embedStart = Date.now();
    const queryVector = await embeddings.embedQuery(question);
    const embedMs = Date.now() - embedStart;

    /* 1 — Plain similarity: the pre-existing match_documents RPC, which
       nothing else in the app currently uses. */
    const simStart = Date.now();
    const sim = await supabaseAdmin.rpc("match_documents", {
      query_embedding: queryVector,
      match_count: MATCH_COUNT,
      filter: {},
    });
    if (sim.error) throw sim.error;
    const simRows = (sim.data ?? []) as RetrievalRow[];
    const simMs = Date.now() - simStart;

    /* 2 — Hybrid: the same RPC /api/query uses (vector + full-text, RRF). */
    const hybridStart = Date.now();
    const hybrid = await supabaseAdmin.rpc("hybrid_search_documents", {
      query_text: question,
      query_embedding: queryVector,
      match_count: MATCH_COUNT,
    });
    if (hybrid.error) throw hybrid.error;
    const hybridRows = (hybrid.data ?? []) as RetrievalRow[];
    const hybridMs = Date.now() - hybridStart;

    /* 3 — MMR: LangChain's own `maximalMarginalRelevance` over a wider
       candidate pool.

       DEVIATION from the spec, flagged deliberately: the spec asks for
       LangChain's MMR "via SupabaseVectorStore" from @langchain/community,
       which won't install here — it drags in @browserbasehq/stagehand, which
       peers on zod@^3 against this project's zod@4. So MMR runs through the
       identical algorithm imported straight from @langchain/core (already a
       dependency) — this is LangChain's implementation, not a hand-rolled one.
       Bonus: SupabaseVectorStore re-embeds candidate text on every call, while
       this reads the stored vectors, so MMR scores against the exact vectors
       that were indexed with no extra embedding round-trips. */
    const mmrStart = Date.now();
    const pool = await supabaseAdmin.rpc("match_documents", {
      query_embedding: queryVector,
      match_count: MMR_FETCH_K,
      filter: {},
    });
    if (pool.error) throw pool.error;
    const poolRows = (pool.data ?? []) as RetrievalRow[];

    const poolVectors = await fetchStoredEmbeddings(poolRows.map((row) => row.id));
    const usableRows = poolRows.filter((row) => poolVectors.has(row.id));
    const selectedIndexes = maximalMarginalRelevance(
      queryVector,
      usableRows.map((row) => poolVectors.get(row.id)!),
      MMR_LAMBDA,
      MATCH_COUNT
    );
    const mmrRows = selectedIndexes.map((index) => usableRows[index]).filter(Boolean);
    const mmrMs = Date.now() - mmrStart;

    /* Redundancy — needs vectors for every chunk any strategy returned. The
       MMR pool already covers most of them; only fetch what's missing. */
    const selectedIds = [...new Set([...simRows, ...hybridRows, ...mmrRows].map((r) => r.id))];
    const missingIds = selectedIds.filter((id) => !poolVectors.has(id));
    const extraVectors = await fetchStoredEmbeddings(missingIds);
    const vectorFor = (id: number) => poolVectors.get(id) ?? extraVectors.get(id);

    const redundancyOf = (rows: RetrievalRow[]) =>
      meanPairwiseSimilarity(
        rows.map((row) => vectorFor(row.id)).filter((v): v is number[] => Array.isArray(v))
      );

    const simChunks = simRows.map((row, i) => toChunk(row, i, row.similarity ?? null));
    const hybridChunks = hybridRows.map((row, i) => toChunk(row, i, row.rrf_score ?? null));
    const mmrChunks = mmrRows.map((row, i) => toChunk(row, i, null));

    const strategies: StrategyResult[] = [
      {
        id: "similarity",
        label: "Plain similarity",
        description: "Vector search only, top 5 by cosine similarity.",
        scoreLabel: "cosine similarity",
        ms: simMs,
        redundancy: redundancyOf(simRows),
        aboveThreshold: countAboveThreshold(simChunks),
        chunks: simChunks,
      },
      {
        id: "hybrid",
        label: "Hybrid (RRF)",
        description: "Vector + full-text, fused by reciprocal rank. Used by /api/query.",
        scoreLabel: "rrf_score",
        ms: hybridMs,
        redundancy: redundancyOf(hybridRows),
        aboveThreshold: countAboveThreshold(hybridChunks),
        chunks: hybridChunks,
      },
      {
        id: "mmr",
        label: "MMR",
        description: `Top ${MATCH_COUNT} of ${MMR_FETCH_K} candidates, balancing relevance against diversity (λ ${MMR_LAMBDA}).`,
        scoreLabel: "no per-chunk score — selected as a set",
        ms: mmrMs,
        redundancy: redundancyOf(mmrRows),
        aboveThreshold: countAboveThreshold(mmrChunks),
        chunks: mmrChunks,
      },
    ];

    const response: CompareResponse = {
      question,
      matchCount: MATCH_COUNT,
      mmr: { fetchK: MMR_FETCH_K, lambda: MMR_LAMBDA },
      embedMs,
      minSimilarity: MIN_SIMILARITY,
      strategies,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("[/api/compare] failed:", error);
    return NextResponse.json({ error: "Failed to run the comparison." }, { status: 500 });
  }
}
