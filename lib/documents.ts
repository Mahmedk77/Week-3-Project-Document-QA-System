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
 *
 * `mixed` exists because "who is dostoevsky?" genuinely is both — his identity
 * is the model's own knowledge, his authorship of White Nights is on the title
 * page in the library. Without a box that fits, the model picked one of the
 * other two at random from run to run, and a `general_knowledge` verdict used
 * to discard the verified citation along with it.
 */
export type AnswerSource =
  | "documents"
  | "mixed"
  | "general_knowledge"
  | "none"
  | "clarification";

/**
 * One turn of conversation, as sent to `/api/query`.
 *
 * The transcript lives in the browser (React state, mirrored to sessionStorage)
 * and is posted with each question so a follow-up like "what about her?" can be
 * resolved into a standalone question before anything is embedded. Nothing is
 * stored server-side — see HANDOFF.md on why this isn't a database feature.
 */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The last `limit` turns of a transcript, in the shape `/api/query` expects.
 * Pending and error messages carry no conversational content, so they're
 * skipped rather than sent as empty turns.
 */
export function toHistory(messages: ChatMessage[], limit: number): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    if (message.kind === "user") turns.push({ role: "user", content: message.text });
    else if (message.kind === "answer") turns.push({ role: "assistant", content: message.answer });
  }
  return turns.slice(-limit);
}

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
