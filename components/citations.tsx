"use client";

import type { Citation } from "@/lib/documents";
import { DocThumb, FileIcon } from "./icons";
import { Button, CopyButton, Dialog } from "./ui";

/** One citation, formatted for the clipboard. */
function quoteToText(citation: Citation, index: number) {
  return `[${index + 1}] ${citation.filename} — page ${citation.page}\n"${citation.quote}"`;
}

export function CitationCard({
  citation,
  index,
  showCopy = false,
}: {
  citation: Citation;
  /** Zero-based position in the `citations` array; display order comes from the API. */
  index: number;
  showCopy?: boolean;
}) {
  return (
    <article className="flex gap-3.5 rounded-xl border border-border bg-surface-2 p-3.5">
      <DocThumb className="hidden h-14 w-11 shrink-0 sm:block" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <FileIcon className="size-3.5 shrink-0 text-accent sm:hidden" />
          <span className="min-w-0 truncate text-sm font-medium text-text-primary">
            <span className="text-accent">[{index + 1}]</span> {citation.filename}
          </span>
          <span className="shrink-0 rounded-md border border-accent-soft-border bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            Page {citation.page}
          </span>

          {/* Wrapper controls display — putting `hidden` on the button itself
              loses to the button's own `inline-flex` in the cascade. */}
          {showCopy && (
            <span className="ml-auto hidden sm:block">
              <CopyButton text={quoteToText(citation, index)} label="Copy quote" />
            </span>
          )}
        </div>

        <blockquote className="mt-2.5 rounded-lg bg-surface-3/70 px-3 py-2.5 font-serif text-sm leading-relaxed text-text-secondary italic">
          <span aria-hidden="true" className="mr-1 text-accent/50">
            &ldquo;
          </span>
          {citation.quote}
          <span aria-hidden="true" className="ml-0.5 text-accent/50">
            &rdquo;
          </span>
        </blockquote>

        {showCopy && (
          <span className="mt-2 block sm:hidden">
            <CopyButton text={quoteToText(citation, index)} label="Copy quote" />
          </span>
        )}
      </div>
    </article>
  );
}

export function CitationsDialog({
  open,
  onClose,
  citations,
}: {
  open: boolean;
  onClose: () => void;
  citations: Citation[];
}) {
  const allQuotes = citations.map(quoteToText).join("\n\n");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Citations"
      subtitle={`${citations.length} sources supporting this answer`}
      labelledBy="citations-title"
      footer={
        <>
          <CopyButton
            text={allQuotes}
            label={
              <>
                Copy all<span className="hidden sm:inline"> quotes</span>
              </>
            }
            className="px-3.5! py-2!"
          />
          <Button variant="primary" onClick={onClose}>
            <span className="sm:hidden">Done</span>
            <span className="hidden sm:inline">Close</span>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Order comes straight from the API's `citations` array — never re-sorted. */}
        {citations.map((citation, index) => (
          <CitationCard
            key={`${citation.filename}-${citation.page}-${index}`}
            citation={citation}
            index={index}
          />
        ))}
      </div>
    </Dialog>
  );
}
