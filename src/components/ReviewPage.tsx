import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BookMarked,
  Brain,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Eye,
  Link2,
  LoaderCircle,
  PencilLine,
  Sparkles,
  X,
  ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as api from "../lib/api";
import type { KnowledgeCard, ReviewCard, ReviewGrade } from "../lib/api";
import { cardTypeLabels, reviewStateLabels } from "../lib/cardLabels";
import type { Page } from "../App";
import MarkdownContent from "./MarkdownContent";
import { InlineError, LoadingState } from "./ui/Feedback";
import PageHeader from "./ui/PageHeader";
import { toast } from "sonner";

const gradeOptions: Array<{
  grade: ReviewGrade;
  label: string;
  hint: string;
  className: string;
}> = [
  {
    grade: "again",
    label: "忘记",
    hint: "1 · 当天重来",
    className: "ui-status-danger",
  },
  {
    grade: "hard",
    label: "困难",
    hint: "2 · 短间隔",
    className: "ui-status-warning",
  },
  {
    grade: "good",
    label: "记得",
    hint: "3 · 正常间隔",
    className: "ui-status-success",
  },
  {
    grade: "easy",
    label: "轻松",
    hint: "4 · 长间隔",
    className: "ui-status-info",
  },
];

const reviewItemTypeLabels: Record<string, string> = {
  basic: "基础问答",
  cloze: "填空",
  code: "代码题",
  compare: "对比题",
  scenario: "场景题",
};

function formatReviewPreview(preview?: api.ReviewGradePreview): string {
  if (!preview) return "";
  if (preview.interval_days <= 0) return "今天再来";
  if (preview.interval_days === 1) return "明天";
  if (preview.interval_days <= 30) return `${Math.round(preview.interval_days)} 天后`;
  return preview.next_review_at ? `${preview.next_review_at.slice(5).replace("-", "/")}` : "稍后安排";
}

export default function ReviewPage({
  onEditDate,
  onNavigate,
  onOpenKnowledgeCard,
}: {
  onEditDate: (date: string) => void;
  onNavigate: (page: Page) => void;
  onOpenKnowledgeCard: (cardId: string) => void;
}) {
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [allCards, setAllCards] = useState<KnowledgeCard[]>([]);
  const [stats, setStats] = useState<api.DueReviewStats | null>(null);
  const [reviewStats, setReviewStats] = useState<api.ReviewStatsResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<KnowledgeCard | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTagsText, setEditTagsText] = useState("");
  const [editRelatedText, setEditRelatedText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [batchComplete, setBatchComplete] = useState(false);
  const [batchRemaining, setBatchRemaining] = useState(0);

  const loadToken = useRef(0);
  const editingTriggerRef = useRef<HTMLButtonElement | null>(null);
  const queryClient = useQueryClient();
  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError("");
    try {
      const [res, statsRes, all] = await Promise.all([
        api.getDueReviewCards(),
        api.getReviewStats().catch(() => null),
        api.listKnowledgeCards().catch(() => []),
      ]);
      if (token !== loadToken.current) return;
      setCards(res.cards);
      setStats(res.stats);
      setReviewStats(statsRes);
      setAllCards(all);
      setIndex(0);
      setRevealed(false);
      setBatchComplete(false);
      setBatchRemaining(0);
    } catch (e) {
      if (token === loadToken.current) setError(api.getErrorMessage(e));
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const current = cards[index] || null;

  const gradePreviewQuery = useQuery({
    queryKey: api.reviewQueryKeys.preview(current?.id || ""),
    queryFn: ({ signal }) => api.getReviewPreview(current!.id, { signal }),
    enabled: Boolean(current && revealed),
    staleTime: 5 * 60_000,
  });
  const gradePreviews = useMemo(
    () => new Map((gradePreviewQuery.data || []).map((preview) => [preview.grade, preview])),
    [gradePreviewQuery.data]
  );

  const grade = useCallback(
    async (value: ReviewGrade) => {
      if (!current || grading) return;
      setGrading(true);
      setError("");
      try {
        const updated = await api.gradeReviewCard(current.id, value);
        await queryClient.invalidateQueries({ queryKey: api.reviewQueryKeys.preview(current.id) });
        const remaining = cards.filter((card) => card.id !== current.id);
        if (value === "again") {
          // 当天重来：放回队列尾部，稍后再遇到；今日 due 数不减
          setCards([...remaining, updated]);
          toast.success("已安排今天稍后再次复习");
        } else {
          setCards(remaining);
          if (remaining.length === 0) {
            const nextDue = stats ? Math.max(0, stats.due - 1) : 0;
            if (nextDue > 0) {
              // 当前批次完成但服务端仍有待复习卡，停在明确的批次完成态，避免无感跳转。
              setBatchRemaining(nextDue);
              setBatchComplete(true);
            } else {
              // 队列已空：重新拉取以刷新统计与完成态
              void load();
            }
          }
          toast.success("已记录，继续下一张");
        }
        setRevealed(false);
        setStats((s) => (s
          ? {
              ...s,
              due: value === "again" ? s.due : Math.max(0, s.due - 1),
              due_reviews: typeof s.due_reviews === "number"
                ? Math.max(0, s.due_reviews - (value === "again" || !current.next_review_at ? 0 : 1))
                : s.due_reviews,
              new_cards: typeof s.new_cards === "number"
                ? Math.max(0, s.new_cards - (value === "again" || current.next_review_at ? 0 : 1))
                : s.new_cards,
              reviewed_today: s.reviewed_today + 1,
            }
          : s));
      } catch (e) {
        setError(api.getErrorMessage(e));
      } finally {
        setGrading(false);
      }
    },
    [cards, current, grading, load, queryClient, stats]
  );

  // 空格显示答案，1-4 评分
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!current || loading) return;
      if (!revealed) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          setRevealed(true);
        }
        return;
      }
      const map: Record<string, ReviewGrade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
      const gradeKey = map[e.key];
      if (gradeKey) void grade(gradeKey);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, grade, loading, revealed]);

  const openSource = () => {
    if (!current) return;
    if (current.source_review_id) {
      onNavigate("reviews");
      return;
    }
    const date = current.source_date;
    if (date) onEditDate(date);
  };

  const relatedCards = useMemo(
    () => (current?.related_ids || []).map((id) => allCards.find((card) => card.id === id)).filter((card): card is KnowledgeCard => !!card),
    [allCards, current]
  );

  const openEdit = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (!current) return;
    if (event) editingTriggerRef.current = event.currentTarget;
    const loadCard = async () => {
      try {
        const card = allCards.find((item) => item.id === current.knowledge_card_id)
          || await api.getKnowledgeCard(current.knowledge_card_id);
        setEditing(card);
        setEditTitle(card.title);
        setEditContent(card.content);
        setEditTagsText(card.tags.join(", "));
        setEditRelatedText(((card.declared_related_ids?.length ? card.declared_related_ids : card.related_ids) || [])
          .map((id) => allCards.find((item) => item.id === id)?.title || "")
          .filter(Boolean)
          .join(", "));
      } catch (e) {
        setError(api.getErrorMessage(e));
      }
    };
    void loadCard();
  };

  const resolveRelatedIds = (text: string): string[] => {
    const titles = text.split(",").map((title) => title.trim()).filter(Boolean);
    const ids: string[] = [];
    for (const title of titles) {
      const matched = allCards.find((card) => card.id !== editing?.id && card.title === title);
      if (matched && !ids.includes(matched.id)) ids.push(matched.id);
    }
    return ids;
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    setError("");
    try {
      const saved = await api.updateKnowledgeCard(editing.id, {
        title: editTitle.trim(),
        content: editContent.trim(),
        tags: editTagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
        related_ids: resolveRelatedIds(editRelatedText),
      });
      setAllCards((prev) => prev.map((card) => (card.id === saved.id ? saved : card)));
      setEditing(null);
      // 编辑知识正文可能让当前复习题变为 stale；重新取队列，避免继续操作已失效的投影。
      await load();
      toast.success("卡片已更新");
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const finished = !loading && !error && !batchComplete && stats !== null && cards.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-surface page-surface-review min-h-full px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6"
    >
      <PageHeader
        icon={Brain}
        title="间隔复习"
        description="按遗忘曲线回顾独立复习题，知识正文保留在条目中"
        actions={
          stats ? (
            <>
              <StatChip label="今日可复习" value={stats.due} highlight={stats.due > 0} />
              {typeof stats.due_reviews === "number" && <StatChip label="到期复习题" value={stats.due_reviews} />}
              {typeof stats.new_cards === "number" && <StatChip label="可加入新题" value={stats.new_cards} />}
              <StatChip label="已复习" value={stats.reviewed_today} />
              <StatChip label="已沉淀" value={stats.total_confirmed} />
            </>
          ) : null
        }
      />

      {reviewStats && reviewStats.upcoming.some((d) => d.count > 0) && (
        <div className="ui-panel-muted mx-auto mb-4 flex max-w-2xl flex-wrap items-center gap-2 px-4 py-2.5">
          <span className="text-xs font-medium text-[var(--ui-text-muted)]">未来 7 天</span>
          <div className="flex flex-1 items-end gap-1">
            {reviewStats.upcoming.map((day) => (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={`${day.date} · ${day.count} 张`}>
                <span className={`font-mono text-[11px] leading-none ${day.count > 0 ? "text-[var(--ui-accent-text)]" : "text-[var(--ui-text-disabled)]"}`}>
                  {day.count || ""}
                </span>
                <div className={`h-1.5 w-full rounded-full ${day.count > 0 ? "ui-accent-fill-50" : "bg-[var(--ui-surface-inset)]"}`} />
              </div>
            ))}
          </div>
          <span className="text-[11px] text-[var(--ui-text-disabled)]">
            {reviewStats.upcoming[0].date.slice(5)}~{reviewStats.upcoming[6].date.slice(5)}
          </span>
        </div>
      )}

      {error && <div className="mb-4"><InlineError message={error} onRetry={load} /></div>}

      <div className="mx-auto max-w-2xl">
        {loading ? (
          <LoadingState label="加载今日复习队列..." rows={2} />
        ) : batchComplete ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <ReviewBatchComplete
              remaining={batchRemaining}
              onContinue={() => {
                setBatchComplete(false);
                void load();
              }}
              onNavigate={onNavigate}
            />
          </motion.div>
        ) : finished ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <ReviewEmptyState stats={stats} reviewStats={reviewStats} onNavigate={onNavigate} />
          </motion.div>
        ) : current ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.18 }}
            >
              <div className="ui-panel p-5 sm:p-6">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="ui-status-accent rounded-md px-2 py-0.5 text-[11px] font-semibold">
                    {cardTypeLabels[current.card_type]}
                  </span>
                  <span className="ui-chip h-auto px-2 py-0.5 text-[11px]">
                    {reviewItemTypeLabels[current.item_type] || current.item_type}
                  </span>
                  {current.review_state && current.review_state !== "new" && (
                    <span
                      className={[
                        "rounded-md px-2 py-0.5 text-[11px] font-medium",
                        current.review_state === "mature" ? "ui-status-success" : "ui-status-warning",
                      ].join(" ")}
                    >
                      {reviewStateLabels[current.review_state] || current.review_state}
                    </span>
                  )}
                  {current.source_date && (
                    <span className="font-mono text-xs text-[var(--ui-text-subtle)]">
                      {current.source_date}
                    </span>
                  )}
                  {current.review_count ? (
                    <span className="text-xs text-[var(--ui-text-subtle)]">
                      复习过 {current.review_count} 次
                    </span>
                  ) : null}
                </div>

                <h3 className="text-lg font-bold leading-snug text-[var(--ui-text)]">
                  {current.title}
                </h3>

                <div className="ui-panel-muted mt-4 p-4">
                  <div className="ui-section-kicker mb-1.5">问题</div>
                  <div className="text-sm leading-6 text-[var(--ui-text)]">
                    <MarkdownContent content={current.prompt} />
                  </div>
                  {current.hint && !revealed && (
                    <p className="mt-2 text-xs text-[var(--ui-text-subtle)]">提示：{current.hint}</p>
                  )}
                </div>

                {current.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {current.tags.map((tag) => (
                      <span key={tag} className="ui-chip h-auto px-2 py-0.5 text-[11px]">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {!revealed ? (
                  <div className="mt-6 flex flex-col items-center gap-2 pb-2">
                    <button
                      type="button"
                      onClick={() => setRevealed(true)}
                      className="ui-button-primary h-12 w-full max-w-xs text-base"
                    >
                      <Eye size={16} /> 显示答案
                    </button>
                    <span className="text-xs text-[var(--ui-text-subtle)]">按空格键快速显示</span>
                  </div>
                ) : (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5">
                    <div className="ui-panel-muted p-4">
                      <MarkdownContent content={current.answer} />
                    </div>

                    {current.source_excerpt && (
                      <div className="ui-alert-warn mt-3 p-3">
                        <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--ui-warning-text)]">
                          <Sparkles size={11} /> 原文片段
                        </div>
                        <p className="text-xs leading-5 text-[var(--ui-warning-text)] opacity-80">
                          {current.source_excerpt}
                        </p>
                      </div>
                    )}

                    {current.source_date && (
                      <button
                        type="button"
                        onClick={openSource}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--ui-accent-text)] hover:underline"
                      >
                        <ExternalLink size={12} /> 查看来源
                      </button>
                    )}

                    {relatedCards.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ui-text-subtle)]">
                          <Link2 size={11} /> 关联
                        </span>
                        {relatedCards.map((related) => (
                          <button
                            key={related.id}
                            type="button"
                            onClick={() => onOpenKnowledgeCard(related.id)}
                            className="ui-status-accent rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors hover:shadow-xs"
                          >
                            {related.title}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={openEdit}
                        className="ui-button-secondary h-8 px-2.5"
                      >
                        <PencilLine size={12} /> 编辑知识条目
                      </button>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2">
                      <span className="ui-section-kicker">选择记忆程度</span>
                      {gradePreviewQuery.isFetching ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ui-text-subtle)]">
                          <LoaderCircle size={12} className="animate-spin" /> 计算下次复习
                        </span>
                      ) : gradePreviewQuery.isError ? (
                        <span className="text-[11px] text-[var(--ui-text-subtle)]">暂时无法预览</span>
                      ) : (
                        <span className="text-[11px] text-[var(--ui-text-subtle)]">下次复习预览</span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {gradeOptions.map((option) => (
                        <button
                          key={option.grade}
                          type="button"
                          onClick={() => void grade(option.grade)}
                          disabled={grading}
                          className={[
                            "ui-review-grade",
                            option.className,
                          ].join(" ")}
                        >
                          <span className="text-base leading-none">{option.label}</span>
                          <span className="text-[10px] font-normal opacity-70">
                            {formatReviewPreview(gradePreviews.get(option.grade)) || option.hint}
                          </span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>

              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-[var(--ui-text-subtle)]">
                <CheckCircle2 size={12} className="text-[var(--ui-success-text)]" />
                剩余 {cards.length} 道题 · 空格翻面，1-4 评分
              </p>
            </motion.div>
          </AnimatePresence>
        ) : null}
      </div>



      <Dialog.Root
        open={!!editing}
        onOpenChange={(open) => { if (!open && !savingEdit) setEditing(null); }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
          {editing && (
            <Dialog.Content
              asChild
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                editingTriggerRef.current?.focus();
              }}
            >
              <motion.div
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.15 }}
                className="ui-modal-surface fixed inset-x-3 bottom-3 z-50 max-w-md p-4 outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-5"
              >
              <div className="mb-3 flex items-center justify-between">
                <Dialog.Title className="text-sm font-bold text-[var(--ui-text)]">编辑知识卡片</Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" className="ui-icon-button h-8 w-8" title="关闭" aria-label="关闭编辑卡片">
                    <X size={15} />
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">编辑知识卡片的标题、正文、标签和关联卡片。</Dialog.Description>
              <div className="grid gap-3">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="卡片标题"
                  className="ui-field h-10"
                />
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="卡片内容"
                  className="ui-textarea min-h-[140px] text-sm leading-6"
                />
                <input
                  value={editTagsText}
                  onChange={(e) => setEditTagsText(e.target.value)}
                  placeholder="标签，用逗号分隔"
                  className="ui-field h-10"
                />
                <input
                  value={editRelatedText}
                  onChange={(e) => setEditRelatedText(e.target.value)}
                  placeholder="关联卡片（逗号分隔的标题）"
                  className="ui-field h-10"
                />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="ui-button-secondary">
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={savingEdit || !editTitle.trim() || !editContent.trim()}
                  className="ui-button-primary"
                >
                  {savingEdit ? "保存中..." : "保存"}
                </button>
              </div>
              </motion.div>
            </Dialog.Content>
          )}
        </Dialog.Portal>
      </Dialog.Root>
    </motion.div>
  );
}

function StatChip({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className="ui-panel flex items-center gap-2 px-3 py-1.5">
      <span className="text-xs text-[var(--ui-text-subtle)]">{label}</span>
      <span className={`font-mono text-sm font-bold ${highlight ? "text-[var(--ui-accent-text)]" : "text-[var(--ui-text)]"}`}>
        {value}
      </span>
    </div>
  );
}

function ReviewEmptyState({
  stats,
  reviewStats,
  onNavigate,
}: {
  stats: api.DueReviewStats | null;
  reviewStats: api.ReviewStatsResponse | null;
  onNavigate: (page: Page) => void;
}) {
  const hasNoConfirmedCards = (stats?.total_confirmed ?? 0) === 0;
  const reviewedToday = stats?.reviewed_today ?? 0;
  const nextScheduled = reviewStats?.upcoming.find((day) => day.count > 0);
  const title = hasNoConfirmedCards
    ? "从第一张卡片开始"
    : reviewedToday > 0
      ? "今日复习已完成"
      : "今天没有可复习内容";
  const description = hasNoConfirmedCards
    ? "确认一张知识卡片，它就会进入可追踪的间隔复习队列。"
    : reviewedToday > 0
      ? "当前队列已经清空，今天的记忆巩固完成。"
      : "没有需要立即处理的卡片，可以继续整理知识或查看学习节奏。";

  return (
    <section className="ui-panel overflow-hidden">
      <div className="ui-soft-divider border-b px-5 py-7 text-center sm:px-8 sm:py-9">
        <span className="ui-status-accent mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl ring-1 ring-[var(--ui-selected-border)]">
          {hasNoConfirmedCards ? <Brain size={23} strokeWidth={2} /> : <CheckCircle2 size={23} strokeWidth={2} />}
        </span>
        <p className="ui-section-kicker">今日复习</p>
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-[var(--ui-text)]">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ui-text-muted)]">{description}</p>
        <p className="mt-4 text-3xl font-semibold tracking-tight text-[var(--ui-text)]">
          {hasNoConfirmedCards ? "—" : "0"}
          <span className="ml-1 text-sm font-medium text-[var(--ui-text-subtle)]">张待复习卡片</span>
        </p>
      </div>

      <div className="ui-metric-grid grid grid-cols-3">
        <ReviewMetric icon={CheckCircle2} label="今日已复习" value={reviewedToday} suffix="张" />
        <ReviewMetric icon={BookMarked} label="已确认卡片" value={stats?.total_confirmed ?? 0} suffix="张" />
        <ReviewMetric
          icon={CalendarClock}
          label="下一批复习"
          value={nextScheduled ? nextScheduled.date.slice(5) : "—"}
          suffix={nextScheduled ? `${nextScheduled.count} 张` : ""}
        />
      </div>

      <div className="ui-soft-divider flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-center">
        <button type="button" onClick={() => onNavigate("knowledge")} className="ui-button-primary w-full sm:w-auto">
          <BookMarked size={14} /> {hasNoConfirmedCards ? "去知识页确认卡片" : "查看知识库"}
        </button>
        <button type="button" onClick={() => onNavigate("stats")} className="ui-button-secondary w-full sm:w-auto">
          <BarChart3 size={14} /> 查看复习统计
        </button>
      </div>
    </section>
  );
}

function ReviewBatchComplete({
  remaining,
  onContinue,
  onNavigate,
}: {
  remaining: number;
  onContinue: () => void;
  onNavigate: (page: Page) => void;
}) {
  return (
    <section className="ui-panel overflow-hidden">
      <div className="ui-soft-divider border-b px-5 py-7 text-center sm:px-8 sm:py-9">
        <span className="ui-status-success mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl ring-1 ring-[var(--ui-success-border)]">
          <CheckCircle2 size={23} strokeWidth={2} />
        </span>
        <p className="ui-section-kicker">本批复习</p>
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-[var(--ui-text)]">这一批完成了</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ui-text-muted)]">
          还有待复习卡片，可以按自己的节奏继续下一批。
        </p>
        <p className="mt-4 text-3xl font-semibold tracking-tight text-[var(--ui-text)]">
          {remaining}
          <span className="ml-1 text-sm font-medium text-[var(--ui-text-subtle)]">张待复习</span>
        </p>
      </div>
      <div className="ui-soft-divider flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-center">
        <button type="button" onClick={onContinue} className="ui-button-primary w-full sm:w-auto">
          <ArrowRight size={14} /> 继续下一批
        </button>
        <button type="button" onClick={() => onNavigate("stats")} className="ui-button-secondary w-full sm:w-auto">
          <BarChart3 size={14} /> 查看复习统计
        </button>
      </div>
    </section>
  );
}

function ReviewMetric({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  suffix: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 px-2 py-4 text-center sm:px-4">
      <Icon size={14} className="text-[var(--ui-text-subtle)]" />
      <span className="truncate text-[11px] text-[var(--ui-text-subtle)]">{label}</span>
      <span className="text-sm font-semibold text-[var(--ui-text)]">
        {value}
        {suffix && <span className="ml-1 text-[11px] font-normal text-[var(--ui-text-subtle)]">{suffix}</span>}
      </span>
    </div>
  );
}
