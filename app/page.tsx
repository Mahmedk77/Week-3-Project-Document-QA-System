"use client";

import { useRef, useState } from "react";

type Status = "idle" | "uploading" | "processing" | "done" | "error";

interface IngestSummary {
  filename: string;
  chunksCreated: number;
  pagesProcessed: number;
}

const STATUS_LABEL: Record<Status, string> = {
  idle: "",
  uploading: "Uploading…",
  processing: "Processing document…",
  done: "Done",
  error: "Error",
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<IngestSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isBusy = status === "uploading" || status === "processing";

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setStatus("idle");
    setSummary(null);
    setErrorMessage(null);
    setProgress(0);
  }

  function handleUpload() {
    if (!file) return;

    setStatus("uploading");
    setErrorMessage(null);
    setSummary(null);
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/ingest");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.upload.onload = () => setStatus("processing");

    xhr.onload = () => {
      let body: IngestSummary & { error?: string };
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        setErrorMessage("Unexpected response from server.");
        setStatus("error");
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        setSummary(body);
        setStatus("done");
      } else {
        setErrorMessage(body.error ?? "Upload failed.");
        setStatus("error");
      }
    };

    xhr.onerror = () => {
      setErrorMessage("Network error while uploading.");
      setStatus("error");
    };

    xhr.send(formData);
  }

  function handleReset() {
    setFile(null);
    setStatus("idle");
    setSummary(null);
    setErrorMessage(null);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Document Q&A</h1>
        <p className="mt-1 text-sm text-text-primary/70">
          Upload a PDF to add it to the knowledge base.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface-1 p-6">
        <label className="block text-sm font-medium text-text-primary" htmlFor="pdf-upload">
          PDF file
        </label>
        <input
          ref={inputRef}
          id="pdf-upload"
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileChange}
          disabled={isBusy}
          className="mt-2 block w-full text-sm text-text-primary file:mr-4 file:rounded-md file:border file:border-border file:bg-bg-page file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text-primary hover:file:bg-white disabled:opacity-50"
        />

        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || isBusy}
          className="mt-4 w-full rounded-md bg-text-primary px-4 py-2 text-sm font-medium text-bg-page transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isBusy ? STATUS_LABEL[status] : "Upload"}
        </button>

        {status === "uploading" && (
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-text-primary transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {status === "processing" && (
          <p className="mt-4 text-sm text-text-primary/70">
            Extracting text, chunking, and embedding — this can take a moment for larger files.
          </p>
        )}

        {status === "done" && summary && (
          <div className="mt-4 rounded-md border border-border bg-bg-page p-4 text-sm text-text-primary">
            <p className="font-medium">Ingested {summary.filename}</p>
            <p className="mt-1 text-text-primary/70">
              {summary.pagesProcessed} page{summary.pagesProcessed === 1 ? "" : "s"} processed,{" "}
              {summary.chunksCreated} chunk{summary.chunksCreated === 1 ? "" : "s"} created.
            </p>
            <button
              type="button"
              onClick={handleReset}
              className="mt-3 text-sm font-medium underline underline-offset-2"
            >
              Upload another
            </button>
          </div>
        )}

        {status === "error" && errorMessage && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            <p>{errorMessage}</p>
            <button
              type="button"
              onClick={handleReset}
              className="mt-3 text-sm font-medium underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
