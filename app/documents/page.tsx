"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/app-providers";
import { FileIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Button, Dialog } from "@/components/ui";
import { formatUploadedDate, type DocumentSummary } from "@/lib/documents";

function TotalsLine({ totals }: { totals: { documents: number; pages: number; chunks: number } }) {
  return (
    <p className="mt-1 text-xs text-text-secondary">
      {totals.documents.toLocaleString()} document{totals.documents === 1 ? "" : "s"}
      {/* Page total is dropped on narrow screens to keep the line on one row. */}
      <span className="hidden sm:inline"> · {totals.pages.toLocaleString()} pages</span> ·{" "}
      {totals.chunks.toLocaleString()} chunks indexed
    </p>
  );
}

function DeleteButton({ onClick, filename }: { onClick: () => void; filename: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Delete ${filename}`}
      className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-text-muted transition-colors hover:border-danger/40 hover:bg-danger/5 hover:text-danger"
    >
      <TrashIcon className="size-4" />
    </button>
  );
}

function FileBadge() {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent-soft-border bg-accent-soft text-accent">
      <FileIcon className="size-4" />
    </span>
  );
}

export default function DocumentsPage() {
  const { documents, totals, isLoading, error, refresh, openUpload } = useApp();
  const [pendingDelete, setPendingDelete] = useState<DocumentSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(pendingDelete.filename)}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setDeleteError(body.error ?? "Failed to delete the document.");
        return;
      }

      await refresh();
      setPendingDelete(null);
    } catch {
      setDeleteError("Couldn't reach the server.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    /* Wider cap than the chat column — the table's five columns benefit from
       the extra horizontal room that prose and chat bubbles don't. */
    <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl text-text-primary">Documents</h1>
          <TotalsLine totals={totals} />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Entry point to the retrieval diagnostic. Deliberately lives here
              rather than in the header nav or the 3-item mobile bar — it's a
              testing view, not a product surface. */}
          <Link
            href="/compare"
            className="inline-flex items-center justify-center rounded-lg border border-border-strong bg-surface-card px-3.5 py-2 text-sm font-medium whitespace-nowrap text-text-primary transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="hidden sm:inline">Compare retrieval</span>
            <span className="sm:hidden">Compare</span>
          </Link>

          <Button variant="primary" onClick={openUpload} className="shrink-0">
            <PlusIcon className="size-4" />
            <span className="hidden sm:inline">Upload documents</span>
            <span className="sm:hidden">Upload</span>
          </Button>
        </div>
      </div>

      {/* Reserved for search / sort — intentionally empty in this pass. */}
      <div className="h-11 shrink-0 rounded-xl border border-dashed border-border bg-surface-2/50" />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-warn-border bg-warn-bg px-4 py-2.5">
          <p className="text-sm text-warn-text">{error}</p>
          <Button onClick={() => void refresh()} className="py-1.5!">
            Retry
          </Button>
        </div>
      )}

      <div className="scroll-region min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
        {isLoading ? (
          <p className="p-6 text-sm text-text-muted">Loading documents…</p>
        ) : documents.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="font-serif text-lg text-text-secondary">No documents yet</p>
            <p className="max-w-xs text-xs text-text-muted">
              Upload a PDF to index it and start asking questions.
            </p>
            <Button variant="primary" onClick={openUpload} className="mt-2">
              <PlusIcon className="size-4" />
              Upload documents
            </Button>
          </div>
        ) : (
          <>
            {/* Desktop: table */}
            <table className="hidden w-full border-collapse text-left md:table">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  {["Document", "Pages", "Chunks", "Uploaded", ""].map((heading, i) => (
                    <th
                      key={heading || i}
                      scope="col"
                      className={`px-4 py-2.5 text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase ${
                        i === 1 || i === 2 ? "w-24" : ""
                      }`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.filename} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <FileBadge />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-text-primary">{doc.filename}</p>
                          <p className="text-xs text-text-muted">Indexed</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {doc.pages.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {doc.chunks.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {formatUploadedDate(doc.uploadedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeleteButton
                        filename={doc.filename}
                        onClick={() => {
                          setDeleteError(null);
                          setPendingDelete(doc);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: stacked list */}
            <ul className="flex flex-col md:hidden">
              {documents.map((doc) => (
                <li
                  key={doc.filename}
                  className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
                >
                  <FileBadge />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">{doc.filename}</p>
                    <p className="text-xs text-text-muted">
                      {doc.pages.toLocaleString()} pages · {doc.chunks.toLocaleString()} chunks ·{" "}
                      {formatUploadedDate(doc.uploadedAt, "short")}
                    </p>
                  </div>
                  <DeleteButton
                    filename={doc.filename}
                    onClick={() => {
                      setDeleteError(null);
                      setPendingDelete(doc);
                    }}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => !isDeleting && setPendingDelete(null)}
        title="Delete document"
        labelledBy="delete-document-title"
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={isDeleting}>
              {isDeleting ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          Remove <span className="font-medium text-text-primary">{pendingDelete?.filename}</span>{" "}
          and all {pendingDelete?.chunks.toLocaleString()} of its indexed chunks? Answers will no
          longer be able to cite it. This can&apos;t be undone.
        </p>
        {deleteError && <p className="mt-3 text-sm text-danger">{deleteError}</p>}
      </Dialog>
    </div>
  );
}
