/**
 * Turning a follow-up into a question retrieval can actually use.
 *
 * "what about her grandmother?" embeds to a vector pointing nowhere in
 * particular, and on the full-text side "her" and "about" are stopwords — so
 * the question has to be rewritten against the conversation *before* anything
 * is embedded. The user's original wording still goes to the answering step, so
 * a bad rewrite degrades retrieval rather than silently changing the question
 * that gets answered.
 *
 * Deliberately not LangChain's memory classes: those are concrete only in the
 * `langchain` package, which isn't installed here (and pulling it in risks the
 * zod peer conflict that already blocked @langchain/community), and they exist
 * to feed the Chain abstraction this app doesn't use. The transcript is already
 * held in the browser; it just needed to be sent.
 */

import { z } from "zod";
import { queryModel } from "@/lib/models";
import type { ChatTurn } from "@/lib/documents";

/** References to a person. Never resolvable from the library alone. */
const PERSONAL_DEICTIC = /\b(he|him|his|she|her|hers|they|them|their|theirs)\b/i;

/** References to a thing. In a one-document library, "it" is that document. */
const IMPERSONAL_DEICTIC = /\b(it|its|that|this|those|these|there|then|one|ones|same)\b/i;

/** Pronouns and demonstratives that have to point at something said earlier. */
const DEICTIC = new RegExp(`${PERSONAL_DEICTIC.source}|${IMPERSONAL_DEICTIC.source}`, "i");

/** Openers that continue a previous thought rather than starting a new one. */
const CONTINUATION = /^(and|but|so|then|also|why|ok|okay|what about|how about|any more|more)\b/i;

/** Below this, a question rarely carries enough of its own context to stand alone. */
const STANDALONE_WORD_COUNT = 7;

/**
 * Whether a question looks like it depends on what was said before.
 *
 * A gate, not a judgement: the resolver costs an LLM round-trip, and the great
 * majority of questions are the first in their conversation. Erring toward
 * firing is cheap (the resolver returns the question unchanged), so this is
 * deliberately loose.
 */
export function looksContextDependent(question: string): boolean {
  const trimmed = question.trim();
  if (trimmed.length === 0) return false;
  return (
    CONTINUATION.test(trimmed) ||
    DEICTIC.test(trimmed) ||
    trimmed.split(/\s+/).length <= STANDALONE_WORD_COUNT
  );
}

/** Short enough that a pronoun is doing all the work — "what about her?". */
const BARE_REFERENCE_WORD_LIMIT = 4;

/**
 * Classifies a question that is nothing but a reference, asked with no
 * conversation behind it — there is no antecedent to find, so asking beats
 * retrieving on a pronoun and presenting whatever comes back as though it were
 * the thing the user meant.
 *
 * The two kinds are treated differently because their ambiguity is: "what about
 * her?" is unanswerable however many documents are loaded, while "how does it
 * end" is only ambiguous when there's more than one book it could mean — the
 * caller resolves that, since it knows the library and this doesn't.
 *
 * Kept narrow on purpose: "what does it say about debt" has a real subject and
 * is worth attempting, so only near-empty references qualify.
 */
export function bareReferenceKind(question: string): "personal" | "impersonal" | null {
  const trimmed = question.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.split(/\s+/).length > BARE_REFERENCE_WORD_LIMIT) return null;
  if (PERSONAL_DEICTIC.test(trimmed)) return "personal";
  if (IMPERSONAL_DEICTIC.test(trimmed)) return "impersonal";
  return null;
}

const resolutionSchema = z.object({
  /** The question, rewritten to stand on its own. Echoes the input if it already did. */
  standaloneQuestion: z.string(),
  /** True when nothing in the conversation says what the question refers to. */
  needsClarification: z.boolean(),
  /** The question to ask back. Only read when needsClarification is true. */
  clarification: z.string(),
});

const RESOLVER_PROMPT = `You rewrite a follow-up question so it can stand on its own, for a search over the user's documents.

Rules:
- Replace pronouns and references ("her", "that", "it", "the second one") with what they refer to, taken from the conversation above. "What about her grandmother?" after a question about Nastenka becomes "What is Nastenka's grandmother like in White Nights?".
- If the question already stands on its own, return it unchanged. Do not embellish it.
- Keep the user's scope and intent. Never add a topic, document or detail they did not ask about, and never answer the question.
- Only ever resolve a reference to something actually present in the conversation. Inventing a plausible antecedent is the specific failure this step exists to prevent.

When to ask for clarification (needsClarification):
- Only when the question contains a reference word — it, that, her, him, they, the second one — whose target is genuinely absent from the conversation.
- A question that already stands on its own is NEVER a candidate for clarification, no matter how broad it sounds. "And what causes empires to decline?" is complete: the leading "and" is a conversational join, not a reference. Broad is not the same as ambiguous, and asking someone to narrow a question they asked perfectly well is worse than answering it.
- When you do ask, ask about the reference itself — "Who does 'her' refer to?" — not about the topic of the previous answer. The user's word is what's unresolved; the earlier subject is exactly what it is not.
- When clarifying, still echo the original question as standaloneQuestion.`;

/**
 * Rewrites `question` against `history`, or asks for clarification.
 *
 * Falls back to the original question if the model call fails: a follow-up
 * answered with weak retrieval is a better outcome than an error page.
 */
export async function resolveFollowUp(
  question: string,
  history: ChatTurn[]
): Promise<{ standaloneQuestion: string; clarification: string | null }> {
  try {
    const resolver = queryModel.withStructuredOutput(resolutionSchema);
    const conversation = history
      .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
      .join("\n\n");

    const result = await resolver.invoke([
      { role: "system", content: RESOLVER_PROMPT },
      {
        role: "user",
        content: `Conversation so far:\n\n${conversation}\n\nFollow-up question: ${question}`,
      },
    ]);

    const rewritten = result.standaloneQuestion.trim();
    return {
      standaloneQuestion: rewritten.length > 0 ? rewritten : question,
      clarification:
        result.needsClarification && result.clarification.trim().length > 0
          ? result.clarification.trim()
          : null,
    };
  } catch (error) {
    console.error("[follow-up] resolution failed, using the question as typed:", error);
    return { standaloneQuestion: question, clarification: null };
  }
}
