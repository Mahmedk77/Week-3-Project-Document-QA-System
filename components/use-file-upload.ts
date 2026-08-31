"use client";

import { useCallback, useState } from "react";
import type { IngestResponse } from "@/lib/documents";

/** Mirrors MAX_FILE_SIZE_BYTES in app/api/ingest/route.ts. */
export const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export type UploadStatus = "queued" | "uploading" | "processing" | "done" | "error";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  progress: number;
  error?: string;
  result?: IngestResponse;
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/**
 * Uploads PDFs to the existing `/api/ingest` route.
 *
 * `/api/ingest` takes exactly one file per request, so a multi-file selection
 * is sent as a sequential queue of single-file requests — the route itself is
 * untouched. XHR (not fetch) so the real upload progress bar from the original
 * upload page still works.
 */
export function useFileUpload(onDocumentIngested?: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );
  }, []);

  const uploadOne = useCallback(
    (item: UploadItem, file: File) =>
      new Promise<void>((resolve) => {
        patch(item.id, { status: "uploading", progress: 0 });

        const formData = new FormData();
        formData.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/ingest");

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            patch(item.id, { progress: Math.round((event.loaded / event.total) * 100) });
          }
        };

        xhr.upload.onload = () => patch(item.id, { status: "processing", progress: 100 });

        xhr.onload = () => {
          let body: IngestResponse & { error?: string };
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            patch(item.id, { status: "error", error: "Unexpected response from server." });
            resolve();
            return;
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            patch(item.id, { status: "done", result: body });
            onDocumentIngested?.();
          } else {
            patch(item.id, { status: "error", error: body.error ?? "Upload failed." });
          }
          resolve();
        };

        xhr.onerror = () => {
          patch(item.id, { status: "error", error: "Network error while uploading." });
          resolve();
        };

        xhr.send(formData);
      }),
    [patch, onDocumentIngested]
  );

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const queued = files.map<{ item: UploadItem; file: File }>((file) => {
        const item: UploadItem = {
          id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          size: file.size,
          status: "queued",
          progress: 0,
        };

        // Rejected client-side against the same rules the route enforces, so an
        // obviously-invalid file never costs a round trip.
        if (!isPdf(file)) {
          item.status = "error";
          item.error = "Only PDF files are accepted.";
        } else if (file.size > MAX_FILE_SIZE_BYTES) {
          item.status = "error";
          item.error = `Larger than the ${MAX_FILE_SIZE_MB}MB limit.`;
        }

        return { item, file };
      });

      setItems((current) => [...current, ...queued.map(({ item }) => item)]);

      const sendable = queued.filter(({ item }) => item.status === "queued");
      if (sendable.length === 0) return;

      setIsUploading(true);
      for (const { item, file } of sendable) {
        await uploadOne(item, file);
      }
      setIsUploading(false);
    },
    [uploadOne]
  );

  const clear = useCallback(() => setItems([]), []);

  return { items, isUploading, addFiles, clear };
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
