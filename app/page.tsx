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
import { ChatIcon, FolderIcon, PaperclipIcon, PlusIcon, SendIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import { UploadPanel } from "@/components/upload-panel";
import type { Citation, QueryResponse } from "@/lib/documents";
import { formatCount } from "@/lib/documents";

type Message =
  | { id: string; kind: "user"; text: string; time: string }
  | { id: string; kind: "pending" }
  | { id: string; kind: "answer"; answer: string; citations: Citation[] }
  | { id: string; kind: "error"; message: string };

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* -------------------------------------------------------------------------- */

function DocumentsSummaryRow() {
  const { documents, openUpload } = useApp();

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
        <p className="truncate text-xs text-text-secondary">
          {documents.map((doc) => doc.filename).join(" · ")}
        </p>
      </div>

      <Button variant="primary" onClick={openUpload} className="shrink-0 px-3! py-1.5!">
        <PlusIcon className="size-3.5" />
        <span className="text-xs">Add</span>
      </Button>
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
        placeholder="Ask a question about your documents…"
        aria-label="Ask a question about your documents"
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
  const { documents, isLoading, error, refresh } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasDocuments = documents.length > 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleAsk() {
    const trimmed = question.trim();
    if (!trimmed || isAsking) return;

    const pendingId = `pending-${Date.now()}`;
    setQuestion("");
    setIsAsking(true);
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, kind: "user", text: trimmed, time: nowLabel() },
      { id: pendingId, kind: "pending" },
    ]);

    let resolved: Message;
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = (await response.json()) as QueryResponse & { error?: string };

      resolved = response.ok
        ? { id: pendingId, kind: "answer", answer: body.answer, citations: body.citations ?? [] }
        : { id: pendingId, kind: "error", message: body.error ?? "Failed to answer the question." };
    } catch {
      resolved = { id: pendingId, kind: "error", message: "Couldn't reach the server." };
    }

    setMessages((current) => current.map((msg) => (msg.id === pendingId ? resolved : msg)));
    setIsAsking(false);
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
