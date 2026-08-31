import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/models";
import type { DocumentSummary } from "@/lib/documents";

export const runtime = "nodejs";

// Supabase caps a single select at 1000 rows, so the chunk rows are walked in
// pages. Only `metadata` is selected — never `content` or the 1536-dim
// `embedding` — so each page stays small.
const PAGE_SIZE = 1000;

interface ChunkRow {
  id: number;
  metadata: { filename?: string; pageNumber?: number; uploadedAt?: string } | null;
}

/**
 * GET /api/documents — the list backing the Documents page.
 *
 * NEW route (the Documents page had no backend). It only reads the existing
 * `documents` table; ingest/query and the hybrid_search RPC are untouched.
 *
 * There is no per-document table — `documents` holds one row per chunk — so a
 * "document" here is the set of chunks sharing a filename, aggregated in JS.
 * At a much larger corpus this should become a SQL view or RPC; at this size
 * it avoids adding another manual migration step in the Supabase SQL editor.
 */
export async function GET() {
  try {
    const rows: ChunkRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("documents")
        .select("id, metadata")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;

      const page = (data ?? []) as ChunkRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    const byFilename = new Map<
      string,
      { filename: string; chunks: number; pages: Set<number>; uploadedAt: string | null }
    >();

    for (const row of rows) {
      const filename = row.metadata?.filename;
      if (!filename) continue;

      let entry = byFilename.get(filename);
      if (!entry) {
        entry = { filename, chunks: 0, pages: new Set(), uploadedAt: null };
        byFilename.set(filename, entry);
      }

      entry.chunks += 1;
      if (typeof row.metadata?.pageNumber === "number") {
        entry.pages.add(row.metadata.pageNumber);
      }

      // Earliest timestamp wins, so re-ingesting keeps the original upload date.
      const uploadedAt = row.metadata?.uploadedAt;
      if (uploadedAt && (!entry.uploadedAt || uploadedAt < entry.uploadedAt)) {
        entry.uploadedAt = uploadedAt;
      }
    }

    const documents: DocumentSummary[] = [...byFilename.values()]
      .map((entry) => ({
        filename: entry.filename,
        pages: entry.pages.size,
        chunks: entry.chunks,
        uploadedAt: entry.uploadedAt,
      }))
      .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));

    return NextResponse.json({
      documents,
      totals: {
        documents: documents.length,
        pages: documents.reduce((sum, doc) => sum + doc.pages, 0),
        chunks: documents.reduce((sum, doc) => sum + doc.chunks, 0),
      },
    });
  } catch (error) {
    console.error("[/api/documents] failed:", error);
    return NextResponse.json({ error: "Failed to load documents." }, { status: 500 });
  }
}
