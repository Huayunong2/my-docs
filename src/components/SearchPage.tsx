import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "@tanstack/react-router";
import WorkspaceHeader from "./workspace/WorkspaceHeader";
import { ReviewViewerModal } from "./reviews/ReviewShared";
import { knowledgeExcerpt } from "../lib/knowledgePresentation";
import {
  AlertTriangle,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  FileText,
  Search,
  SearchX,
  BookOpenText,
  X,
  LoaderCircle,
  ArrowUpRight,
} from "lucide-react";
import * as api from "../lib/api";
import type { Article, ArticleSummary, KnowledgeCard } from "../lib/api";
import { offerArticleUndo } from "../lib/articleUndo";
import { cardStatusLabels, cardTypeLabels } from "../lib/cardLabels";
import ArticleDetail from "./ArticleDetail";
import { useConfirmDialog } from "./ui/Feedback";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

type SearchTab = "articles" | "cards" | "reviews";
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
        const matched = terms.some(
          (term) => part.toLowerCase() === term.toLowerCase(),
        );
        return matched ? (
          <mark key={`${part}-${index}`} className="ui-mark px-0.5">
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
  const [reviewDetail, setReviewDetail] = useState<api.Review | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailRequest = useRef(0);
  const [openingId, setOpeningId] = useState("");
  const composing = useRef(false);
  const [tab, setTab] = useState<SearchTab>(initialScope || "articles");
  const [query, setQuery] = useState(initialQuery || "");
  const [submittedQuery, setSubmittedQuery] = useState(
    initialQuery?.trim() || "",
  );
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
    queryFn: ({ signal }) =>
      api.queryKnowledgeCards(
        { q: normalizedQuery, page: cardPage, page_size: 24, sort: "updated" },
        { signal },
      ),
    enabled: tab === "cards" && !!normalizedQuery,
    placeholderData: keepPreviousData,
    staleTime: searchQueryStaleTime,
  });
  const results: ArticleSummary[] = normalizedQuery
    ? articlesQuery.data || []
    : [];
  const cardResults: KnowledgeCard[] = normalizedQuery
    ? cardsQuery.data?.cards || []
    : [];
  const cardTotal = normalizedQuery ? cardsQuery.data?.total || 0 : 0;
  const cardHasMore = normalizedQuery
    ? cardsQuery.data?.has_more || false
    : false;
  const cardPageLagging = cardsQuery.isPlaceholderData;
  const reviewsQuery = useQuery({
    queryKey: ["unifiedSearch", "reviews", normalizedQuery, cardPage],
    queryFn: ({ signal }) =>
      api.queryReviews(
        { q: normalizedQuery, page: cardPage, page_size: 24 },
        { signal },
      ),
    enabled: tab === "reviews" && !!normalizedQuery,
    placeholderData: keepPreviousData,
    staleTime: searchQueryStaleTime,
  });
  const reviewResults = normalizedQuery ? reviewsQuery.data?.reviews || [] : [];
  const activeQuery =
    tab === "articles"
      ? articlesQuery
      : tab === "cards"
        ? cardsQuery
        : reviewsQuery;
  const loading = activeQuery.isFetching;
  const queryError = activeQuery.error
    ? api.getErrorMessage(activeQuery.error)
    : "";
  const error = queryError;
  const searched = !!normalizedQuery;
  const retrySearch = () => {
    setActionError("");
    void activeQuery.refetch();
  };

  const prefetchCardPage = useCallback(
    (q: string, page: number) => {
      const normalizedQuery = q.trim();
      if (!normalizedQuery || page < 1) return;
      void queryClient
        .prefetchQuery({
          queryKey: api.knowledgeQueryKeys.search(
            "cards",
            normalizedQuery,
            page,
          ),
          queryFn: ({ signal }) =>
            api.queryKnowledgeCards(
              { q: normalizedQuery, page, page_size: 24, sort: "updated" },
              { signal },
            ),
          staleTime: searchQueryStaleTime,
        })
        .catch(() => {
          /* 预取失败不打扰当前结果 */
        });
    },
    [queryClient],
  );

  useEffect(() => {
    if (tab !== "cards" || !normalizedQuery || !cardsQuery.data?.has_more)
      return;
    prefetchCardPage(normalizedQuery, cardPage + 1);
  }, [cardPage, cardsQuery.data, normalizedQuery, prefetchCardPage, tab]);

  useEffect(() => {
    setActiveTag("");
    detailRequest.current += 1;
    setOpeningId("");
  }, [normalizedQuery, tab]);

  const switchTab = (next: SearchTab) => {
    setTab(next);
    setActionError("");
    if (next !== "articles") {
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
  }, [initialScope]);

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
    if (tab === "articles" || !query.trim() || nextPage === cardPage) return;
    setCardPage(nextPage);
  }, [cardPage, initialPage, query, tab]);

  const submit = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    setSubmittedQuery(value.trim());
    setCardPage(1);
    setActionError("");
    onQueryChange?.(value.trim());
  };
  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (!composing.current)
      timer.current = setTimeout(() => submit(value), 300);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      detailRequest.current += 1;
    },
    [],
  );
  useEffect(() => {
    resultRef.current?.scrollTo({ top: 0 });
  }, [normalizedQuery, tab, cardPage]);
  const openDetail = async (id: string, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger;
    const request = ++detailRequest.current;
    setOpeningId(id);
    setActionError("");
    try {
      const article = await api.getArticle(id);
      if (request === detailRequest.current) setDetail(article);
    } catch (error) {
      if (request === detailRequest.current)
        setActionError(api.getErrorMessage(error));
    } finally {
      if (request === detailRequest.current) setOpeningId("");
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
      await queryClient.invalidateQueries({
        queryKey: ["knowledgeSearch", "articles"],
      });
      setDetail(null);
      offerArticleUndo({ id: article.id, date: article.date }, () =>
        queryClient
          .invalidateQueries({ queryKey: ["knowledgeSearch", "articles"] })
          .then(() => undefined),
      );
    } catch (e) {
      setActionError(api.getErrorMessage(e));
    }
  };

  const editDate = (date: string) => {
    setDetail(null);
    onEditDate(date);
  };

  const availableTags = Array.from(
    new Set(results.flatMap((item) => item.tags)),
  );
  const visibleResults = activeTag
    ? results.filter((item) => item.tags.includes(activeTag))
    : results;

  const currentCount =
    tab === "articles"
      ? visibleResults.length
      : tab === "cards"
        ? cardTotal
        : reviewsQuery.data?.total || 0;
  const currentItems =
    tab === "articles"
      ? visibleResults
      : tab === "cards"
        ? cardResults
        : reviewResults;
  const scopeLabels = { articles: "记录", cards: "知识", reviews: "复盘" };
  const pageHasMore =
    tab === "cards" ? cardHasMore : reviewsQuery.data?.has_more;
  return (
    <div className="ft-page ft-search">
      <WorkspaceHeader icon={Search} title="搜索" description="" />
      <section className="ft-search-shell" aria-label="全文搜索">
        <form
          className="ft-search-input"
          onSubmit={(event) => {
            event.preventDefault();
            if (!composing.current) submit(query);
          }}
        >
          <Search size={21} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={handleInput}
            onCompositionStart={() => {
              composing.current = true;
              if (timer.current) clearTimeout(timer.current);
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              const value = event.currentTarget.value;
              timer.current = setTimeout(() => submit(value), 300);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.nativeEvent.isComposing || event.keyCode === 229)
              )
                event.preventDefault();
            }}
            aria-label="搜索记录、知识或复盘"
            placeholder="搜索标题、正文或关键词"
            autoComplete="off"
          />
          {loading ? (
            <LoaderCircle size={17} className="animate-spin" />
          ) : (
            query && (
              <button
                type="button"
                className="shell-icon"
                onClick={() => {
                  setQuery("");
                  submit("");
                  inputRef.current?.focus();
                }}
                aria-label="清除搜索"
              >
                <X size={17} />
              </button>
            )
          )}
          <button type="submit" className="ui-button-primary">
            搜索
          </button>
        </form>
        <div className="ft-search-toolbar">
          <Tabs
            value={tab}
            onValueChange={(value) => switchTab(value as SearchTab)}
            className="ft-tabs"
          >
            <TabsList aria-label="搜索范围">
              <TabsTrigger value="articles">
                <FileText size={14} />
                记录
              </TabsTrigger>
              <TabsTrigger value="cards">
                <BookMarked size={14} />
                知识
              </TabsTrigger>
              <TabsTrigger value="reviews">
                <BookOpenText size={14} />
                复盘
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="ft-caption" role="status">
            {searched ? (loading ? "检索中…" : `${currentCount} 项结果`) : ""}
          </span>
        </div>
        {tab === "articles" && searched && availableTags.length > 0 && (
          <div className="ft-search-tags">
            <button
              type="button"
              aria-pressed={!activeTag}
              onClick={() => setActiveTag("")}
            >
              全部标签
            </button>
            {availableTags.slice(0, 8).map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed={activeTag === tag}
                onClick={() => setActiveTag(activeTag === tag ? "" : tag)}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
        {actionError && (
          <div
            className="ui-alert-bad mt-3 flex items-center justify-between gap-3"
            role="alert"
          >
            <span>{actionError}</span>
            <button
              type="button"
              className="shell-icon"
              onClick={() => setActionError("")}
              aria-label="关闭操作错误"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div ref={resultRef} className="ft-search-results" aria-busy={loading}>
          {!searched ? null : error ? (
            <div className="ft-search-empty" role="alert">
              <AlertTriangle size={30} />
              <h2>暂时无法完成搜索</h2>
              <p>{error}</p>
              <button
                className="ui-button-secondary"
                onClick={retrySearch}
                disabled={loading}
              >
                重试
              </button>
            </div>
          ) : loading && currentItems.length === 0 ? (
            <div className="ft-search-skeleton" role="status">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <div className="ui-skeleton h-4 w-2/5" />
                  <div className="ui-skeleton mt-4 h-3 w-4/5" />
                </div>
              ))}
            </div>
          ) : !currentItems.length ? (
            <div className="ft-search-empty">
              <SearchX size={32} />
              <h2>没有匹配的{scopeLabels[tab]}</h2>
              <p>换个关键词，或切换搜索范围。</p>
            </div>
          ) : (
            <div className="ft-result-list" data-stale={loading}>
              {tab === "articles" &&
                visibleResults.map((article) => (
                  <article className="ft-result" key={article.id}>
                    <FileText size={19} className="ft-result-icon" />
                    <button
                      className="ft-result-main"
                      onClick={(event) =>
                        void openDetail(article.id, event.currentTarget)
                      }
                      disabled={!!openingId}
                      aria-label={`打开 ${article.date} 的记录`}
                    >
                      <span className="ft-result-meta">
                        <time>{article.date}</time>
                        {article.spaces?.slice(0, 1).map((space) => (
                          <span key={space}>{space}</span>
                        ))}
                      </span>
                      <h2>
                        <HighlightText
                          text={article.title || "无标题"}
                          query={normalizedQuery}
                        />
                      </h2>
                      <p>
                        <HighlightText
                          text={knowledgeExcerpt(article.preview, 240)}
                          query={normalizedQuery}
                        />
                      </p>
                      <span className="ft-result-tags">
                        {article.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </span>
                    </button>
                    <button
                      className="shell-icon"
                      onClick={() => editDate(article.date)}
                      aria-label={`编辑 ${article.date} 的记录`}
                      title="编辑记录"
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </article>
                ))}
              {tab === "cards" &&
                cardResults.map((card) => (
                  <article className="ft-result" key={card.id}>
                    <BookMarked size={19} className="ft-result-icon" />
                    <Link
                      to="/knowledge/$cardId"
                      params={{ cardId: card.id }}
                      search={{ view: "detail" }}
                      onClick={(event) => {
                        if (
                          event.ctrlKey ||
                          event.metaKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        onOpenKnowledgeCard(card.id);
                      }}
                      className="ft-result-main"
                    >
                      <span className="ft-result-meta">
                        <span>{cardTypeLabels[card.card_type]}</span>
                        <span>{cardStatusLabels[card.status]}</span>
                      </span>
                      <h2>
                        <HighlightText
                          text={card.title || "无标题"}
                          query={normalizedQuery}
                        />
                      </h2>
                      <p>
                        <HighlightText
                          text={knowledgeExcerpt(card.content, 240)}
                          query={normalizedQuery}
                        />
                      </p>
                      <span className="ft-result-tags">
                        {card.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </span>
                    </Link>
                    <ArrowUpRight size={17} />
                  </article>
                ))}
              {tab === "reviews" &&
                reviewResults.map((review) => (
                  <article className="ft-result" key={review.id}>
                    <BookOpenText size={19} className="ft-result-icon" />
                    <button
                      className="ft-result-main"
                      onClick={(event) => {
                        detailTriggerRef.current = event.currentTarget;
                        setReviewDetail(review);
                      }}
                    >
                      <span className="ft-result-meta">
                        <span>
                          {review.kind === "weekly" ? "周复盘" : "月复盘"}
                        </span>
                        <span>
                          {review.period_start} — {review.period_end}
                        </span>
                        <span>v{review.version}</span>
                      </span>
                      <h2>
                        <HighlightText
                          text={review.title}
                          query={normalizedQuery}
                        />
                      </h2>
                      <p>
                        <HighlightText
                          text={knowledgeExcerpt(review.content, 240)}
                          query={normalizedQuery}
                        />
                      </p>
                    </button>
                    <ArrowUpRight size={17} />
                  </article>
                ))}
            </div>
          )}
        </div>
        {searched && tab !== "articles" && (cardPage > 1 || pageHasMore) && (
          <footer className="ft-search-pagination">
            <button
              className="ui-button-secondary"
              disabled={
                loading || cardPage <= 1 || (tab === "cards" && cardPageLagging)
              }
              onClick={() => {
                setCardPage(cardPage - 1);
                onPageChange?.(cardPage - 1);
              }}
            >
              <ChevronLeft size={15} />
              上一页
            </button>
            <span>第 {cardPage} 页</span>
            <button
              className="ui-button-secondary"
              disabled={loading || !pageHasMore}
              onClick={() => {
                setCardPage(cardPage + 1);
                onPageChange?.(cardPage + 1);
              }}
            >
              下一页
              <ChevronRight size={15} />
            </button>
          </footer>
        )}
      </section>
      {detail && (
        <ArticleDetail
          article={detail}
          onClose={() => setDetail(null)}
          onEdit={editDate}
          onDelete={deleteDetail}
          returnFocusRef={detailTriggerRef}
        />
      )}
      {reviewDetail && (
        <ReviewViewerModal
          review={reviewDetail}
          title={reviewDetail.title}
          content={reviewDetail.content}
          saving={false}
          readOnly
          onTitleChange={() => {}}
          onContentChange={() => {}}
          onSave={() => false}
          onConfirm={() => false}
          onDelete={() => false}
          onClose={() => setReviewDetail(null)}
          onRestoreFocus={() => detailTriggerRef.current?.focus()}
        />
      )}
      {dialog}
    </div>
  );
}
