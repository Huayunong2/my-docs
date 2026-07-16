import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays, Edit3, FileText, SearchX, Trash2 } from "lucide-react";
import * as api from "../lib/api";
import type { Article, ArticleSummary } from "../lib/api";
import ArticleDetail from "./ArticleDetail";
import { EmptyState, InlineError, LoadingState, useConfirmDialog } from "./ui/Feedback";

const PAGE_SIZE = 20;

export default function HistoryPage({ onEditDate }: { onEditDate: (date: string) => void }) {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Article | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const groupedArticles = useMemo(() => groupArticlesByTime(articles), [articles]);

  const loadArticles = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const list = await api.listArticles(p, PAGE_SIZE);
      if (p === 1) {
        setArticles(list);
      } else {
        setArticles((prev) => [...prev, ...list]);
      }
    } catch (e: any) {
      setError(api.getErrorMessage(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadArticles(1);
  }, [loadArticles]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    loadArticles(next);
  };

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
    try {
      const a = await api.getArticle(id);
      setDetail(a);
    } catch (e) {
      setError(api.getErrorMessage(e));
    }
  };

  const closeDetail = () => {
    setMobileDetailOpen(false);
    window.setTimeout(() => {
      setSelectedId(null);
      setDetail(null);
    }, 140);
  };

  const handleDelete = async (article: Article | ArticleSummary, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const ok = await confirm({
      title: "删除记录",
      message: `确定要删除 ${article.date} 的记录吗？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteArticle(article.id);
      if (selectedId === article.id) {
        closeDetail();
      }
      setArticles((prev) => prev.filter((a) => a.id !== article.id));
    } catch (err) {
      setError(api.getErrorMessage(err));
    }
  };

  const handleEdit = (date: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onEditDate(date);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full flex flex-col md:flex-row"
    >
      {/* Timeline list */}
      <div
        className={[
          "overflow-y-auto px-3 pb-24 pt-4 sm:px-4 md:px-6 md:py-6",
          selectedId
            ? "md:w-[44%] md:min-w-[380px] md:max-w-[660px] md:flex-none xl:w-[640px]"
            : "flex-1 md:px-8",
        ].join(" ")}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="hidden h-10 w-10 items-center justify-center rounded-xl bg-accent-light text-accent dark:bg-accent-light/20 sm:flex">
              <CalendarDays size={19} strokeWidth={2.2} />
            </span>
            <div>
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">历史记录</h2>
              <p className="mt-0.5 text-sm text-gray-400 dark:text-gray-400">
                {articles.length > 0 ? `已加载 ${articles.length} 篇记录` : "按时间回看每日记录"}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <AnimatePresence>
            {groupedArticles.map((group) => (
              <section key={group.key}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {group.label}
                  </h3>
                  <span className="h-px flex-1 bg-gray-100 dark:bg-white/10" />
                  <span className="text-[11px] text-gray-300 dark:text-gray-600">{group.items.length} 篇</span>
                </div>
                <div className={selectedId ? "grid gap-3" : "grid gap-3 xl:grid-cols-2 2xl:grid-cols-3"}>
                  {group.items.map((a, i) => (
                    <HistoryCard
                      key={a.id}
                      article={a}
                      selected={selectedId === a.id}
                      delay={i}
                      onOpen={() => openDetail(a.id)}
                      onEdit={(e) => handleEdit(a.date, e)}
                      onDelete={(e) => handleDelete(a, e)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </AnimatePresence>
        </div>

        {articles.length >= PAGE_SIZE && (
          <button
            onClick={loadMore}
            disabled={loading}
            className="w-full mt-4 py-3 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors duration-200"
          >
            {loading ? "加载中..." : "加载更多"}
          </button>
        )}

        {loading && articles.length === 0 && (
          <LoadingState label="加载历史记录..." rows={3} />
        )}

        {error && (
          <div className="py-8">
            <InlineError message={error} onRetry={() => { setError(""); loadArticles(1); }} />
            <button onClick={() => { setError(""); loadArticles(1); }} className="mt-3 text-sm text-accent hover:underline">重试</button>
          </div>
        )}

        {!loading && !error && articles.length === 0 && (
          <EmptyState
            icon={SearchX}
            title="还没有任何记录"
            description="去「记录」页写点东西吧。"
          />
        )}
      </div>

      {/* Detail panel */}
      <AnimatePresence>
        {selectedId && detail && (
          <motion.div
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            className="
              hidden md:block flex-1 min-w-[440px] border-l border-gray-200/60 dark:border-white/10
              overflow-y-auto bg-white px-6 py-5 dark:bg-surface-dark xl:px-8
            "
          >
            <ArticleDetail
              article={detail}
              mode="panel"
              onClose={closeDetail}
              onEdit={(date) => handleEdit(date)}
              onDelete={(article) => handleDelete(article)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {mobileDetailOpen && detail && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/35 p-3 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={closeDetail}
          >
            <motion.div
              className="absolute inset-x-3 bottom-3 top-6 overflow-y-auto rounded-2xl border border-gray-200/60 bg-white p-4 shadow-modal dark:border-white/10 dark:bg-surface-dark"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
            >
              <ArticleDetail
                article={detail}
                mode="panel"
                onClose={closeDetail}
                onEdit={(date) => handleEdit(date)}
                onDelete={(article) => handleDelete(article)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {dialog}
    </motion.div>
  );
}

function cleanPreview(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
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
  onOpen: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <motion.div
      key={article.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay < 8 ? delay * 0.018 : 0, duration: 0.2 }}
      onClick={onOpen}
      className={`ui-panel cursor-pointer group p-4 transition-all duration-200 hover:border-accent/25 hover:shadow-card-hover dark:hover:shadow-card-dark-hover ${selected ? "ring-2 ring-accent/50 border-accent/50" : ""}`}
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 font-mono text-[11px] text-gray-500 dark:bg-white/[0.05] dark:text-gray-400">
                <CalendarDays size={12} /> {article.date}
              </span>
              {article.mood && <span className="text-sm">{article.mood}</span>}
              <span className="text-[11px] text-gray-300 dark:text-gray-600">·</span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500">{article.word_count} 字</span>
            </div>
            <h3 className="truncate text-base font-semibold text-gray-800 dark:text-gray-100">
              {article.title || "(无标题)"}
            </h3>
          </div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-light text-accent opacity-80 dark:bg-accent-light/20">
            <FileText size={16} />
          </span>
        </div>
        <p className="line-clamp-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
          {cleanPreview(article.preview)}
        </p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-white/10">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {article.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-300">
                #{tag}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onEdit}
              className="ui-icon-button h-10 w-10 opacity-100 sm:h-8 sm:w-8 sm:opacity-0 sm:group-hover:opacity-100"
              title="编辑"
            >
              <Edit3 size={14} />
            </button>
            <button
              onClick={onDelete}
              className="ui-icon-button h-10 w-10 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-300 sm:h-8 sm:w-8 sm:opacity-0 sm:group-hover:opacity-100"
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function groupArticlesByTime(articles: ArticleSummary[]) {
  const today = new Date();
  const todayKey = formatDate(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatDate(yesterday);
  const groups = new Map<string, { key: string; label: string; items: ArticleSummary[] }>();

  for (const article of [...articles].sort((a, b) => b.date.localeCompare(a.date))) {
    const key = article.date === todayKey
      ? "today"
      : article.date === yesterdayKey
        ? "yesterday"
        : article.date.slice(0, 7);
    const label = key === "today" ? "今天" : key === "yesterday" ? "昨天" : `${key.slice(0, 4)} 年 ${Number(key.slice(5, 7))} 月`;
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key)!.items.push(article);
  }

  return [...groups.values()];
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
