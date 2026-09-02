"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-providers";
import {
  AnswerMessage,
  ErrorMessage,
  NotFoundMessage,
  PendingMessage,
  UserMessage,
} from "@/components/conversation";
import {
  ChatIcon,
  FileIcon,
  FolderIcon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
} from "@/components/icons";
import { Button, Dialog } from "@/components/ui";
import { UploadPanel } from "@/components/upload-panel";
import { formatCount } from "@/lib/documents";

/* -------------------------------------------------------------------------- */

/** Names shown inline on desktop before deferring the rest to the modal. */
const INLINE_NAME_LIMIT = 2;

function DocumentsSummaryRow() {
  const { documents, openUpload } = useApp();
  const [isListOpen, setIsListOpen] = useState(false);

  // Beyond this the inline list is just truncated noise, so the modal takes over.
  const hasOverflow = documents.length > INLINE_NAME_LIMIT;

  return (
    <div className="flex shrink-0 items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5 sm:px-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <FolderIcon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        {/* Total ingested documents — /api/query always searches all of them,
            so there is no active/inactive selection to express here. */}
        <p className="text-sm font-medium text-text-primary">
          {formatCount(documents.length, "document")}
        </p>

        <div className="flex min-w-0 items-baseline gap-2">
          {/* Names are desktop-only — at mobile widths they truncate to nothing
              useful, so that breakpoint goes straight to "View all". */}
          <p className="hidden min-w-0 truncate text-xs text-text-secondary sm:block">
            {documents
              .slice(0, INLINE_NAME_LIMIT)
              .map((doc) => doc.filename)
              .join(" · ")}
          </p>

          <button
            type="button"
            onClick={() => setIsListOpen(true)}
            className={`shrink-0 text-xs text-accent underline underline-offset-2 transition-colors hover:text-accent-hover ${
              // On desktop the inline names already say it all at 2 or fewer.
              hasOverflow ? "" : "sm:hidden"
            }`}
          >
            View all
          </button>
        </div>
      </div>

      <Button variant="primary" onClick={openUpload} className="shrink-0 px-3! py-1.5!">
        <PlusIcon className="size-3.5" />
        <span className="text-xs">Add</span>
      </Button>

      <Dialog
        open={isListOpen}
        onClose={() => setIsListOpen(false)}
        title="Documents"
        subtitle={`${formatCount(documents.length, "document")} · all searched for every question`}
        labelledBy="documents-list-title"
        footer={
          <Button variant="primary" onClick={() => setIsListOpen(false)}>
            Done
          </Button>
        }
      >
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li
              key={doc.filename}
              className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5"
            >
              <FileIcon className="mt-0.5 size-4 shrink-0 text-accent" />
              {/* Wrapped, not truncated — the modal exists to show full names. */}
              <span className="min-w-0 flex-1 text-sm break-words text-text-primary">
                {doc.filename}
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  isAsking,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  isAsking: boolean;
}) {
  const { openUpload } = useApp();
  const canSend = !disabled && !isAsking && value.trim().length > 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
      className={`flex shrink-0 items-center gap-2 rounded-xl border border-border px-3 py-2 ${
        disabled ? "bg-surface-2" : "bg-surface-card"
      }`}
    >
      <button
        type="button"
        onClick={openUpload}
        disabled={disabled}
        aria-label="Add documents"
        className="grid size-8 shrink-0 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <PaperclipIcon className="size-4" />
      </button>

      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || isAsking}
        placeholder="Ask a question…"
        aria-label="Ask a question"
        className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
      />

      {disabled && (
        <span className="shrink-0 rounded-md bg-surface-3 px-2 py-1 text-[11px] font-medium text-text-muted">
          Disabled
        </span>
      )}

      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send question"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-text-muted"
      >
        <SendIcon className="size-4" />
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

export default function AskPage() {
  const { documents, isLoading, error, refresh, messages, isAsking, ask } = useApp();
  const [question, setQuestion] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);

  const hasDocuments = documents.length > 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Jump on the first pass (returning from /documents lands mid-transcript);
    // animate for messages that arrive while the user is watching.
    el.scrollTo({
      top: el.scrollHeight,
      behavior: hasAutoScrolledRef.current ? "smooth" : "auto",
    });
    hasAutoScrolledRef.current = true;
  }, [messages]);

  async function handleAsk() {
    const trimmed = question.trim();
    if (!trimmed || isAsking) return;
    setQuestion("");
    await ask(trimmed);
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-text-muted">Loading your documents…</p>
      </div>
    );
  }

  return (
    /* Page stays full-bleed; the reading column is capped so answer text and
       the input bar don't stretch across a wide viewport. */
    <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
      {error && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-warn-border bg-warn-bg px-4 py-2.5">
          <p className="text-sm text-warn-text">{error}</p>
          <Button onClick={() => void refresh()} className="py-1.5!">
            Retry
          </Button>
        </div>
      )}

      {/* Pinned under the header — persistent context for what's being
          searched, so it doesn't scroll away with older turns. */}
      {hasDocuments && <DocumentsSummaryRow />}

      {hasDocuments ? (
        <div ref={scrollRef} className="scroll-region min-h-0 flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="grid size-11 place-items-center rounded-xl border border-border bg-surface-2 text-text-muted">
                <ChatIcon className="size-5" />
              </span>
              <p className="font-serif text-lg text-text-secondary">
                Ask a question about your documents
              </p>
              <p className="max-w-sm text-xs text-text-muted">
                Answers are grounded only in the files you add — nothing is retrieved from the
                open web.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5 pb-2">
              {messages.map((message) => {
                switch (message.kind) {
                  case "user":
                    return <UserMessage key={message.id} text={message.text} time={message.time} />;
                  case "pending":
                    return <PendingMessage key={message.id} />;
                  case "error":
                    return <ErrorMessage key={message.id} message={message.message} />;
                  case "answer":
                    return message.citations.length === 0 ? (
                      <NotFoundMessage key={message.id} answer={message.answer} />
                    ) : (
                      <AnswerMessage
                        key={message.id}
                        answer={message.answer}
                        citations={message.citations}
                      />
                    );
                }
              })}
            </div>
          )}
        </div>
      ) : (
        /* Upload zone and the inert chat panel share one scroll box, so a long
           upload queue can't be clipped now that the page itself never scrolls. */
        <div className="scroll-region flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <UploadPanel onDocumentIngested={refresh} />

          {/* Chat is visibly inert until something is indexed. */}
          <div className="flex min-h-52 flex-1 flex-col items-center justify-center gap-2.5 rounded-xl border border-border bg-surface-2/60 px-6 text-center">
            <span className="grid size-11 place-items-center rounded-xl border border-border bg-surface-card text-text-muted">
              <ChatIcon className="size-5" />
            </span>
            <p className="font-serif text-xl text-text-secondary">
              Upload a document to start asking questions
            </p>
            <p className="max-w-sm text-xs text-text-muted">
              Answers are grounded only in the files you add — nothing is retrieved from the
              open web.
            </p>
          </div>
        </div>
      )}

      <Composer
        value={question}
        onChange={setQuestion}
        onSubmit={handleAsk}
        disabled={!hasDocuments}
        isAsking={isAsking}
      />
    </div>
  );
}
