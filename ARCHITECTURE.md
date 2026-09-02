# How this app works (plain-English tour)

One-sentence version: **you upload PDFs, the app reads and indexes them, and
then you can ask questions and get answers that quote exactly where in the
document each fact came from.**

There are three things happening under the hood: **uploading**, **asking**,
and **managing your document list**. Everything else in the codebase exists
to support one of those three.

---

## 1. Uploading a document (`/api/ingest`)

Think of this as a librarian who reads a new book and makes index cards for it.

1. You pick a PDF in the browser.
2. The server reads the text out of it, **page by page** (so it always knows
   "this sentence came from page 3").
3. Each page's text gets chopped into smaller pieces — about 800 characters
   each, with a little overlap between pieces so a sentence never gets cut
   in a way that loses its meaning.
4. Each piece gets turned into an "embedding" — a list of ~1500 numbers that
   represents *what that piece of text means*, not just the words in it.
   This is what lets the app later search by meaning, not just keyword
   matching.
5. Every piece (its text + its embedding + which file/page it came from) gets
   saved as one row in a Supabase table called `documents`.

Result: one PDF becomes many small "index cards" in the database, each one
searchable by meaning.

## 2. Asking a question (`/api/query`)

Think of this as a researcher who only answers using the index cards — never
from memory.

1. Your question also gets turned into one of those "meaning" embeddings.
2. The app asks the database: "which 5 index cards are most related to this
   question?" — using **two search methods at once**:
   - **Meaning search** (vector similarity) — finds cards about the same
     topic, even if they don't share exact words.
   - **Keyword search** (full-text) — finds cards containing the literal
     words from the question.
   These two ranked lists get merged into one (a technique called RRF), so a
   card that both methods agree on floats to the top.
3. Any card that isn't actually similar enough gets thrown out here — this is
   a safety net so a question about something totally unrelated to your
   documents doesn't get forced into an answer.
4. The surviving cards get handed to the AI model with a strict instruction:
   *"only answer using what's in these cards, and say so plainly if the
   answer isn't in them."*
5. The AI has to answer in a fixed shape: `{ answer, citations }`, where each
   citation names the exact file, page, and quoted sentence it used. This
   isn't optional formatting — the AI is forced into that shape, so the app
   never has to guess how to parse a free-form reply.

If nothing survives step 3, the AI is never even called — the app just says
"nothing relevant was found," rather than letting the AI improvise an answer.

## 3. Managing documents (`/api/documents`)

Two small routes that just read/delete from the same `documents` table:

- `GET /api/documents` — since every "index card" already stores which file
  it came from, this route groups them back up by filename and reports
  "here are your documents, with how many pages/pieces each one has."
- `DELETE /api/documents/:filename` — deletes every index card that belongs
  to one file, so its content stops being searchable.

---

## The database side (Supabase)

One table, `documents` — one row per "index card" (not one row per PDF).
Each row has: the text, which file/page it came from, its embedding, and a
generated search-friendly version of the text for keyword matching.

Two search functions live in the database itself (so the heavy lifting
happens close to the data, not in JavaScript):

- `match_documents` — the original, simple version (meaning-search only).
  Kept around untouched, unused by the current app, as a fallback/comparison.
- `hybrid_search_documents` — the one `/api/query` actually calls. Combines
  meaning search + keyword search as described above, and also reports a
  plain "how similar is this, 0 to 1" number per result — that's the number
  used for the safety-net filter in step 3 above.

## The "brain" (`lib/models.ts`)

One file, four AI-related exports, each with a specific job:
- `embeddings` — turns text into "meaning numbers." Used for both indexing
  documents and understanding questions, so they land in the same
  searchable space.
- `queryModel` — the AI model that actually writes answers (OpenAI
  `gpt-4o-mini`). Deliberately not Groq, to avoid rate-limit trouble.
- `groqModel` — kept from earlier project work, not currently used by
  ingest/query.
- `supabaseAdmin` / `supabase` — the two ways of talking to the database;
  the app-facing routes always use `supabaseAdmin` since regular row-level
  security would otherwise block server-side writes.

## The frontend (what you actually see)

- **`app/layout.tsx`** — the outer shell: fonts, page background, and it
  wraps everything in `AppProviders`.
- **`components/app-providers.tsx`** — the one place that knows "what
  documents exist right now." It fetches the document list once, shares it
  with every page (via React context), and owns the header/nav bar and the
  "Add documents" popup so they work the same everywhere.
- **`app/page.tsx`** — the "Ask" screen: the chat-style conversation, one
  message at a time, calling `/api/query` and rendering the result.
- **`app/documents/page.tsx`** — the "Documents" screen: a table (or list, on
  mobile) of everything ingested, with delete buttons.
- **`components/upload-panel.tsx` + `use-file-upload.ts`** — the upload
  widget (drag-and-drop or file picker) and the logic that sends files to
  `/api/ingest` one at a time and tracks each one's progress.
- **`components/conversation.tsx`** — how each chat message actually looks:
  a normal answer (with citation numbers baked into the text), a "not found"
  warning card, a "thinking…" placeholder, or an error bubble.
- **`components/citations.tsx`** — the citation card itself (filename, page,
  quoted text, copy button), reused both inline (1 source) and in a
  popup/sheet (2+ sources).
- **`components/ui.tsx`** — generic reusable pieces (buttons, the
  modal/sheet dialog, the copy-to-clipboard button) with no document-specific
  knowledge — pure building blocks.

Nothing in the frontend calls the database directly — every screen only ever
talks to the three API routes above.

---

## Known rough edges right now

- The "how similar is a match, really" safety net (`MIN_SIMILARITY` in
  `app/api/query/route.ts`) is a starting guess, not a tuned value.
- As of the last check, the SQL update that makes that safety net possible
  (adding a `similarity` number to `hybrid_search_documents`) may not have
  been re-run in the Supabase SQL editor yet — if every question comes back
  "not found" even for things clearly in an uploaded PDF, that's the first
  thing to check.
- No chat history across sessions, no streaming answers, no re-ranking
  beyond the hybrid search — all deliberately out of scope so far.
