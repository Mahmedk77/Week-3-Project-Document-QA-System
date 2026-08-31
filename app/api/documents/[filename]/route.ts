import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/models";

export const runtime = "nodejs";

/**
 * DELETE /api/documents/:filename — removes every chunk of one document.
 *
 * NEW route (the Documents page had no backend). Filename is the identity here
 * because `documents` stores one row per chunk with no per-document table, so
 * there is no document-level id to address. The path segment is URL-encoded by
 * the client and decoded by Next before it reaches `params`.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    if (!filename.trim()) {
      return NextResponse.json({ error: "A filename is required." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("documents")
      .delete()
      .eq("metadata->>filename", filename)
      .select("id");

    if (error) throw error;

    const deleted = data?.length ?? 0;
    if (deleted === 0) {
      return NextResponse.json(
        { error: `No document named "${filename}" was found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ filename, chunksDeleted: deleted });
  } catch (error) {
    console.error("[/api/documents/:filename] delete failed:", error);
    return NextResponse.json({ error: "Failed to delete the document." }, { status: 500 });
  }
}
