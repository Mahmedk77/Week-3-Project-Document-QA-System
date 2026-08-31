"use client";

import { Fragment, useState } from "react";
import type { Citation } from "@/lib/documents";
import { NO_CONTEXT_ANSWER } from "@/lib/documents";
import { AlertCircleIcon, ChatIcon, ChevronDownIcon, FileIcon } from "./icons";
import { CitationCard, CitationsDialog } from "./citations";

/* -------------------------------------------------------------------------- */
/* Message shells                                                             */
/* -------------------------------------------------------------------------- */

export function UserMessage({ text, time }: { text: string; time: string }) {
  return (
    <div className="flex items-start justify-end gap-2.5">
      <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-surface-3 px-4 py-3 sm:max-w-[75%]">
        <p className="text-sm leading-relaxed text-text-primary">{text}</p>
        <p className="mt-1 text-right text-[11px] text-text-muted">{time}</p>
      </div>
      <span
        aria-hidden="true"
        className="hidden size-7 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-text-muted sm:grid"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4">
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 19.5a7 7 0 0 1 14 0" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}

function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-accent"
      >
        <ChatIcon className="size-4" />
      </span>
      <div className="min-w-0 max-w-[92%] flex-1 sm:max-w-[85%]">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Answer body with footnote-style citation markers                           */
/* -------------------------------------------------------------------------- */

function CitationMarker({ n, onClick }: { n: number; onClick?: () => void }) {
  const className =
    "mx-0.5 inline-flex h-[17px] min-w-[17px] translate-y-[-2px] items-center justify-center rounded-[5px] border border-accent-soft-border bg-accent-soft px-1 align-baseline text-[10px] font-semibold text-accent";

  if (!onClick) return <span className={className}>{n}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View citation ${n}`}
      className={`${className} transition-colors hover:bg-accent hover:text-accent-contrast`}
    >
      {n}
    </button>
  );
}

/**
 * Renders the answer with numbered markers.
 *
 * The model isn't required to emit `[n]` markers, so both cases are handled:
 * when it does, they become inline badges in place; when it doesn't, the badges
 * trail the answer. Markers pointing past the end of `citations` are left as
 * plain text rather than linking to a source that isn't there.
 */
function AnswerBody({ answer, citationCount, onMarkerClick }: {
  answer: string;
  citationCount: number;
  onMarkerClick?: () => void;
}) {
  const segments = answer.split(/\[(\d+)\]/g);
  const hasInlineMarkers = segments.some(
    (segment, i) => i % 2 === 1 && Number(segment) >= 1 && Number(segment) <= citationCount
  );

  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap text-text-primary">
      {segments.map((segment, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{segment}</Fragment>;

        const n = Number(segment);
        return n >= 1 && n <= citationCount ? (
          <CitationMarker key={i} n={n} onClick={onMarkerClick} />
        ) : (
          <Fragment key={i}>{`[${segment}]`}</Fragment>
        );
      })}

      {!hasInlineMarkers &&
        citationCount > 0 &&
        Array.from({ length: citationCount }, (_, i) => (
          <CitationMarker key={`trailing-${i}`} n={i + 1} onClick={onMarkerClick} />
        ))}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Assistant message variants                                                 */
/* -------------------------------------------------------------------------- */

export function AnswerMessage({
  answer,
  citations,
}: {
  answer: string;
  citations: Citation[];
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const hasMultiple = citations.length > 1;

  return (
    <AssistantRow>
      <div className="rounded-xl rounded-tl-sm border border-border bg-surface-card px-4 py-3.5">
        <AnswerBody
          answer={answer}
          citationCount={citations.length}
          onMarkerClick={hasMultiple ? () => setIsDialogOpen(true) : undefined}
        />

        {/* One source expands inline — no button, no modal. */}
        {citations.length === 1 && (
          <div className="mt-3">
            <CitationCard citation={citations[0]} index={0} showCopy />
          </div>
        )}

        {hasMultiple && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={() => setIsDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-soft-border bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-accent-contrast"
            >
              <FileIcon className="size-3.5" />
              View {citations.length} Citations
              <ChevronDownIcon className="size-3.5" />
            </button>
            <span className="text-xs text-text-muted">
              Grounded in {citations.length} sources
            </span>
          </div>
        )}
      </div>

      {hasMultiple && (
        <CitationsDialog
          open={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          citations={citations}
        />
      )}
    </AssistantRow>
  );
}

/** `citations: []` — the backend found nothing above the relevance floor. */
export function NotFoundMessage({ answer }: { answer: string }) {
  // The route's canned backstop string adds nothing over the headline; a model-
  // written explanation does, so that one is shown.
  const detail = answer.trim() === NO_CONTEXT_ANSWER ? null : answer;

  return (
    <AssistantRow>
      <div className="flex items-start gap-2.5 rounded-xl rounded-tl-sm border border-warn-border bg-warn-bg px-4 py-3.5">
        <AlertCircleIcon className="mt-0.5 size-4.5 shrink-0 text-warn-text" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-warn-text">
            I couldn&apos;t find that in the provided documents.
          </p>
          {detail && (
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{detail}</p>
          )}
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            Try rephrasing your question, or upload additional documents that might contain
            this information.
          </p>
        </div>
      </div>
    </AssistantRow>
  );
}

export function PendingMessage() {
  return (
    <AssistantRow>
      <div className="inline-flex items-center gap-2 rounded-xl rounded-tl-sm border border-border bg-surface-card px-4 py-3.5">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="animate-dot size-1.5 rounded-full bg-accent"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </span>
        <span className="text-sm text-text-secondary">Searching your documents…</span>
      </div>
    </AssistantRow>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <AssistantRow>
      <div className="flex items-start gap-2.5 rounded-xl rounded-tl-sm border border-danger/25 bg-danger/5 px-4 py-3.5">
        <AlertCircleIcon className="mt-0.5 size-4.5 shrink-0 text-danger" />
        <p className="text-sm text-text-primary">{message}</p>
      </div>
    </AssistantRow>
  );
}
