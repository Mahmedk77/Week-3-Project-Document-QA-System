/**
 * Shared types for the document list + Q&A UI.
 *
 * The `/api/query` shapes here mirror the real, already-built route — they are
 * read-only descriptions of it, not a place to change the contract.
 */

export interface Citation {
  filename: string;
  page: number;
  quote: string;
}

export interface RetrievedChunk {
  id: number;
  content: string;
  metadata: { filename: string; pageNumber: number; uploadedAt: string } | null;
  rrf_score: number;
  similarity: number;
}

export interface QueryResponse {
  answer: string;
  citations: Citation[];
  retrievedChunks: RetrievedChunk[];
}

export interface IngestResponse {
  filename: string;
  chunksCreated: number;
  pagesProcessed: number;
}

/**
 * One turn in the Ask transcript.
 *
 * Lives here rather than in the page because the conversation is held by
 * <AppProviders> — the page component unmounts on every route change, so
 * page-local state would drop the transcript on a trip to /documents.
 */
export type ChatMessage =
  | { id: string; kind: "user"; text: string; time: string }
  | { id: string; kind: "pending" }
  | { id: string; kind: "answer"; answer: string; citations: Citation[] }
  | { id: string; kind: "error"; message: string };

/** One ingested document, aggregated from its chunk rows by `GET /api/documents`. */
export interface DocumentSummary {
  filename: string;
  pages: number;
  chunks: number;
  uploadedAt: string | null;
}

export interface DocumentsResponse {
  documents: DocumentSummary[];
  totals: { documents: number; pages: number; chunks: number };
}

/**
 * The literal backstop string `/api/query` returns when every retrieved chunk
 * falls under MIN_SIMILARITY. Matched (not imported) because the query route is
 * out of scope for this pass — if that copy ever changes, the UI degrades to
 * showing it as body text, which is still correct, just less tidy.
 */
export const NO_CONTEXT_ANSWER =
  "No relevant context was found in the knowledge base for this question.";

export function formatUploadedDate(iso: string | null, style: "long" | "short" = "long") {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(style === "long" ? { year: "numeric" } : {}),
  });
}

export function formatCount(n: number, singular: string, plural = `${singular}s`) {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}
