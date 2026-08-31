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
import type { DocumentSummary, DocumentsResponse } from "@/lib/documents";
import { ChatIcon, CloseIcon, FolderIcon, PlusIcon } from "./icons";
import { Dialog } from "./ui";
import { UploadPanel } from "./upload-panel";

interface AppContextValue {
  documents: DocumentSummary[];
  totals: DocumentsResponse["totals"];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  openUpload: () => void;
}

const EMPTY_TOTALS = { documents: 0, pages: 0, chunks: 0 };

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

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3.5 sm:px-6">
      <Link href="/" className="flex items-center gap-2">
        <ChatIcon className="size-5 text-accent" />
        <span className="font-serif text-lg font-semibold text-text-primary">DocuSearch</span>
      </Link>

      <div className="flex items-center gap-3">
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

        {/* Decorative avatar from the mockups — this build has no accounts. */}
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-contrast"
        >
          SP
        </span>
      </div>
    </header>
  );
}

function MobileNav({ isUploadOpen, onToggleUpload }: { isUploadOpen: boolean; onToggleUpload: () => void }) {
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

      {/* Raised centre action — opens the Add documents sheet, and turns into
          its close control while that sheet is open. */}
      <button
        type="button"
        onClick={onToggleUpload}
        aria-label={isUploadOpen ? "Close add documents" : "Add documents"}
        className="absolute -top-5 left-1/2 grid size-13 -translate-x-1/2 place-items-center rounded-full bg-accent text-accent-contrast shadow-[0_4px_14px_rgba(158,82,40,0.32)] transition-colors hover:bg-accent-hover"
      >
        {isUploadOpen ? <CloseIcon className="size-5" /> : <PlusIcon className="size-6" />}
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
    }),
    [documents, totals, isLoading, error, refresh]
  );

  return (
    <AppContext.Provider value={value}>
      {/* Full-bleed at every breakpoint — the app surface is the page, with no
          centered container or outer page background showing at the sides. */}
      <div className="flex w-full flex-1 flex-col overflow-hidden bg-surface-card">
        <Header />
        <main className="flex min-h-0 flex-1 flex-col pb-20 md:pb-0">{children}</main>
      </div>

      <MobileNav
        isUploadOpen={isUploadOpen}
        onToggleUpload={() => setIsUploadOpen((open) => !open)}
      />

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
