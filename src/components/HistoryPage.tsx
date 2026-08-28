import { useEffect, useMemo, useState, useCallback } from "react";
import { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, Edit3, FileText, Folder, PenLine, SearchX, Trash2 } from "lucide-react";
import * as api from "../lib/api";
import type { Article, ArticleSummary } from "../lib/api";
import ArticleDetail from "./ArticleDetail";
import { EmptyState, InlineError, LoadingState, useConfirmDialog } from "./ui/Feedback";
import PageHeader from "./ui/PageHeader";

const PAGE_SIZE = 20;

export default function HistoryPage({ onEditDate }: { onEditDate: (date: string) => void }) {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Article | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
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

  const openDetail = async (id: string, trigger?: HTMLElement) => {
    detailTriggerRef.current = trigger || null;
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
      className="page-surface page-surface-history h-full flex flex-col md:flex-row"
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
        <PageHeader
          icon={CalendarDays}
          title="历史记录"
          description={articles.length > 0 ? `已加载 ${articles.length} 篇记录` : "按时间回看每日记录"}
          className="mb-5"
        />

        <div className="space-y-5">
          <AnimatePresence>
            {groupedArticles.map((group) => (
              <section key={group.key}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-subtle)]">
                    {group.label}
                  </h3>
                  <span className="ui-soft-divider h-px flex-1 border-t" />
                  <span className="text-[11px] text-[var(--ui-text-disabled)]">{group.items.length} 篇</span>
                </div>
                <div className={selectedId ? "grid gap-3" : "grid gap-3 xl:grid-cols-2 2xl:grid-cols-3"}>
                  {group.items.map((a, i) => (
                    <HistoryCard
                      key={a.id}
                      article={a}
                      selected={selectedId === a.id}
                      delay={i}
                      onOpen={(event) => openDetail(a.id, event.currentTarget)}
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
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="ui-button-ghost mt-4 w-full"
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
          </div>
        )}

        {!loading && !error && articles.length === 0 && (
          <EmptyState
            icon={SearchX}
            title="还没有任何记录"
            description="从今天开始，写下第一条吧。"
            action={
              <button
                type="button"
                onClick={() => {
                  const d = new Date();
                  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                  onEditDate(date);
                }}
                className="ui-button-primary"
              >
                <PenLine size={14} /> 去记录
              </button>
            }
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
              ui-soft-divider hidden md:block flex-1 min-w-[440px] border-l
              overflow-y-auto bg-[var(--ui-surface)] px-6 py-5 xl:px-8
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
      <Dialog.Root
        open={mobileDetailOpen && !!detail}
        onOpenChange={(open) => { if (!open) closeDetail(); }}
      >
        <AnimatePresence>
          {mobileDetailOpen && detail && (
            <Dialog.Portal>
              <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in md:hidden" />
              <Dialog.Content
                asChild
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  detailTriggerRef.current?.focus();
                }}
              >
                <motion.div
                  className="fixed inset-0 z-50 p-3 outline-hidden md:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  onClick={(event) => { if (event.target === event.currentTarget) closeDetail(); }}
                >
                  <Dialog.Title className="sr-only">{detail.title || "每日记录详情"}</Dialog.Title>
                  <Dialog.Description className="sr-only">查看、编辑或删除这条每日记录。</Dialog.Description>
                  <motion.div
                    className="ui-modal-surface absolute inset-x-3 bottom-3 top-6 overflow-y-auto p-4"
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
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
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
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
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <motion.div
      key={article.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay < 8 ? delay * 0.018 : 0, duration: 0.2 }}
      className={`ui-panel card-interactive group p-4 ${selected ? "card-interactive-selected" : ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`打开 ${article.date} ${article.title || "无标题"} 详情`}
        className="flex w-full flex-col gap-3 rounded-lg text-left outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="ui-chip h-auto px-2 py-0.5 font-mono text-[11px]">
                <CalendarDays size={12} /> {article.date}
              </span>
              {article.mood && <span className="text-sm">{article.mood}</span>}
              <span className="text-[11px] text-[var(--ui-text-disabled)]">·</span>
              <span className="text-[11px] text-[var(--ui-text-subtle)]">{article.word_count} 字</span>
            </div>
            <h3 className="truncate text-base font-semibold text-[var(--ui-text)]">
              {article.title || "(无标题)"}
            </h3>
          </div>
          <span className="ui-status-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-lg opacity-80">
            <FileText size={16} />
          </span>
        </div>
        <p className="line-clamp-3 text-sm leading-6 text-[var(--ui-text-muted)]">
          {cleanPreview(article.preview)}
        </p>
      </button>
      <div className="ui-soft-divider mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {(article.spaces || []).slice(0, 4).map((space) => (
            <span key={space} className="ui-chip h-auto gap-1 border-[var(--ui-selected-border)] bg-[var(--ui-surface-selected)] px-2 py-0.5 text-[11px] text-[var(--ui-accent-text)]">
              <Folder size={11} /> {space}
            </span>
          ))}
          {article.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="ui-chip h-auto px-2 py-0.5 text-[11px]">
              #{tag}
            </span>
          ))}
        </div>
            <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="ui-icon-button h-10 w-10 opacity-100 sm:h-8 sm:w-8 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            title="编辑"
            aria-label={`编辑 ${article.date} 的记录`}
          >
            <Edit3 size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="ui-icon-button ui-icon-button-danger h-10 w-10 sm:h-8 sm:w-8 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            title="删除"
            aria-label={`删除 ${article.date} 的记录`}
          >
            <Trash2 size={14} />
          </button>
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
