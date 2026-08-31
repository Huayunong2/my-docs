import { useMemo } from "react";

function normalizedWithMap(value: string) {
  const original = Array.from(value);
  const normalized: string[] = [];
  const originalIndexes: number[] = [];
  original.forEach((character, index) => {
    if (/\s/u.test(character)) return;
    normalized.push(character.toLocaleLowerCase());
    originalIndexes.push(index);
  });
  return { original, normalized: normalized.join(""), originalIndexes };
}

export type SourceExcerptMatchResult = {
  before: string;
  matched: string;
  after: string;
  truncatedBefore: boolean;
  truncatedAfter: boolean;
};

export function findSourceExcerptMatch(source: string, excerpt: string): SourceExcerptMatchResult | null {
  const sourceData = normalizedWithMap(source);
  const excerptData = normalizedWithMap(excerpt);
  const normalizedSource = sourceData.normalized;
  const normalizedExcerpt = excerptData.normalized;
  if (!normalizedSource || !normalizedExcerpt) return null;
  const start = normalizedSource.indexOf(normalizedExcerpt);
  if (start < 0) return null;
  const contextStart = Math.max(0, start - 180);
  const contextEnd = Math.min(normalizedSource.length, start + normalizedExcerpt.length + 180);
  const matchStart = sourceData.originalIndexes[start];
  const matchEnd = sourceData.originalIndexes[start + normalizedExcerpt.length - 1] + 1;
  const contextOriginalStart = sourceData.originalIndexes[contextStart] ?? 0;
  const contextOriginalEnd = (sourceData.originalIndexes[contextEnd - 1] ?? sourceData.original.length - 1) + 1;
  return {
    before: sourceData.original.slice(contextOriginalStart, matchStart).join(""),
    matched: sourceData.original.slice(matchStart, matchEnd).join(""),
    after: sourceData.original.slice(matchEnd, contextOriginalEnd).join(""),
    truncatedBefore: contextStart > 0,
    truncatedAfter: contextEnd < normalizedSource.length,
  };
}

/**
 * 在只读来源正文前给出一段可见的原文上下文。
 * 这比单独重复一段引用更可核验：用户能立即看到片段确实落在来源内容中，
 * 同时下方仍保留完整 Markdown 阅读器。
 */
export default function SourceExcerptMatch({ source, excerpt }: { source: string; excerpt: string }) {
  const match = useMemo(() => {
    return findSourceExcerptMatch(source, excerpt);
  }, [excerpt, source]);

  if (!excerpt.trim()) return null;

  return (
    <figure className={match ? "ui-source-match ui-status-accent mb-5 rounded-xl p-3" : "ui-source-match ui-alert-warn mb-5 rounded-xl p-3"} aria-label="来源片段在原文中的定位">
      <figcaption className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span>{match ? "已在原文中定位" : "未在当前原文中找到片段"}</span>
        {match && <span className="text-[11px] font-normal text-[var(--ui-text-subtle)]">以下是匹配处上下文</span>}
      </figcaption>
      {match ? (
        <blockquote className="whitespace-pre-wrap break-words text-sm leading-6">
          {match.truncatedBefore && <span aria-hidden="true">…</span>}
          {match.before}
          <mark className="ui-mark rounded px-0.5 font-medium">{match.matched}</mark>
          {match.after}
          {match.truncatedAfter && <span aria-hidden="true">…</span>}
        </blockquote>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-6">请回到知识卡片重新复制连续原文片段。</p>
      )}
    </figure>
  );
}
