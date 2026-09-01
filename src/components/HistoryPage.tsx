import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, CalendarRange, Folder, List, PenLine, RotateCcw, SearchX, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as api from "../lib/api";
import type { Article, ArticleSummary, ArchiveMonth } from "../lib/api";
import { offerArticleUndo } from "../lib/articleUndo";
import ArticleDetail from "./ArticleDetail";
import { InlineError, useConfirmDialog } from "./ui/Feedback";
import DatePickerPopover from "./ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

const PAGE_SIZE = 20;
const MONTH_NAMES = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

export type HistoryView = "timeline" | "month" | "trash";

interface HistoryPageProps {
  onEditDate: (date: string, returnTo?: string) => void;
  initialView?: HistoryView;
  initialMonth?: string;
  onViewChange?: (view: HistoryView) => void;
  onMonthChange?: (month?: string) => void;
}

type DetailStatus = "idle" | "loading" | "ready" | "error";

export default function HistoryPage({
  onEditDate,
  initialView = "timeline",
  initialMonth,
  onViewChange,
  onMonthChange,
}: HistoryPageProps) {
  const [view, setView] = useState<HistoryView>(initialView);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [failedPage, setFailedPage] = useState<number | null>(null);
  const [months, setMonths] = useState<ArchiveMonth[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth || "");
  const [jumpDate, setJumpDate] = useState(() => formatDate(new Date()));
  const [dateLookupLoading, setDateLookupLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Article | null>(null);
  const [detailStatus, setDetailStatus] = useState<DetailStatus>("idle");
  const [detailError, setDetailError] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const viewRef = useRef(view);
  const pageRef = useRef(page);
  const selectedMonthRef = useRef(selectedMonth);
  viewRef.current = view;
  pageRef.current = page;
  selectedMonthRef.current = selectedMonth;
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const detailRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const closeTimerRef = useRef<number | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  const groupedArticles = useMemo(() => groupArticlesByTime(articles), [articles]);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (initialMonth && initialMonth !== selectedMonth) setSelectedMonth(initialMonth);
  }, [initialMonth, selectedMonth]);

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setMobileDetailOpen(false);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setSelectedId(null);
      setDetail(null);
      setDetailStatus("idle");
      setDetailError("");
      if (detailTriggerRef.current && document.contains(detailTriggerRef.current)) {
        detailTriggerRef.current.focus();
      }
      closeTimerRef.current = null;
    }, 140);
  }, []);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const loadPage = useCallback(async (nextPage: number, targetView: HistoryView, replace = nextPage === 1) => {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    setFailedPage(null);
    if (nextPage === 1 && replace) {
      setArticles([]);
      setTotal(0);
      setHasMore(false);
      setPage(1);
    }
    try {
      const response = targetView === "trash"
        ? await api.listArticleTrash(nextPage, PAGE_SIZE)
        : await api.listArticles(nextPage, PAGE_SIZE);
      if (requestId !== listRequestRef.current) return;
      setArticles((previous) => {
        if (nextPage === 1 && replace) return response.items;
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...response.items.filter((item) => !known.has(item.id))];
      });
      setTotal(response.total);
      setHasMore(response.has_more);
      setPage(nextPage);
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(api.getErrorMessage(loadError));
        setFailedPage(nextPage);
      }
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }, []);

  const loadMonthArticles = useCallback(async (month: string) => {
    if (!isValidMonth(month)) return;
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    setFailedPage(null);
    setArticles([]);
    setTotal(0);
    setHasMore(false);
    try {
      const [year, monthNumber] = month.split("-").map(Number);
      const items = await api.getArticlesByMonth(year, monthNumber);
      if (requestId !== listRequestRef.current) return;
      setArticles(items);
      setTotal(items.length);
      setPage(1);
    } catch (loadError) {
      if (requestId === listRequestRef.current) setError(api.getErrorMessage(loadError));
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }, []);

  const loadMonthView = useCallback(async (requestedMonth?: string) => {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    setFailedPage(null);
    setArticles([]);
    setTotal(0);
    setHasMore(false);
    try {
      const availableMonths = await api.getArchiveMonths();
      if (requestId !== listRequestRef.current) return;
      setMonths(availableMonths);
      const requestedIsAvailable = isValidMonth(requestedMonth)
        && availableMonths.some((month) => monthKey(month) === requestedMonth);
      const nextMonth = requestedIsAvailable
        ? requestedMonth!
        : availableMonths[0]
          ? monthKey(availableMonths[0])
          : "";
      setSelectedMonth(nextMonth);
      if (!nextMonth) return;
      const [year, month] = nextMonth.split("-").map(Number);
      const items = await api.getArticlesByMonth(year, month);
      if (requestId !== listRequestRef.current) return;
      setArticles(items);
      setTotal(items.length);
      setPage(1);
    } catch (loadError) {
      if (requestId === listRequestRef.current) setError(api.getErrorMessage(loadError));
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    closeDetail();
    if (view === "month") {
      void loadMonthView(initialMonth);
    } else {
      void loadPage(1, view);
    }
  }, [closeDetail, initialMonth, loadMonthView, loadPage, view]);

  const openDetail = useCallback(async (id: string, trigger?: HTMLElement) => {
    const activeElement = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    detailTriggerRef.current = trigger || activeElement;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const requestId = ++detailRequestRef.current;
    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setDetailStatus("loading");
    const compact = typeof window === "undefined"
      || typeof window.matchMedia !== "function"
      || window.matchMedia("(max-width: 1279px)").matches;
    setMobileDetailOpen(compact);
    try {
      const article = await api.getArticle(id);
      if (requestId !== detailRequestRef.current) return;
      setDetail(article);
      setDetailStatus("ready");
    } catch (loadError) {
      if (requestId !== detailRequestRef.current) return;
      setDetailError(api.getErrorMessage(loadError));
      setDetailStatus("error");
    }
  }, []);

  const retryDetail = useCallback(() => {
    if (selectedId) void openDetail(selectedId, detailTriggerRef.current || undefined);
  }, [openDetail, selectedId]);

  const historyReturnTo = useCallback(() => {
    const search = new URLSearchParams();
    if (view !== "timeline") search.set("historyView", view);
    if (view === "month" && selectedMonth) search.set("historyMonth", selectedMonth);
    const query = search.toString();
    return `/history${query ? `?${query}` : ""}`;
  }, [selectedMonth, view]);

  const handleEdit = useCallback((date: string, event?: MouseEvent<HTMLElement>) => {
    event?.stopPropagation();
    onEditDate(date, historyReturnTo());
  }, [historyReturnTo, onEditDate]);

  const refreshCurrentView = useCallback(() => {
    const currentView = viewRef.current;
    if (currentView === "month" && selectedMonthRef.current) {
      void loadMonthArticles(selectedMonthRef.current);
    } else if (currentView === "timeline" || currentView === "trash") {
      void loadPage(1, currentView);
    }
  }, [loadMonthArticles, loadPage]);

  const handleDelete = useCallback(async (article: Article | ArticleSummary, event?: MouseEvent<HTMLElement>) => {
    event?.stopPropagation();
    const ok = await confirm({
      title: "移入记录回收站",
      message: `确定要把 ${article.date} 的记录移入回收站吗？正文和空间关系会保留，可随时恢复。`,
      confirmText: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteArticle(article.id);
      if (selectedId === article.id) closeDetail();
      setArticles((previous) => previous.filter((item) => item.id !== article.id));
      setTotal((current) => Math.max(0, current - 1));
      setHasMore((current) => current || page * PAGE_SIZE < Math.max(0, total - 1));
      if (view === "timeline") void loadPage(page, view, false);
      offerArticleUndo({ id: article.id, date: article.date }, refreshCurrentView);
    } catch (deleteError) {
      setError(api.getErrorMessage(deleteError));
    }
  }, [closeDetail, confirm, loadPage, page, refreshCurrentView, selectedId, total, view]);

  const handleRestore = useCallback(async (article: ArticleSummary) => {
    try {
      await api.restoreArticle(article.id);
      setArticles((previous) => previous.filter((item) => item.id !== article.id));
      setTotal((current) => Math.max(0, current - 1));
      if (viewRef.current === "trash") void loadPage(pageRef.current, "trash", false);
      toast.success(`已恢复 ${article.date} 的记录`, { duration: 2600 });
    } catch (restoreError) {
      setError(api.getErrorMessage(restoreError));
    }
  }, [loadPage]);

  const locateDate = useCallback(async (date: string) => {
    setJumpDate(date);
    const loadedArticle = articles.find((article) => article.date === date);
    if (loadedArticle) {
      void openDetail(loadedArticle.id);
      return;
    }
    setDateLookupLoading(true);
    try {
      const article = await api.getTodayArticle(date);
      if (article) {
        void openDetail(article.id);
      } else {
        toast.info(`${date} 还没有记录`, {
          duration: 5000,
          action: { label: "去记录", onClick: () => handleEdit(date) },
        });
      }
    } catch (lookupError) {
      toast.error(`查找 ${date} 失败：${api.getErrorMessage(lookupError)}`, { duration: 3600 });
    } finally {
      setDateLookupLoading(false);
    }
  }, [articles, handleEdit, openDetail]);

  const handleViewChange = useCallback((nextView: string) => {
    if (!isHistoryView(nextView)) return;
    closeDetail();
    setView(nextView);
    onViewChange?.(nextView);
  }, [closeDetail, onViewChange]);

  const handleMonthChange = useCallback((month: string) => {
    if (!isValidMonth(month)) return;
    setSelectedMonth(month);
    onMonthChange?.(month);
    if (!onMonthChange) void loadMonthArticles(month);
  }, [loadMonthArticles, onMonthChange]);

  const retryList = useCallback(() => {
    setError("");
    if (view === "month") {
      void loadMonthView(selectedMonth || initialMonth);
    } else if (failedPage && failedPage > 1) {
      void loadPage(failedPage, view, false);
    } else {
      void loadPage(1, view);
    }
  }, [failedPage, initialMonth, loadMonthView, loadPage, selectedMonth, view]);

  const startToday = useCallback(() => {
    onEditDate(formatDate(new Date()), historyReturnTo());
  }, [historyReturnTo, onEditDate]);

  const description = loading && articles.length === 0
    ? view === "trash" ? "正在加载回收站…" : view === "month" ? "正在加载月份记录…" : "正在加载记录…"
    : view === "trash"
      ? `${total} 条已移入回收站的记录`
      : `${total} 条每日记录`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-surface page-surface-history flex min-h-full min-w-0 flex-col xl:h-full"
    >
      <header className="history-header shrink-0 px-4 pb-4 pt-5 sm:px-6 md:px-8 md:pb-5 md:pt-7 xl:px-6">
        <div className="history-header-inner flex w-full min-w-0 items-end justify-between gap-5">
          <div className="history-title-row flex min-w-0 items-center gap-3">
            <span className="history-title-mark shrink-0" aria-hidden="true"><CalendarDays size={20} strokeWidth={2.1} /></span>
            <div className="min-w-0">
              <div className="history-title-line flex min-w-0 items-center gap-2.5">
                <h1 className="history-title truncate">{view === "trash" ? "记录回收站" : "记录"}</h1>
                {view === "trash" && <span className="history-title-badge">可恢复</span>}
              </div>
              <p className="history-description">{description}</p>
            </div>
          </div>
          <button type="button" onClick={startToday} className="ui-button-primary history-write-button shrink-0 px-3.5 text-sm">
            <PenLine size={16} /> 写今天
          </button>
        </div>
      </header>

      <div className="history-toolbar shrink-0 px-4 sm:px-6 md:px-8 xl:px-6">
        <div className="history-toolbar-inner flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
          <Tabs value={view} onValueChange={handleViewChange}>
            <TabsList aria-label="记录视图" className="history-tabs w-full sm:w-auto">
              <TabsTrigger value="timeline" className="history-tab min-w-0 flex-1 sm:flex-none"><List size={14} aria-hidden="true" /> 时间线</TabsTrigger>
              <TabsTrigger value="month" className="history-tab min-w-0 flex-1 sm:flex-none"><CalendarRange size={14} aria-hidden="true" /> 按月份</TabsTrigger>
              <TabsTrigger value="trash" className="history-tab min-w-0 flex-1 sm:flex-none"><Trash2 size={14} aria-hidden="true" /> 回收站</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="history-filter-region flex min-w-0 items-center gap-3">
            {view === "timeline" && (
              <DatePickerPopover value={jumpDate} onChange={locateDate} label="定位日期" className="history-date-picker w-full sm:w-[178px]" />
            )}
            {view === "month" && (
              <label className="history-filter-field block min-w-0 sm:w-[210px]">
                <span className="history-filter-label">月份</span>
                {months.length > 0 ? (
                  <Select value={selectedMonth || undefined} onValueChange={handleMonthChange}>
                    <SelectTrigger className="history-select-trigger" aria-label="选择月份">
                      <CalendarRange size={14} aria-hidden="true" />
                      <SelectValue placeholder="选择月份" />
                    </SelectTrigger>
                    <SelectContent align="end" className="history-select-content">
                      {months.map((month) => {
                        const key = monthKey(month);
                        return <SelectItem key={key} value={key} className="history-select-item">{formatMonth(key)}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="history-select-empty" role="status">{loading ? "加载月份…" : "暂无月份"}</div>
                )}
              </label>
            )}
            {view === "trash" && (
              <p className="history-filter-note"><Trash2 size={14} aria-hidden="true" /> <span>移入回收站的记录会保留，恢复后可以继续编辑。</span></p>
            )}
            {dateLookupLoading && <span className="history-lookup-status" role="status">正在查找…</span>}
          </div>
        </div>
      </div>

      <div className="history-body flex min-h-0 flex-1 flex-col xl:flex-row">
        <section className="history-list-pane flex min-h-0 min-w-0 flex-1 flex-col" aria-label="每日记录列表">
          <div className="history-list-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5 sm:px-6 sm:pt-6 md:px-8 xl:px-6">
            <div className="history-list-header">
              <span className="history-list-title">{view === "trash" ? "已移入回收站" : view === "month" ? (selectedMonth ? formatMonth(selectedMonth) : "月份记录") : "最近记录"}</span>
              <span className="history-list-count">{loading && articles.length === 0 ? "…" : `${articles.length}${articles.length < total ? ` / ${total}` : ""}`} 条</span>
            </div>

            {error && (
              <div className="history-error-banner mb-5">
                <InlineError message={error} onRetry={retryList} retrying={loading} />
              </div>
            )}

            <div className="history-timeline">
              <div className="history-timeline-line" aria-hidden="true" />
              <AnimatePresence initial={false}>
                {groupedArticles.map((group) => (
                  <section key={group.key} className={`history-group ${group.key === "today" ? "is-today" : ""}`}>
                    <div className="history-group-rail" aria-hidden="true">
                      <span className={`history-group-marker ${group.key === "today" ? "is-today" : ""}`} />
                    </div>
                    <div className="history-group-content">
                      <div className="history-group-heading">
                        <h2>{group.label}</h2>
                        <span>{group.items.length} 条</span>
                      </div>
                      <div className="history-group-items">
                        {group.items.map((article, index) => (
                          view === "trash" ? (
                            <DeletedRecordCard
                              key={article.id}
                              article={article}
                              delay={index}
                              onRestore={() => void handleRestore(article)}
                            />
                          ) : (
                            <HistoryCard
                              key={article.id}
                              article={article}
                              selected={selectedId === article.id}
                              delay={index}
                              onOpen={(event) => void openDetail(article.id, event.currentTarget)}
                              onEdit={(event) => handleEdit(article.date, event)}
                              onDelete={(event) => void handleDelete(article, event)}
                            />
                          )
                        ))}
                      </div>
                    </div>
                  </section>
                ))}
              </AnimatePresence>
            </div>

            {loading && articles.length === 0 && <HistoryListLoading label={view === "trash" ? "加载回收站…" : "加载记录…"} />}

            {!loading && !error && articles.length === 0 && (
              <HistoryEmptyState view={view} onWrite={startToday} />
            )}

            {hasMore && (
              <button type="button" onClick={() => void loadPage(page + 1, view)} disabled={loading} className="history-load-more">
                {loading ? "加载中…" : `加载更多（还剩 ${Math.max(0, total - articles.length)} 条）`}
              </button>
            )}
          </div>
        </section>

      <section className="history-detail-pane hidden min-h-0 min-w-0 flex-1 xl:flex" aria-label="记录详情">
        <AnimatePresence mode="wait" initial={false}>
          {selectedId && detailStatus === "loading" && <DetailLoading key="loading" />}
          {selectedId && detailStatus === "error" && (
            <DetailError key="error" message={detailError} onRetry={retryDetail} onClose={closeDetail} />
          )}
          {selectedId && detailStatus === "ready" && detail && (
            <motion.div key={detail.id} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} className="min-h-full w-full">
              <ArticleDetail
                article={detail}
                mode="panel"
                onClose={closeDetail}
                onEdit={(date) => handleEdit(date)}
                onDelete={(article) => void handleDelete(article)}
              />
            </motion.div>
          )}
          {!selectedId && (
            <motion.div key="placeholder" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="history-detail-placeholder">
              <span className="history-detail-placeholder-mark" aria-hidden="true"><CalendarDays size={22} /></span>
              <h2>选择一条记录</h2>
              <p>详情会显示在这里，列表位置不会改变。</p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
      </div>

      <Dialog.Root
        open={mobileDetailOpen && !!selectedId}
        onOpenChange={(open) => { if (!open) closeDetail(); }}
      >
        <AnimatePresence>
          {mobileDetailOpen && selectedId && (
            <Dialog.Portal>
              <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in xl:hidden" />
              <Dialog.Content
                asChild
                onCloseAutoFocus={(event) => {
                  if (!detailTriggerRef.current) return;
                  event.preventDefault();
                  detailTriggerRef.current.focus();
                }}
              >
                <motion.div
                  className="history-detail-dialog-frame fixed inset-0 z-50 outline-hidden xl:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  onClick={(event) => { if (event.target === event.currentTarget) closeDetail(); }}
                >
                  <Dialog.Title className="sr-only">{detail?.title || "每日记录详情"}</Dialog.Title>
                  <Dialog.Description className="sr-only">查看、编辑或将这条每日记录移入回收站。</Dialog.Description>
                  <motion.div
                    className="history-detail-dialog-surface ui-modal-surface absolute overflow-y-auto"
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                  >
                    {detailStatus === "loading" && <DetailLoading />}
                    {detailStatus === "error" && <DetailError message={detailError} onRetry={retryDetail} onClose={closeDetail} />}
                    {detailStatus === "ready" && detail && (
                      <ArticleDetail
                        article={detail}
                        mode="panel"
                        onClose={closeDetail}
                        onEdit={(date) => handleEdit(date)}
                        onDelete={(article) => void handleDelete(article)}
                      />
                    )}
                  </motion.div>
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
      {dialog}
    </motion.div>
  );
}

function HistoryListLoading({ label }: { label: string }) {
  return (
    <div className="history-list-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="history-loading-heading">
        <span>{label}</span>
        <span className="ui-skeleton h-2 w-14 rounded-full" />
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="history-loading-row">
          <span className="ui-skeleton h-3 w-20 rounded-full" />
          <span className="ui-skeleton h-4 w-2/5 rounded-md" />
          <span className="ui-skeleton h-3 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

function HistoryEmptyState({ view, onWrite }: { view: HistoryView; onWrite: () => void }) {
  const isTrash = view === "trash";
  const isMonth = view === "month";
  const Icon = isTrash ? Trash2 : SearchX;
  const title = isTrash ? "回收站是空的" : isMonth ? "这个月还没有记录" : "还没有每日记录";
  const description = isTrash ? "之后移入回收站的记录会显示在这里。" : isMonth ? "选择其他月份，或写下今天的记录。" : "从今天开始，写下第一条每日记录吧。";
  return (
    <div className="history-empty-state">
      <span className="history-empty-mark" aria-hidden="true"><Icon size={20} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {!isTrash && <button type="button" onClick={onWrite} className="ui-button-primary history-empty-action"><PenLine size={14} /> 去记录</button>}
    </div>
  );
}

function DetailLoading() {
  return (
    <div className="mx-auto flex min-h-[320px] w-full max-w-2xl flex-col gap-4 py-6" role="status" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-3">
        <span className="ui-skeleton h-4 w-24 rounded-full" />
        <span className="ui-skeleton h-9 w-40 rounded-lg" />
      </div>
      <span className="ui-skeleton h-8 w-3/5 rounded-lg" />
      <div className="space-y-3 pt-4">
        <span className="ui-skeleton block h-4 w-full rounded-full" />
        <span className="ui-skeleton block h-4 w-11/12 rounded-full" />
        <span className="ui-skeleton block h-4 w-4/5 rounded-full" />
      </div>
    </div>
  );
}

function DetailError({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div className="mx-auto flex min-h-[320px] w-full max-w-xl flex-col justify-center gap-4">
      <InlineError message={message} onRetry={onRetry} />
      <button type="button" onClick={onClose} className="ui-button-secondary min-h-11 self-start sm:min-h-9">关闭详情</button>
    </div>
  );
}

function HistoryCard({
  article,
  selected,
  delay,
  onOpen,
  onEdit,
  onDelete,
}: {
  article: ArticleSummary;
  selected: boolean;
  delay: number;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  onEdit: (event: MouseEvent<HTMLButtonElement>) => void;
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const spaces = article.spaces || [];
  const tags = article.tags || [];
  const preview = cleanPreview(article.preview);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay < 8 ? delay * 0.018 : 0, duration: 0.2 }}
      className={`history-card group ${selected ? "history-card-selected" : ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`打开 ${article.date} ${article.title || "无标题"} 详情`}
        className="history-card-main flex w-full min-w-0 flex-col text-left outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40"
      >
        <div className="history-card-topline">
          <time className="history-card-date" dateTime={article.date}>{formatShortDate(article.date)}</time>
          {article.mood && <span className="history-card-mood" aria-label="当天心情">{article.mood}</span>}
        </div>
        <h3 className={`history-card-title break-words ${article.title?.trim() ? "" : "is-empty"}`}>{article.title || "(无标题)"}</h3>
        <p className={`history-card-preview line-clamp-2 break-words ${preview ? "" : "is-empty"}`}>
          {preview || "暂无正文摘要"}
        </p>
      </button>
      <div className={`history-card-footer ${spaces.length > 0 || tags.length > 0 ? "" : "is-actions-only"}`}>
        <div className="history-card-context flex min-w-0 flex-wrap gap-1.5" aria-label="记录所属空间和主题">
          {spaces.slice(0, 2).map((space) => (
            <span key={space} className="history-card-chip history-card-chip-space">
              <Folder size={11} className="shrink-0" /> <span className="truncate">{space}</span>
            </span>
          ))}
          {tags.slice(0, 3).map((tag) => <span key={tag} className="history-card-chip">#{tag}</span>)}
          {(spaces.length > 2 || tags.length > 3) && <span className="history-card-more">+{Math.max(0, spaces.length - 2) + Math.max(0, tags.length - 3)}</span>}
        </div>
        <CardActions onEdit={onEdit} onDelete={onDelete} date={article.date} />
      </div>
    </motion.div>
  );
}

function CardActions({ onEdit, onDelete, date }: { onEdit: (event: MouseEvent<HTMLButtonElement>) => void; onDelete: (event: MouseEvent<HTMLButtonElement>) => void; date: string }) {
  return (
    <div className="history-card-actions flex shrink-0 items-center gap-1">
      <button type="button" onClick={onEdit} className="history-card-action" aria-label={`编辑 ${date} 的记录`}><PenLine size={13} aria-hidden="true" /> 编辑</button>
      <button type="button" onClick={onDelete} className="history-card-action history-card-action-danger" aria-label={`移入回收站 ${date} 的记录`}><Trash2 size={13} aria-hidden="true" /> 移入回收站</button>
    </div>
  );
}

function DeletedRecordCard({ article, delay, onRestore }: { article: ArticleSummary; delay: number; onRestore: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay < 8 ? delay * 0.018 : 0, duration: 0.2 }}
      className="history-trash-card flex min-w-0 items-start justify-between gap-3"
    >
      <div className="min-w-0">
        <div className="history-trash-meta flex flex-wrap items-center gap-2">
          <span className="history-trash-status"><Trash2 size={12} aria-hidden="true" /> 已移入回收站</span>
          <time className="history-card-date" dateTime={article.date}>{formatShortDate(article.date)}</time>
        </div>
        <h3 className="history-trash-title break-words">{article.title || "(无标题)"}</h3>
        <p className="history-trash-preview line-clamp-2 break-words">{cleanPreview(article.preview) || "暂无正文摘要"}</p>
      </div>
      <button type="button" onClick={onRestore} className="history-restore-button shrink-0" aria-label={`恢复 ${article.date} 的记录`}>
        <RotateCcw size={13} /> 恢复
      </button>
    </motion.div>
  );
}

function cleanPreview(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " 代码片段 ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function groupArticlesByTime(articles: ArticleSummary[]) {
  const today = new Date();
  const todayKey = formatDate(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatDate(yesterday);
  const groups = new Map<string, { key: string; label: string; items: ArticleSummary[] }>();

  for (const article of [...articles].sort((a, b) => b.date.localeCompare(a.date))) {
    const month = article.date.slice(0, 7);
    const key = article.date === todayKey ? "today" : article.date === yesterdayKey ? "yesterday" : month;
    const label = key === "today" ? "今天" : key === "yesterday" ? "昨天" : formatMonth(month);
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key)!.items.push(article);
  }
  return [...groups.values()];
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatShortDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}.${month}.${day}` : value;
}

function isValidMonth(value?: string): value is string {
  return !!value && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
}

function monthKey(month: ArchiveMonth): string {
  return `${month.year}-${String(month.month).padStart(2, "0")}`;
}

function formatMonth(value: string): string {
  if (!isValidMonth(value)) return value;
  const [year, month] = value.split("-").map(Number);
  return `${year} 年 ${MONTH_NAMES[month - 1] || `${month} 月`}`;
}

function isHistoryView(value: string): value is HistoryView {
  return value === "timeline" || value === "month" || value === "trash";
}
