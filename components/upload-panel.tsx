"use client";

import { useRef, useState } from "react";
import { Button } from "./ui";
import { AlertCircleIcon, CheckIcon, DocumentTrayIllustration, FileIcon } from "./icons";
import {
  formatFileSize,
  MAX_FILE_SIZE_MB,
  useFileUpload,
  type UploadItem,
} from "./use-file-upload";

const STATUS_LABEL: Record<UploadItem["status"], string> = {
  queued: "Queued",
  uploading: "Uploading…",
  processing: "Extracting, chunking, embedding…",
  done: "Indexed",
  error: "Failed",
};

function UploadRow({ item }: { item: UploadItem }) {
  const isBusy = item.status === "uploading" || item.status === "processing";

  return (
    <li className="rounded-lg border border-border bg-surface-card px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft">
          {item.status === "done" ? (
            <CheckIcon className="size-3.5 text-accent" />
          ) : item.status === "error" ? (
            <AlertCircleIcon className="size-3.5 text-danger" />
          ) : (
            <FileIcon className="size-3.5 text-accent" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-text-primary">{item.name}</span>
          <span className="block text-xs text-text-muted">
            {formatFileSize(item.size)}
            {item.status === "done" && item.result
              ? ` · ${item.result.pagesProcessed} pages · ${item.result.chunksCreated} chunks`
              : ` · ${STATUS_LABEL[item.status]}`}
          </span>
        </span>
      </div>

      {isBusy && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className={`h-full bg-accent transition-[width] duration-200 ${
              item.status === "processing" ? "animate-dot" : ""
            }`}
            style={{ width: `${item.status === "processing" ? 100 : item.progress}%` }}
          />
        </div>
      )}

      {item.status === "error" && item.error && (
        <p className="mt-1.5 text-xs text-danger">{item.error}</p>
      )}
    </li>
  );
}

export function UploadPanel({
  variant = "page",
  onDocumentIngested,
}: {
  /** "page" is the inline empty-state zone; "dialog" is the Add-documents sheet. */
  variant?: "page" | "dialog";
  onDocumentIngested?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { items, isUploading, addFiles } = useFileUpload(onDocumentIngested);

  function openPicker() {
    inputRef.current?.click();
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,application/pdf"
      multiple
      className="hidden"
      onChange={(event) => {
        if (event.target.files) void addFiles(event.target.files);
        event.target.value = ""; // let the same file be picked again after a failure
      }}
    />
  );

  const dropHandlers = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(true);
    },
    onDragLeave: () => setIsDragging(false),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
    },
  };

  const queue = items.length > 0 && (
    <ul className="mt-4 flex flex-col gap-2">
      {items.map((item) => (
        <UploadRow key={item.id} item={item} />
      ))}
    </ul>
  );

  if (variant === "dialog") {
    return (
      <div>
        {fileInput}

        <div
          {...dropHandlers}
          className={`rounded-xl border border-dashed px-6 py-7 text-center transition-colors ${
            isDragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-2"
          }`}
        >
          <DocumentTrayIllustration className="mx-auto h-24 w-32" />
          <h3 className="mt-3 font-serif text-xl text-text-primary">Add your documents</h3>
          <p className="mx-auto mt-1 max-w-[19rem] text-sm text-text-secondary">
            Drag &amp; drop files here, or pick them from your device.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={openPicker}
          disabled={isUploading}
          className="mt-4 w-full py-2.5!"
        >
          {isUploading ? "Uploading…" : "Choose files"}
        </Button>

        <div className="mt-4 rounded-xl border border-border bg-surface-card px-4 py-3.5">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
            Supported formats
          </p>
          <p className="mt-2">
            <span className="inline-flex rounded-md border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-primary">
              PDF
            </span>
          </p>
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-sm text-text-primary">Max {MAX_FILE_SIZE_MB}MB each</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Text is extracted, chunked, and embedded after upload.
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-warn-border bg-warn-bg px-4 py-3">
          <AlertCircleIcon className="mt-px size-4 shrink-0 text-warn-text" />
          <p className="text-xs text-warn-text">
            Scanned PDFs without a text layer can&apos;t be searched yet.
          </p>
        </div>

        {queue}
      </div>
    );
  }

  return (
    <div>
      {fileInput}

      <div
        {...dropHandlers}
        className={`rounded-xl border border-dashed px-6 py-7 transition-colors sm:px-8 ${
          isDragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-2"
        }`}
      >
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:gap-7 sm:text-left">
          <DocumentTrayIllustration className="h-28 w-40 shrink-0 rounded-lg bg-surface-3/60" />

          <div className="min-w-0">
            <h2 className="font-serif text-2xl text-text-primary">Add your documents</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Drag &amp; drop files here or{" "}
              <button
                type="button"
                onClick={openPicker}
                className="text-accent underline underline-offset-2 hover:text-accent-hover"
              >
                browse
              </button>
            </p>
            <p className="mt-1 text-xs text-text-muted">
              PDF &nbsp;•&nbsp; Max {MAX_FILE_SIZE_MB}MB each
            </p>

            <Button
              variant="primary"
              onClick={openPicker}
              disabled={isUploading}
              className="mt-4 px-5! py-2.5!"
            >
              {isUploading ? "Uploading…" : "Choose files"}
            </Button>
          </div>
        </div>

        {queue}
      </div>
    </div>
  );
}
