/**
 * The small slice of Markdown the answer model actually emits.
 *
 * Answers came back with `**bold**` and `1.` lists rendered as literal
 * asterisks, because the transcript drew them as plain text. Stripping the
 * markup at the prompt would have been simpler, but the structure earns its
 * place — the CN VII muscle groups and the taste pathway read as lists because
 * they are lists — so it gets parsed instead.
 *
 * Deliberately not a Markdown library: this needs bold, italic, bullets,
 * numbers and the app's own `[n]` citation markers, and nothing here is ever
 * turned into raw HTML — the renderer builds React elements, so there's no
 * injection surface to defend.
 */

export type InlineSpan =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "citation"; index: number };

export type Block =
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "list"; ordered: boolean; items: InlineSpan[][] };

/** `- item`, `* item`, `• item` — the space is required, so `*italic*` is safe. */
const BULLET = /^\s*[-*•]\s+/;
/** `1. item` or `1) item`. */
const ORDERED = /^\s*\d+[.)]\s+/;
/** `## Heading` — rendered as an emphasised line rather than a real heading. */
const HEADING = /^\s*#{1,6}\s+/;

/**
 * Bold before italic, so `**x**` isn't read as an empty italic. Italic spans
 * can't cross a line, which keeps a stray asterisk from swallowing a paragraph,
 * and can't start or end against another asterisk — otherwise an unclosed `**`
 * pairs with the next lone `*` and italicises the text between two typos.
 */
const INLINE =
  /\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)([^_\n]+?)(?<!_)_(?!_)|\[(\d+)\]/g;

/** Splits one line into text, bold, italic and citation-marker spans. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let lastIndex = 0;

  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(text); match !== null; match = INLINE.exec(text)) {
    if (match.index > lastIndex) {
      spans.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }

    const [, strongStars, strongUnderscores, emStar, emUnderscore, citation] = match;
    if (strongStars !== undefined || strongUnderscores !== undefined) {
      spans.push({ kind: "strong", text: (strongStars ?? strongUnderscores)! });
    } else if (emStar !== undefined || emUnderscore !== undefined) {
      spans.push({ kind: "em", text: (emStar ?? emUnderscore)! });
    } else if (citation !== undefined) {
      spans.push({ kind: "citation", index: Number(citation) });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    spans.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return spans;
}

/**
 * Groups an answer into paragraphs and lists.
 *
 * Consecutive list items of the same kind become one list; a blank line ends
 * whatever is open. Plain lines are joined back together with their newlines
 * intact, so the renderer's `whitespace-pre-wrap` still holds the model's own
 * line breaks.
 */
export function parseAnswer(answer: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: InlineSpan[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const line of answer.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const ordered = ORDERED.test(line);
    const bulleted = !ordered && BULLET.test(line);

    if (ordered || bulleted) {
      flushParagraph();
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(parseInline(line.replace(ordered ? ORDERED : BULLET, "")));
      continue;
    }

    flushList();
    // A heading has no separate block type; it reads as its own bold line.
    paragraph.push(HEADING.test(line) ? `**${line.replace(HEADING, "")}**` : line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
