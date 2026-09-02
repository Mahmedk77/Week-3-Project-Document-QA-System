import { NextRequest, NextResponse } from "next/server";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { embeddings, supabaseAdmin } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const INSERT_BATCH_SIZE = 100;

interface ChunkMetadata {
  filename: string;
  pageNumber: number;
  uploadedAt: string;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No PDF file was provided under the 'file' field." },
        { status: 400 }
      );
    }

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json({ error: "Only PDF files are accepted." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB size limit.` },
        { status: 400 }
      );
    }

    // Filename is the document's identity everywhere else in the app — the
    // Documents page aggregates chunks by it, and DELETE addresses by it — so
    // a second upload under the same name silently doubles a document's chunks
    // instead of appearing as its own row. Rejected here, before any parsing,
    // embedding, or inserts: no point paying for that work only to refuse.
    const { data: existing, error: duplicateCheckError } = await supabaseAdmin
      .from("documents")
      .select("id")
      .eq("metadata->>filename", file.name)
      .limit(1);

    if (duplicateCheckError) throw duplicateCheckError;

    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          error: `A document named "${file.name}" already exists. Delete the existing one first, or rename this file before uploading.`,
        },
        { status: 409 }
      );
    }

    const data = new Uint8Array(await file.arrayBuffer());

    const parser = new PDFParse({ data });
    let pages: { num: number; text: string }[];
    try {
      const result = await parser.getText();
      pages = result.pages;
    } finally {
      await parser.destroy();
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });

    const uploadedAt = new Date().toISOString();
    const chunkTexts: string[] = [];
    const chunkMetadata: ChunkMetadata[] = [];

    for (const page of pages) {
      if (!page.text.trim()) continue;
      const pageChunks = await splitter.splitText(page.text);
      for (const chunk of pageChunks) {
        chunkTexts.push(chunk);
        chunkMetadata.push({
          filename: file.name,
          pageNumber: page.num,
          uploadedAt,
        });
      }
    }

    if (chunkTexts.length === 0) {
      return NextResponse.json(
        { error: "No extractable text was found in this PDF." },
        { status: 400 }
      );
    }

    const vectors = await embeddings.embedDocuments(chunkTexts);

    const rows = chunkTexts.map((content, i) => ({
      content,
      metadata: chunkMetadata[i],
      embedding: vectors[i],
    }));

    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      const { error: insertError } = await supabaseAdmin.from("documents").insert(batch);
      if (insertError) {
        throw insertError;
      }
    }

    return NextResponse.json({
      filename: file.name,
      chunksCreated: chunkTexts.length,
      pagesProcessed: pages.length,
    });
  } catch (error) {
    console.error("[/api/ingest] failed:", error);
    return NextResponse.json(
      { error: "Failed to process the document. Please try again." },
      { status: 500 }
    );
  }
}
