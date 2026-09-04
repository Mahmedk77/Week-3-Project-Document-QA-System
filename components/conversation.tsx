"use client";

import { Fragment, useState } from "react";
import type { Citation } from "@/lib/documents";
import type { InlineSpan } from "@/lib/rich-text";
import { parseAnswer } from "@/lib/rich-text";
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

/** One line's worth of spans: bold, italic, plain text and citation badges. */
function InlineSpans({ spans, citationCount, onMarkerClick }: {
  spans: InlineSpan[];
  citationCount: number;
  onMarkerClick?: () => void;
}) {
  return (
    <>
      {spans.map((span, i) => {
        switch (span.kind) {
          case "strong":
            return (
              <strong key={i} className="font-semibold text-text-primary">
                {span.text}
              </strong>
            );
          case "em":
            return (
              <em key={i} className="italic">
                {span.text}
              </em>
            );
          case "citation":
            // Markers pointing past the end of `citations` stay as plain text
            // rather than linking to a source that isn't there.
            return span.index >= 1 && span.index <= citationCount ? (
              <CitationMarker key={i} n={span.index} onClick={onMarkerClick} />
            ) : (
              <Fragment key={i}>{`[${span.index}]`}</Fragment>
            );
          default:
            return <Fragment key={i}>{span.text}</Fragment>;
        }
      })}
    </>
  );
}

/**
 * Renders the answer's Markdown and its numbered citation markers.
 *
 * The model writes `**bold**` and numbered lists, which used to reach the
 * screen as literal asterisks. Structure is worth keeping — a taste pathway
 * reads as a list because it is one — so it's parsed rather than stripped.
 *
 * The model isn't required to emit `[n]` markers, so both cases are handled:
 * when it does, they become inline badges in place; when it doesn't, the badges
 * trail the answer.
 */
function AnswerBody({ answer, citationCount, onMarkerClick }: {
  answer: string;
  citationCount: number;
  onMarkerClick?: () => void;
}) {
  const blocks = parseAnswer(answer);
  const hasInlineMarkers = blocks.some((block) => {
    const spans = block.kind === "paragraph" ? block.spans : block.items.flat();
    return spans.some(
      (span) => span.kind === "citation" && span.index >= 1 && span.index <= citationCount
    );
  });

  const trailing = !hasInlineMarkers && citationCount > 0 && (
    <>
      {Array.from({ length: citationCount }, (_, i) => (
        <CitationMarker key={`trailing-${i}`} n={i + 1} onClick={onMarkerClick} />
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-text-primary">
      {blocks.map((block, blockIndex) => {
        const isLast = blockIndex === blocks.length - 1;

        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={blockIndex}
              className={`flex flex-col gap-1 pl-5 ${
                block.ordered ? "list-decimal" : "list-disc"
              } marker:text-text-muted`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="pl-0.5">
                  <InlineSpans
                    spans={item}
                    citationCount={citationCount}
                    onMarkerClick={onMarkerClick}
                  />
                  {isLast && itemIndex === block.items.length - 1 ? trailing : null}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <p key={blockIndex} className="whitespace-pre-wrap">
            <InlineSpans
              spans={block.spans}
              citationCount={citationCount}
              onMarkerClick={onMarkerClick}
            />
            {isLast ? trailing : null}
          </p>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Assistant message variants                                                 */
/* -------------------------------------------------------------------------- */

export function AnswerMessage({
  answer,
  citations,
  isGeneralKnowledge = false,
  documentsNotCovered = [],
}: {
  answer: string;
  citations: Citation[];
  /**
   * Documents this answer doesn't speak for. Stated by the UI rather than left
   * to the model, which reliably answered whole-library questions from one
   * document without ever mentioning the others.
   */
  documentsNotCovered?: string[];
  /**
   * The library didn't cover the question, so this is the model's own
   * knowledge. Still a real answer — it just gets labelled as unsourced, since
   * the whole promise of the app is that you can tell the two apart.
   */
  isGeneralKnowledge?: boolean;
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const hasMultiple = citations.length > 1;

  return (
    <AssistantRow>
      <div className="rounded-xl rounded-tl-sm border border-border bg-surface-card px-4 py-3.5">
        {isGeneralKnowledge && (
          <p className="mb-2.5 inline-flex items-center gap-1.5 rounded-lg border border-warn-border bg-warn-bg px-2 py-1 text-[11px] font-medium text-warn-text">
            <AlertCircleIcon className="size-3.5 shrink-0" />
            Not from your documents · general knowledge
          </p>
        )}

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

        {documentsNotCovered.length > 0 && (
          <p className="mt-3 border-t border-border pt-2.5 text-xs leading-relaxed text-text-muted">
            No matching excerpts came from{" "}
            {documentsNotCovered.map((filename, i) => (
              <Fragment key={filename}>
                {i > 0 && ", "}
                <span className="text-text-secondary">{filename}</span>
              </Fragment>
            ))}
            , so this answer doesn&apos;t speak for{" "}
            {documentsNotCovered.length > 1 ? "those documents" : "that document"}.
          </p>
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

/**
 * `answerSource: "none"` — the model could answer neither from the documents
 * nor from its own knowledge. Rare by design: a question the library doesn't
 * cover now gets a badged general-knowledge answer instead of landing here.
 */
export function NotFoundMessage({ answer }: { answer: string }) {
  const detail = answer.trim() || null;

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

/**
 * `answerSource: "clarification"` — the question referred to something the
 * conversation doesn't pin down ("what about her?" with no "her" yet), so it
 * asks instead of guessing. Framed as a question, not a failure: nothing went
 * wrong, and the user's next message resolves it.
 */
export function ClarificationMessage({ question }: { question: string }) {
  return (
    <AssistantRow>
      <div className="flex items-start gap-2.5 rounded-xl rounded-tl-sm border border-accent-soft-border bg-accent-soft px-4 py-3.5">
        <ChatIcon className="mt-0.5 size-4.5 shrink-0 text-accent" />
        <p className="min-w-0 text-sm leading-relaxed text-text-primary">{question}</p>
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
