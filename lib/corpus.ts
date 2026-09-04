/**
 * Corpus-level reads over the chunk table.
 *
 * `documents` holds one row per chunk, with no per-document table, so anything
 * that needs a document-level view has to aggregate. Both callers that do —
 * `GET /api/documents` (full summary) and `/api/query` (just the filenames, for
 * the prompt's library manifest) — share the pager below rather than each
 * writing their own.
 */

import { supabaseAdmin } from "@/lib/models";

/** Supabase caps a single select at 1000 rows, so chunk rows are walked in pages. */
const PAGE_SIZE = 1000;

/** How long the filename list is reused before being re-read. */
const FILENAME_CACHE_TTL_MS = 60_000;

export interface ChunkMetadataRow {
  id: number;
  metadata: { filename?: string; pageNumber?: number; uploadedAt?: string } | null;
}

/**
 * Every chunk row's metadata, paged.
 *
 * Only `metadata` is selected — never `content` or the 1536-dim `embedding` —
 * so each page stays small.
 */
export async function fetchChunkMetadataRows(): Promise<ChunkMetadataRow[]> {
  const rows: ChunkMetadataRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("documents")
      .select("id, metadata")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data ?? []) as ChunkMetadataRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

let filenameCache: { at: number; filenames: string[] } | null = null;

/**
 * Distinct document filenames, cached briefly.
 *
 * This runs on every `/api/query` call to build the library manifest, and the
 * answer only changes on upload or delete — so a short TTL keeps a full
 * metadata scan off the hot path. Stale by up to a minute is harmless here: the
 * worst case is a just-uploaded file missing from the manifest for one question,
 * while retrieval itself (which never reads this) already sees its chunks.
 */
export async function listDocumentFilenames(): Promise<string[]> {
  if (filenameCache && Date.now() - filenameCache.at < FILENAME_CACHE_TTL_MS) {
    return filenameCache.filenames;
  }

  const rows = await fetchChunkMetadataRows();
  const filenames = [
    ...new Set(
      rows
        .map((row) => row.metadata?.filename)
        .filter((filename): filename is string => Boolean(filename))
    ),
  ];

  filenameCache = { at: Date.now(), filenames };
  return filenames;
}
