"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-providers";
import { AlertCircleIcon, FileIcon, SendIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import type { ComparedChunk, StrategyResult } from "@/lib/compare";

/* -------------------------------------------------------------------------- */

function ChunkCard({
  chunk,
  scoreLabel,
  minSimilarity,
}: {
  chunk: ComparedChunk;
  scoreLabel: string;
  minSimilarity: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  // Whether the toggle is worth showing depends on whether the clamp actually
  // cut anything off — which only the rendered box knows, and which changes
  // with column width. A ResizeObserver fires on mount and on every resize,
  // including the height change from expanding/collapsing.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      setIsClamped(el.scrollHeight > el.clientHeight + 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Dimmed, never removed — seeing what a strategy *actually* returned,
  // including the junk, is the entire point of this page.
  const isBelowFloor = chunk.similarity !== null && chunk.similarity < minSimilarity;

  return (
    <li
      className={`rounded-lg border p-3 ${
        isBelowFloor
          ? "border-dashed border-border bg-surface-card/50 opacity-60"
          : "border-border bg-surface-card"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold ${
            isBelowFloor ? "bg-surface-3 text-text-muted" : "bg-accent-soft text-accent"
          }`}
        >
          {chunk.rank}
        </span>
        <FileIcon className="size-3.5 shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs text-text-primary" title={chunk.filename}>
          {chunk.filename}
        </span>
        {chunk.page !== null && (
          <span className="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary">
            p.{chunk.page}
          </span>
        )}
      </div>

      <p className="mt-1.5 font-mono text-[11px] text-text-muted">
        {chunk.score === null ? scoreLabel : `${scoreLabel} ${chunk.score.toFixed(4)}`}
        <span className="ml-2 opacity-70">#{chunk.id}</span>
      </p>

      {/* Raw cosine shown for every strategy so relevance is comparable across
          columns, even where the headline score isn't. */}
      {chunk.similarity !== null && (
        <p className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-text-muted">
            cosine {chunk.similarity.toFixed(4)}
          </span>
          {isBelowFloor && (
            <span className="inline-flex items-center gap-1 rounded border border-warn-border bg-warn-bg px-1.5 py-0.5 text-[10px] font-medium text-warn-text">
              <AlertCircleIcon className="size-3" />
              below relevance floor
            </span>
          )}
        </p>
      )}

      <p
        ref={textRef}
        className={`mt-2 text-xs leading-relaxed whitespace-pre-wrap text-text-secondary ${
          isExpanded ? "" : "line-clamp-6"
        }`}
      >
        {chunk.content}
      </p>

      {/* Only offered when the text is genuinely cut off. `isExpanded` keeps
          "Show less" available once open, since an expanded box measures as
          un-clamped. */}
      {(isClamped || isExpanded) && (
        <button
          type="button"
          onClick={() => setIsExpanded((open) => !open)}
          className="mt-1.5 text-[11px] text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          {isExpanded ? "Show less" : "Show full chunk"}
        </button>
      )}
    </li>
  );
}

function StrategyColumn({
  strategy,
  isMostDiverse,
  minSimilarity,
}: {
  strategy: StrategyResult;
  isMostDiverse: boolean;
  minSimilarity: number;
}) {
  const total = strategy.chunks.length;
  const noneRelevant = total > 0 && strategy.aboveThreshold === 0;
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border bg-surface-2 p-3">
      <header className="border-b border-border pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg text-text-primary">{strategy.label}</h2>
          <span className="shrink-0 font-mono text-[11px] text-text-muted">{strategy.ms}ms</span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
          {strategy.description}
        </p>

        {/* The number that actually answers the roadmap question. */}
        <div className="mt-2.5 rounded-lg border border-border bg-surface-card px-2.5 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-text-secondary">Redundancy</span>
            <span className="font-mono text-sm font-semibold text-text-primary">
              {strategy.redundancy === null ? "—" : strategy.redundancy.toFixed(3)}
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max(0, Math.min(1, strategy.redundancy ?? 0)) * 100}%` }}
            />
          </div>
          {isMostDiverse && (
            <p className="mt-1.5 text-[10px] font-medium text-accent">Most diverse set</p>
          )}
          {/* Guards against reading a low redundancy score as "good results". */}
          <p className="mt-1.5 text-[10px] leading-snug text-text-muted">
            Measured across these chunks regardless of relevance.
          </p>
        </div>

        {/* Relevance is deliberately a separate stat from diversity — a set can
            be perfectly diverse and entirely off-topic. */}
        <div
          className={`mt-2 rounded-lg border px-2.5 py-2 ${
            noneRelevant
              ? "border-warn-border bg-warn-bg"
              : "border-border bg-surface-card"
          }`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`text-[11px] ${noneRelevant ? "text-warn-text" : "text-text-secondary"}`}
            >
              Above relevance floor
            </span>
            <span
              className={`font-mono text-sm font-semibold ${
                noneRelevant ? "text-warn-text" : "text-text-primary"
              }`}
            >
              {strategy.aboveThreshold} of {total}
            </span>
          </div>
          <p
            className={`mt-1 text-[10px] leading-snug ${
              noneRelevant ? "text-warn-text" : "text-text-muted"
            }`}
          >
            {noneRelevant
              ? `Nothing clears cosine ${minSimilarity} — /api/query would answer this from general knowledge, not your documents.`
              : `Cosine ≥ ${minSimilarity}`}
          </p>
        </div>
      </header>

      {strategy.chunks.length === 0 ? (
        <p className="py-6 text-center text-xs text-text-muted">No chunks returned.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {strategy.chunks.map((chunk) => (
            <ChunkCard
              key={`${chunk.id}-${chunk.rank}`}
              chunk={chunk}
              scoreLabel={strategy.scoreLabel}
              minSimilarity={minSimilarity}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export default function ComparePage() {
  // State lives in <AppProviders> so a finished run — which is slow to
  // produce — survives navigating to Documents or Ask and back, and so the
  // header's "Clear results" can reset it.
  const {
    comparison: result,
    compareQuestion: question,
    setCompareQuestion: setQuestion,
    isComparing: isRunning,
    compareError: error,
    runComparison,
  } = useApp();

  async function handleRun() {
    if (!question.trim() || isRunning) return;
    await runComparison(question);
  }

  // Lowest mean pairwise similarity = least repetitive result set.
  const lowestRedundancy = result
    ? Math.min(
        ...result.strategies
          .map((s) => s.redundancy)
          .filter((r): r is number => typeof r === "number")
      )
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
      <div>
        <h1 className="font-serif text-3xl text-text-primary">Retrieval comparison</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-secondary">
          Diagnostic view - runs one question through three retrieval strategies against the same
          corpus. Nothing here affects the Ask flow. Redundancy is the mean pairwise cosine
          similarity between the chunks a strategy returned: lower means it covered more ground
          instead of repeating itself.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleRun();
        }}
        className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface-card px-3 py-2"
      >
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={isRunning}
          placeholder="Enter a test question…"
          aria-label="Test question"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={isRunning || question.trim().length === 0}
          className="shrink-0"
        >
          <SendIcon className="size-3.5" />
          {isRunning ? "Running…" : "Run"}
        </Button>
      </form>

      {error && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-warn-border bg-warn-bg px-4 py-2.5">
          <AlertCircleIcon className="size-4 shrink-0 text-warn-text" />
          <p className="text-sm text-warn-text">{error}</p>
        </div>
      )}

      <div className="scroll-region min-h-0 flex-1 overflow-y-auto">
        {result === null ? (
          <div className="flex h-full min-h-40 items-center justify-center px-6 text-center">
            <p className="max-w-sm text-sm text-text-muted">
              Enter a question to compare plain similarity, hybrid search, and MMR side by side.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 font-mono text-[11px] text-text-muted">
              “{result.question}” · top {result.matchCount} each · MMR fetchK {result.mmr.fetchK},
              λ {result.mmr.lambda} · query embedded in {result.embedMs}ms
            </p>

            {/* Side by side on desktop, stacked below — same content either way. */}
            <div className="grid grid-cols-1 gap-4 pb-2 md:grid-cols-3">
              {result.strategies.map((strategy) => (
                <StrategyColumn
                  key={strategy.id}
                  strategy={strategy}
                  isMostDiverse={
                    strategy.redundancy !== null && strategy.redundancy === lowestRedundancy
                  }
                  minSimilarity={result.minSimilarity}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
