/**
 * Types for the retrieval-comparison diagnostic (`/compare`, `/api/compare`).
 *
 * This is an evaluation harness, not a product surface — nothing here feeds
 * the chat flow. It exists to answer one question from the Week 3 roadmap:
 * does MMR actually reduce redundant chunks versus plain similarity search?
 */

/*
 * The relevance floor is NOT redeclared here. `/api/compare` imports the real
 * `MIN_SIMILARITY` straight from `app/api/query/route.ts`, so there is one
 * source of truth for it and the two can't drift.
 *
 * It's imported there — in the server route — rather than in this file on
 * purpose: this module is also pulled in by the `/compare` client component
 * (type-only), and re-exporting a value from a route module here would drag
 * the query route, and `lib/models`' server credentials with it, toward the
 * client bundle the moment anyone added a non-type import.
 */

export type StrategyId = "similarity" | "hybrid" | "mmr";

export interface ComparedChunk {
  /** 1-based position within this strategy's own result list. */
  rank: number;
  id: number;
  content: string;
  filename: string;
  page: number | null;
  /**
   * The strategy's own score, or null where it doesn't produce one that's
   * comparable per-chunk (MMR selects by set diversity, so rank is the only
   * meaningful signal — see `scoreLabel`).
   */
  score: number | null;
  /**
   * Raw cosine similarity of question ↔ chunk, present for all three
   * strategies so relevance is comparable across them on the same scale.
   * This — not `score` — is what gets checked against MIN_SIMILARITY.
   */
  similarity: number | null;
}

export interface StrategyResult {
  id: StrategyId;
  label: string;
  description: string;
  /** What `score` means for this strategy, e.g. "cosine similarity". */
  scoreLabel: string;
  /** Retrieval wall time. Excludes the query embedding, which all three share. */
  ms: number;
  /**
   * Mean pairwise cosine similarity between the chunks this strategy returned.
   * Higher = the set repeats itself; lower = more diverse coverage. This is the
   * number that actually answers "did MMR help?". Null with fewer than 2 chunks.
   */
  redundancy: number | null;
  /**
   * How many of this strategy's chunks clear MIN_SIMILARITY. Measured
   * independently of `redundancy` — a set can be perfectly diverse and
   * entirely irrelevant, which is exactly the case worth spotting.
   */
  aboveThreshold: number;
  chunks: ComparedChunk[];
}

export interface CompareResponse {
  question: string;
  /** Chunks requested per strategy. */
  matchCount: number;
  /** MMR knobs, surfaced so the page can state what it ran. */
  mmr: { fetchK: number; lambda: number };
  /** Time spent embedding the question once, shared by all three strategies. */
  embedMs: number;
  /**
   * The absolute relevance floor, as displayed. `/api/query` imports this same
   * constant, but gates on `max(MIN_SIMILARITY, topSimilarity - RELATIVE_WINDOW)`
   * — so a chunk shown as above the floor here may still be trimmed there for
   * sitting too far behind the best hit in its own result set.
   */
  minSimilarity: number;
  strategies: StrategyResult[];
}
