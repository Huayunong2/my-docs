import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, BookMarked, ChevronLeft, ChevronRight, FileText, Search, SearchX } from "lucide-react";
import * as api from "../lib/api";
import type { Article, ArticleSummary, KnowledgeCard } from "../lib/api";
import { offerArticleUndo } from "../lib/articleUndo";
import { cardStatusLabels, cardTypeLabels } from "../lib/cardLabels";
import ArticleDetail from "./ArticleDetail";
import { useConfirmDialog } from "./ui/Feedback";
import PageHeader from "./ui/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

type SearchTab = "articles" | "cards";
const searchQueryStaleTime = 30_000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryTerms(query: string): string[] {
  const raw = query.trim();
  if (!raw) return [];
  return Array.from(new Set([raw, ...raw.split(/\s+/)]))
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const terms = queryTerms(query);
  if (!terms.length || !text) return <>{text}</>;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((part, index) => {
        const matched = terms.some((term) => part.toLowerCase() === term.toLowerCase());
        return matched ? (
          <mark
            key={`${part}-${index}`}
            className="ui-mark px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </>
  );
}

export default function SearchPage({
  onEditDate,
  onOpenKnowledgeCard,
  initialQuery,
  initialNonce,
  initialScope,
  initialPage,
  onQueryChange,
  onScopeChange,
  onPageChange,
}: {
  onEditDate: (date: string) => void;
  onOpenKnowledgeCard: (cardId: string) => void;
  initialQuery?: string;
  initialNonce?: number;
  initialScope?: SearchTab;
  initialPage?: number;
  onQueryChange?: (query: string) => void;
  onScopeChange?: (scope: SearchTab) => void;
  onPageChange?: (page: number) => void;
}) {
  const [tab, setTab] = useState<SearchTab>(initialScope || "articles");
  const [query, setQuery] = useState(initialQuery || "");
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery?.trim() || "");
  const [cardPage, setCardPage] = useState(initialPage || 1);
  const [detail, setDetail] = useState<Article | null>(null);
  const [activeTag, setActiveTag] = useState("");
  const [actionError, setActionError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { confirm, dialog } = useConfirmDialog();
  const queryClient = useQueryClient();

  const normalizedQuery = submittedQuery.trim();
  const articlesQuery = useQuery({
    queryKey: api.knowledgeQueryKeys.search("articles", normalizedQuery),
    queryFn: ({ signal }) => api.searchArticles(normalizedQuery, { signal }),
    enabled: tab === "articles" && !!normalizedQuery,
    placeholderData: keepPreviousData,
    staleTime: searchQueryStaleTime,
  });
  const cardsQuery = useQuery({
    queryKey: api.knowledgeQueryKeys.search("cards", normalizedQuery, cardPage),
    queryFn: ({ signal }) => api.queryKnowledgeCards({ q: normalizedQuery, page: cardPage, page_size: 24, sort: "updated" }, { signal }),
    enabled: tab === "cards" && !!normalizedQuery,
    placeholderData: keepPreviousData,
    staleTime: searchQueryStaleTime,
  });
  const results: ArticleSummary[] = normalizedQuery ? articlesQuery.data || [] : [];
  const cardResults: KnowledgeCard[] = normalizedQuery ? cardsQuery.data?.cards || [] : [];
  const cardTotal = normalizedQuery ? cardsQuery.data?.total || 0 : 0;
  const cardHasMore = normalizedQuery ? cardsQuery.data?.has_more || false : false;
  const cardPageLagging = cardsQuery.isPlaceholderData;
  const activeQuery = tab === "articles" ? articlesQuery : cardsQuery;
  const loading = activeQuery.isFetching;
  const queryError = activeQuery.error ? api.getErrorMessage(activeQuery.error) : "";
  const error = actionError || queryError;
  const searched = !!normalizedQuery;
  const retrySearch = () => {
    setActionError("");
    void activeQuery.refetch();
  };

  const prefetchCardPage = useCallback((q: string, page: number) => {
    const normalizedQuery = q.trim();
    if (!normalizedQuery || page < 1) return;
    void queryClient.prefetchQuery({
      queryKey: api.knowledgeQueryKeys.search("cards", normalizedQuery, page),
      queryFn: ({ signal }) => api.queryKnowledgeCards({ q: normalizedQuery, page, page_size: 24, sort: "updated" }, { signal }),
      staleTime: searchQueryStaleTime,
    }).catch(() => { /* 预取失败不打扰当前结果 */ });
  }, [queryClient]);

  useEffect(() => {
    if (tab !== "cards" || !normalizedQuery || !cardsQuery.data?.has_more) return;
    prefetchCardPage(normalizedQuery, cardPage + 1);
  }, [cardPage, cardsQuery.data, normalizedQuery, prefetchCardPage, tab]);

  useEffect(() => {
    setActiveTag("");
  }, [normalizedQuery, tab]);

  const switchTab = (next: SearchTab) => {
    setTab(next);
    setActionError("");
    if (next === "cards") {
      setCardPage(1);
      onPageChange?.(1);
    }
    onScopeChange?.(next);
    setSubmittedQuery(query.trim());
    onQueryChange?.(query.trim());
  };

  useEffect(() => {
    const nextScope = initialScope || "articles";
    if (nextScope === tab) return;
    setTab(nextScope);
    setActionError("");
  }, [initialScope, tab]);

  // 从搜索跳转携带的关键词只在 URL 发生变化时应用，切换 Tab 不应重置输入框。
  const initialQueryHandled = useRef<string | null>(null);
  useEffect(() => {
    const nextQuery = initialQuery?.trim() || "";
    if (!nextQuery) {
      if (initialQueryHandled.current !== null) {
        initialQueryHandled.current = null;
        setQuery("");
        setSubmittedQuery("");
        setCardPage(1);
        setActiveTag("");
      }
      return;
    }
    if (initialQueryHandled.current === nextQuery) return;
    initialQueryHandled.current = nextQuery;
    setQuery(nextQuery);
    setSubmittedQuery(nextQuery);
    const nextPage = initialPage || 1;
    setCardPage(nextPage);
  }, [initialNonce, initialPage, initialQuery, initialScope]);

  useEffect(() => {
    const nextPage = initialPage || 1;
    if (tab !== "cards" || !query.trim() || nextPage === cardPage) return;
    setCardPage(nextPage);
  }, [cardPage, initialPage, query, tab]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setCardPage(1);
    onPageChange?.(1);
    setActionError("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const nextQuery = v.trim();
      setSubmittedQuery(nextQuery);
      onQueryChange?.(nextQuery);
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (timer.current) clearTimeout(timer.current);
      setCardPage(1);
      onPageChange?.(1);
      setSubmittedQuery(query.trim());
      setActionError("");
      onQueryChange?.(query.trim());
    }
  };

  const openDetail = async (id: string) => {
    setActionError("");
    try {
      const article = await api.getArticle(id);
      setDetail(article);
    } catch (e: any) {
      setActionError(api.getErrorMessage(e));
    }
  };

  const deleteDetail = async (article: Article) => {
    const ok = await confirm({
      title: "移入记录回收站",
      message: `确定要把 ${article.date} 的记录移入回收站吗？正文和空间关系会保留，可随时恢复。`,
      confirmText: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteArticle(article.id);
      await queryClient.invalidateQueries({ queryKey: ["knowledgeSearch", "articles"] });
      setDetail(null);
      offerArticleUndo(
        { id: article.id, date: article.date },
        () => queryClient.invalidateQueries({ queryKey: ["knowledgeSearch", "articles"] }).then(() => undefined),
      );
    } catch (e) {
      setActionError(api.getErrorMessage(e));
    }
  };

  const editDate = (date: string) => {
    setDetail(null);
    onEditDate(date);
  };

  const availableTags = Array.from(new Set(results.flatMap((item) => item.tags)));
  const visibleResults = activeTag
    ? results.filter((item) => item.tags.includes(activeTag))
    : results;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-surface page-surface-search min-h-full flex flex-col px-4 pb-28 pt-5 sm:px-6 md:h-full md:px-8 md:py-6"
    >
      <PageHeader
        icon={Search}
        title="全文搜索"
        description="在每日记录、AI 复盘和知识卡片之间快速定位。"
      />

      {/* Tab switch */}
      <Tabs value={tab} onValueChange={(v) => switchTab(v as SearchTab)} className="mb-4">
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="articles">
            <FileText size={13} className="mr-1" /> 文章
          </TabsTrigger>
          <TabsTrigger value="cards">
            <BookMarked size={13} className="mr-1" /> 知识卡片
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Search input */}
      <motion.div
        className="relative"
        initial={false}
        animate={query ? "focused" : "idle"}
      >
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="搜索标题或内容..."
          className="archive-search-input ui-field rounded-2xl px-5 py-3.5 text-base"
        />
        {loading && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
              className="h-5 w-5 rounded-full border-2 border-[var(--ui-accent-solid)] border-t-transparent"
            />
          </div>
        )}
      </motion.div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto mt-4" aria-busy={loading}>
        <AnimatePresence mode="wait">
          {!searched && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full items-center justify-center text-[var(--ui-text-subtle)]"
            >
              <div className="text-center">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ui-surface-inset)] text-[var(--ui-text-muted)]">
                  <Search size={24} />
                </span>
                <p>输入关键词搜索你的记录</p>
              </div>
            </motion.div>
          )}

          {error && (
            <div className="py-12 text-center" role="alert">
              <AlertTriangle size={28} className="mx-auto mb-2 text-[var(--ui-danger-text)]" />
              <p className="text-sm text-[var(--ui-danger-text)]">{error}</p>
              {queryError && (
                <button type="button" onClick={retrySearch} disabled={loading} className="ui-button-secondary mt-3 h-9 px-3 text-xs">
                  {loading ? "重试中..." : "重试"}
                </button>
              )}
            </div>
          )}

          {searched && !error && loading && ((tab === "articles" ? results.length : cardResults.length) === 0) && (
            <div className="space-y-2 py-2" role="status" aria-label="正在加载搜索结果">
              {["w-11/12", "w-3/4", "w-5/6"].map((width) => (
                <div key={width} className="ui-panel-muted rounded-xl p-4">
                  <div className={`ui-skeleton h-3 ${width}`} />
                  <div className="ui-skeleton mt-3 h-3 w-full" />
                  <div className="ui-skeleton mt-2 h-3 w-2/3" />
                </div>
              ))}
            </div>
          )}

          {searched && !error && ((tab === "articles" ? results.length : cardResults.length) === 0) && !loading && (
            <motion.div
              key="no-results"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-16 text-center text-[var(--ui-text-muted)]"
            >
              <SearchX size={30} className="mx-auto mb-2 text-[var(--ui-text-subtle)]" />
              <p className="text-sm">没有找到匹配的{tab === "articles" ? "记录" : "知识卡片"}</p>
              <p className="mt-1 text-xs text-[var(--ui-text-subtle)]">试试其他关键词</p>
            </motion.div>
          )}

          {tab === "articles" && results.length > 0 && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-2"
            >
              <p className="mb-3 text-sm text-[var(--ui-text-muted)]">
                找到 {visibleResults.length} 条结果{activeTag ? ` · #${activeTag}` : ""}
              </p>
              {availableTags.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveTag("")}
                    className={!activeTag ? "ui-button-primary h-7 rounded-full px-2.5 text-xs" : "ui-chip h-7 px-2.5 text-xs"}
                  >
                    全部
                  </button>
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setActiveTag(tag)}
                      className={activeTag === tag ? "ui-button-primary h-7 rounded-full px-2.5 text-xs" : "ui-chip h-7 px-2.5 text-xs"}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
              {visibleResults.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="ui-panel card-interactive relative p-4"
                >
                  <button
                    type="button"
                    onClick={() => openDetail(a.id)}
                    aria-label={`打开 ${a.date} 的记录`}
                    className="block w-full rounded-lg pr-12 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-xs text-[var(--ui-text-subtle)]">
                        {a.date}
                      </span>
                      {a.mood && <span>{a.mood}</span>}
                    </div>
                    <h4 className="font-medium text-[var(--ui-text)]">
                      <HighlightText text={a.title || "(无标题)"} query={query} />
                    </h4>
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--ui-text-muted)]">
                      <HighlightText text={a.preview} query={query} />
                    </p>
                    {a.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {a.tags.map((tag) => (
                          <span key={tag} className="ui-chip h-6 px-2 py-0 text-[11px]">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => editDate(a.date)}
                    className="ui-button-ghost absolute right-3 top-3 h-8 px-2 text-xs"
                    aria-label={`编辑 ${a.date} 的记录`}
                  >
                    编辑
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}

          {tab === "cards" && cardResults.length > 0 && (
            <motion.div
              key="card-results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-2"
            >
              <p className="mb-3 text-sm text-[var(--ui-text-muted)]">
                找到 {cardTotal} 张知识卡片{cardTotal > 0 ? ` · 第 ${cardPage} 页` : ""}
              </p>
              {cardResults.map((card, i) => (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="ui-panel card-interactive p-4"
                >
                  <button
                    type="button"
                    onClick={() => onOpenKnowledgeCard(card.id)}
                    aria-label={`打开知识卡片：${card.title || "无标题"}`}
                    className="block w-full rounded-lg text-left outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="ui-status-accent rounded-md px-1.5 py-0.5 text-[11px] font-semibold">
                        {cardTypeLabels[card.card_type]}
                      </span>
                      <span className="font-mono text-xs text-[var(--ui-text-subtle)]">
                        {card.source_date || "无来源日期"}
                      </span>
                      <span className="text-xs text-[var(--ui-text-subtle)]">
                        {cardStatusLabels[card.status] || card.status}
                      </span>
                    </div>
                    <h4 className="font-medium text-[var(--ui-text)]">
                      <HighlightText text={card.title || "(无标题)"} query={query} />
                    </h4>
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--ui-text-muted)]">
                      <HighlightText text={card.content} query={query} />
                    </p>
                    {card.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {card.tags.map((tag) => (
                          <span key={tag} className="ui-chip h-6 px-2 py-0 text-[11px]">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </motion.div>
              ))}
              {(cardPage > 1 || cardHasMore) && (
                <div className="flex items-center justify-between gap-3 border-t pt-3 ui-soft-divider">
                  <button
                    type="button"
                    onClick={() => {
                      const nextPage = Math.max(1, cardPage - 1);
                      setCardPage(nextPage);
                      onPageChange?.(nextPage);
                    }}
                    disabled={loading || cardPageLagging || cardPage <= 1}
                    className="ui-button-secondary h-9 px-2.5 text-xs"
                  >
                    <ChevronLeft size={14} /> 上一页
                  </button>
                  <span className="text-xs text-[var(--ui-text-subtle)]">第 {cardPage} 页 · 每页 24 张</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextPage = cardPage + 1;
                      setCardPage(nextPage);
                      onPageChange?.(nextPage);
                    }}
                    disabled={loading || cardPageLagging || !cardHasMore}
                    className="ui-button-secondary h-9 px-2.5 text-xs"
                  >
                    下一页 <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {detail && (
          <ArticleDetail
            article={detail}
            onClose={() => setDetail(null)}
            onEdit={editDate}
            onDelete={deleteDetail}
          />
        )}
      </AnimatePresence>
      {dialog}
    </motion.div>
  );
}
