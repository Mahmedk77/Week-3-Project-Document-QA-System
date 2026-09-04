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

/**
 * Where an answer came from.
 *
 * `general_knowledge` is a first-class outcome, not a failure: when the library
 * doesn't cover a question the model answers from what it knows and says so,
 * and the UI badges it rather than showing the "couldn't find that" card. Only
 * `none` means no answer was possible at all.
 */
export type AnswerSource = "documents" | "general_knowledge" | "none";

export interface QueryResponse {
  answer: string;
  answerSource: AnswerSource;
  citations: Citation[];
  /**
   * Documents in the library that this answer does NOT speak for, because
   * nothing relevant to the question was retrieved from them. Surfaced so a
   * one-document answer to a whole-library question can't read as complete —
   * empty whenever the library holds one document, or all of them were covered.
   */
  documentsNotCovered: string[];
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
  | {
      id: string;
      kind: "answer";
      answer: string;
      answerSource: AnswerSource;
      citations: Citation[];
      documentsNotCovered: string[];
    }
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
