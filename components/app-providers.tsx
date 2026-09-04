"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  ChatMessage,
  DocumentSummary,
  DocumentsResponse,
  QueryResponse,
} from "@/lib/documents";
import type { CompareResponse } from "@/lib/compare";
import { ChatIcon, FolderIcon, PlusIcon } from "./icons";
import { Button, Dialog } from "./ui";
import { UploadPanel } from "./upload-panel";

interface AppContextValue {
  documents: DocumentSummary[];
  totals: DocumentsResponse["totals"];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  openUpload: () => void;

  /* Conversation — held here so it survives navigating to /documents and back. */
  messages: ChatMessage[];
  isAsking: boolean;
  ask: (question: string) => Promise<void>;
  clearConversation: () => void;

  /* Retrieval comparison — same reasoning: a run is slow and worth keeping
     across a trip to another page. In memory only, unlike the conversation. */
  comparison: CompareResponse | null;
  compareQuestion: string;
  setCompareQuestion: (question: string) => void;
  isComparing: boolean;
  compareError: string | null;
  runComparison: (question: string) => Promise<void>;
  clearComparison: () => void;
}

const EMPTY_TOTALS = { documents: 0, pages: 0, chunks: 0 };

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* -------------------------------------------------------------------------- */
/* Conversation persistence — sessionStorage, so a reload keeps the transcript */
/* but closing the tab ends it. Deliberately not localStorage: a days-old      */
/* transcript citing since-deleted documents would be worse than none.         */
/* -------------------------------------------------------------------------- */

// Versioned so a future change to ChatMessage doesn't try to render stale shapes.
const CONVERSATION_KEY = "docusearch:conversation:v1";

const RENDERABLE_KINDS = new Set(["user", "answer", "error"]);

/**
 * A `pending` turn is rewritten on the way out. The request that would have
 * resolved it died with the old page, so restoring the spinner would leave it
 * spinning forever. Only the stored copy is rewritten — a live in-flight
 * request is untouched, and overwrites this with the real answer when it lands.
 */
function forStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) =>
    msg.kind === "pending"
      ? { id: msg.id, kind: "error", message: "That answer was interrupted — ask again." }
      : msg
  );
}

function readStoredConversation(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(CONVERSATION_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Drop anything that wouldn't render — corrupt entries, or a `pending` that
    // slipped through — rather than letting it throw mid-render.
    return parsed.filter(
      (msg): msg is ChatMessage =>
        !!msg &&
        typeof msg === "object" &&
        typeof (msg as ChatMessage).id === "string" &&
        RENDERABLE_KINDS.has((msg as ChatMessage).kind)
    );
  } catch {
    // Storage blocked (private mode / site data disabled) or corrupt JSON.
    return [];
  }
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProviders>");
  return value;
}

/* -------------------------------------------------------------------------- */

const NAV_ITEMS = [
  { href: "/", label: "Ask", Icon: ChatIcon },
  { href: "/documents", label: "Documents", Icon: FolderIcon },
] as const;

function Header() {
  const pathname = usePathname();
  const { messages, clearConversation, comparison, compareQuestion, clearComparison } = useApp();

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3.5 sm:px-6">
      <Link href="/" className="flex items-center gap-2">
        <ChatIcon className="size-5 text-accent" />
        <span className="font-serif text-lg font-semibold text-text-primary">DocuSearch</span>
      </Link>

      <div className="flex items-center gap-3">
        {/* Reset control sits before the nav — it acts on the page you're
            already on, so it reads left-to-right as "this page" then "go
            elsewhere".

            Disabled rather than hidden while empty, so the header doesn't
            change shape mid-conversation. Each page gets the control for
            *its own* state, or none at all — an allow-list, not a deny-list,
            so a new route can't inherit a button that doesn't belong to it.
            /documents has nothing to reset, so it stays empty. */}
        {pathname === "/" && (
          <Button
            onClick={clearConversation}
            disabled={messages.length === 0}
            title={messages.length === 0 ? "No conversation to clear" : "Clear conversation"}
            className="shrink-0 px-3! py-1.5! whitespace-nowrap"
          >
            <span className="text-xs">Clear conversation</span>
          </Button>
        )}

        {/* Named for what it actually clears — calling it "conversation" here
            is what made the shared button misleading in the first place. */}
        {pathname === "/compare" && (
          <Button
            onClick={clearComparison}
            disabled={comparison === null && compareQuestion.trim().length === 0}
            title={comparison === null ? "No results to clear" : "Clear comparison results"}
            className="shrink-0 px-3! py-1.5! whitespace-nowrap"
          >
            <span className="text-xs">Clear results</span>
          </Button>
        )}

        {/* Desktop nav. No "History" item — cross-session history is not built. */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map(({ href, label }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent-soft text-accent"
                    : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function MobileNav({ onOpenUpload }: { onOpenUpload: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-surface-card pb-[env(safe-area-inset-bottom)] md:hidden">
      {NAV_ITEMS.map(({ href, label, Icon }, index) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
              index === 0 ? "pr-8" : "pl-8"
            } ${isActive ? "text-accent" : "text-text-muted"}`}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        );
      })}

      {/* Raised centre action — opens the Add documents sheet. It stays a "+"
          rather than swapping to an "×": the sheet is full-screen and covers
          this bar, so the close state was never actually visible. The sheet's
          own header × is the close control. */}
      <button
        type="button"
        onClick={onOpenUpload}
        aria-label="Add documents"
        className="absolute -top-5 left-1/2 grid size-13 -translate-x-1/2 place-items-center rounded-full bg-accent text-accent-contrast shadow-[0_4px_14px_rgba(158,82,40,0.32)] transition-colors hover:bg-accent-hover"
      >
        <PlusIcon className="size-6" />
      </button>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */

export function AppProviders({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [totals, setTotals] = useState(EMPTY_TOTALS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [isConversationRestored, setIsConversationRestored] = useState(false);

  // Restore after mount, never during render: the server has no sessionStorage,
  // so reading it in a state initializer would desync hydration.
  useEffect(() => {
    const stored = readStoredConversation();
    if (stored.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(stored);
    }
    setIsConversationRestored(true);
  }, []);

  // Gated on the restore having run, so the initial empty state can't overwrite
  // a stored transcript before it's been read back.
  useEffect(() => {
    if (!isConversationRestored) return;
    try {
      sessionStorage.setItem(CONVERSATION_KEY, JSON.stringify(forStorage(messages)));
    } catch {
      // Quota exceeded or storage blocked — persistence is best-effort only.
    }
  }, [messages, isConversationRestored]);

  const ask = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const pendingId = `pending-${Date.now()}`;
    setIsAsking(true);
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, kind: "user", text: trimmed, time: nowLabel() },
      { id: pendingId, kind: "pending" },
    ]);

    let resolved: ChatMessage;
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = (await response.json()) as QueryResponse & { error?: string };

      resolved = response.ok
        ? {
            id: pendingId,
            kind: "answer",
            answer: body.answer,
            // Defaulted rather than assumed, so a response from an older
            // deployment still renders as an answer instead of a blank card.
            answerSource: body.answerSource ?? (body.citations?.length ? "documents" : "none"),
            citations: body.citations ?? [],
            documentsNotCovered: body.documentsNotCovered ?? [],
          }
        : {
            id: pendingId,
            kind: "error",
            message: body.error ?? "Failed to answer the question.",
          };
    } catch {
      resolved = { id: pendingId, kind: "error", message: "Couldn't reach the server." };
    }

    setMessages((current) => current.map((msg) => (msg.id === pendingId ? resolved : msg)));
    setIsAsking(false);
  }, []);

  const [comparison, setComparison] = useState<CompareResponse | null>(null);
  const [compareQuestion, setCompareQuestion] = useState("");
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const runComparison = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    setIsComparing(true);
    setCompareError(null);
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = (await response.json()) as CompareResponse & { error?: string };

      if (!response.ok) setCompareError(body.error ?? "Failed to run the comparison.");
      else setComparison(body);
    } catch {
      setCompareError("Couldn't reach the server.");
    } finally {
      setIsComparing(false);
    }
  }, []);

  /** Full reset of the page — results, the question in the box, and any error. */
  const clearComparison = useCallback(() => {
    setComparison(null);
    setCompareQuestion("");
    setCompareError(null);
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    try {
      // Drop the key outright, so a reload can't resurrect what was just cleared.
      sessionStorage.removeItem(CONVERSATION_KEY);
    } catch {
      // Storage blocked — in-memory clear above is what matters.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const body = (await response.json()) as DocumentsResponse & { error?: string };

      if (!response.ok) {
        setError(body.error ?? "Failed to load documents.");
        return;
      }

      setDocuments(body.documents);
      setTotals(body.totals);
      setError(null);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load the document list once on mount. `refresh` only calls setState after
  // awaiting the fetch, so there are no cascading synchronous renders here —
  // the lint rule can't see past the async boundary.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const value = useMemo<AppContextValue>(
    () => ({
      documents,
      totals,
      isLoading,
      error,
      refresh,
      openUpload: () => setIsUploadOpen(true),
      messages,
      isAsking,
      ask,
      clearConversation,
      comparison,
      compareQuestion,
      setCompareQuestion,
      isComparing,
      compareError,
      runComparison,
      clearComparison,
    }),
    [
      documents,
      totals,
      isLoading,
      error,
      refresh,
      messages,
      isAsking,
      ask,
      clearConversation,
      comparison,
      compareQuestion,
      isComparing,
      compareError,
      runComparison,
      clearComparison,
    ]
  );

  return (
    <AppContext.Provider value={value}>
      {/* Full-bleed at every breakpoint — the app surface is the page, with no
          centered container or outer page background showing at the sides. */}
      <div className="flex w-full flex-1 flex-col overflow-hidden bg-surface-card">
        <Header />
        <main className="flex min-h-0 flex-1 flex-col pb-20 md:pb-0">{children}</main>
      </div>

      <MobileNav onOpenUpload={() => setIsUploadOpen(true)} />

      <Dialog
        open={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        title="Add documents"
        variant="fullscreen"
        labelledBy="add-documents-title"
      >
        <UploadPanel variant="dialog" onDocumentIngested={refresh} />
      </Dialog>
    </AppContext.Provider>
  );
}
