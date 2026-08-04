import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  CheckCircle2,
  ExternalLink,
  Eye,
  Link2,
  PartyPopper,
  PencilLine,
  Sparkles,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import type { KnowledgeCard, ReviewGrade } from "../lib/api";
import { cardTypeLabels, reviewStateLabels } from "../lib/cardLabels";
import type { Page } from "../App";
import MarkdownContent from "./MarkdownContent";
import { EmptyState, InlineError, LoadingState, Toast } from "./ui/Feedback";

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
    className: "border-red-200 bg-red-50 text-red-600 hover:bg-red-100 active:bg-red-200/70 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20",
  },
  {
    grade: "hard",
    label: "困难",
    hint: "2 · 短间隔",
    className: "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 active:bg-amber-200/70 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20",
  },
  {
    grade: "good",
    label: "记得",
    hint: "3 · 正常间隔",
    className: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 active:bg-emerald-200/70 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20",
  },
  {
    grade: "easy",
    label: "轻松",
    hint: "4 · 长间隔",
    className: "border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 active:bg-sky-200/70 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20",
  },
];

export default function ReviewPage({
  onEditDate,
  onNavigate,
  onOpenKnowledgeCard,
}: {
  onEditDate: (date: string) => void;
  onNavigate: (page: Page) => void;
  onOpenKnowledgeCard: (cardId: string) => void;
}) {
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [allCards, setAllCards] = useState<KnowledgeCard[]>([]);
  const [stats, setStats] = useState<api.DueReviewStats | null>(null);
  const [reviewStats, setReviewStats] = useState<api.ReviewStatsResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<KnowledgeCard | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTagsText, setEditTagsText] = useState("");
  const [editRelatedText, setEditRelatedText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadToken = useRef(0);
  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError("");
    try {
      const [res, statsRes, all] = await Promise.all([
        api.getDueReviewCards(20),
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

  const grade = useCallback(
    async (value: ReviewGrade) => {
      if (!current || grading) return;
      setGrading(true);
      setError("");
      try {
        const updated = await api.gradeReviewCard(current.id, value);
        const remaining = cards.filter((card) => card.id !== current.id);
        if (value === "again") {
          // 当天重来：放回队列尾部，稍后再遇到；今日 due 数不减
          setCards([...remaining, updated]);
          setToast("已安排今天稍后再次复习");
        } else {
          setCards(remaining);
          if (remaining.length === 0) {
            // 队列已空：重新拉取以刷新统计与完成态
            void load();
          }
          setToast("已记录，继续下一张");
        }
        setRevealed(false);
        setStats((s) => (s
          ? {
              ...s,
              due: value === "again" ? s.due : Math.max(0, s.due - 1),
              reviewed_today: s.reviewed_today + 1,
            }
          : s));
      } catch (e) {
        setError(api.getErrorMessage(e));
      } finally {
        setGrading(false);
      }
    },
    [cards, current, grading, load]
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

  const openEdit = () => {
    if (!current) return;
    setEditing(current);
    setEditTitle(current.title);
    setEditContent(current.content);
    setEditTagsText(current.tags.join(", "));
    setEditRelatedText(((current.declared_related_ids?.length ? current.declared_related_ids : current.related_ids) || [])
      .map((id) => allCards.find((card) => card.id === id)?.title || "")
      .filter(Boolean)
      .join(", "));
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
      setCards((prev) => prev.map((card) => (card.id === saved.id ? saved : card)));
      setAllCards((prev) => prev.map((card) => (card.id === saved.id ? saved : card)));
      setEditing(null);
      setToast("卡片已更新");
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const finished = !loading && !error && stats !== null && cards.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-full px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6"
    >
      <header className="mb-4 flex flex-col gap-3 md:mb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-100">
            <Brain size={20} /> 间隔复习
          </h2>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-400">按遗忘曲线回顾已沉淀的知识卡片</p>
        </div>
        {stats && (
          <div className="flex gap-2">
            <StatChip label="今日到期" value={stats.due} highlight={stats.due > 0} />
            <StatChip label="已复习" value={stats.reviewed_today} />
            <StatChip label="已沉淀" value={stats.total_confirmed} />
          </div>
        )}
      </header>

      {reviewStats && reviewStats.upcoming.some((d) => d.count > 0) && (
        <div className="mx-auto mb-4 flex max-w-2xl flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-white px-4 py-2.5 dark:border-white/10 dark:bg-white/[0.04]">
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">未来 7 天</span>
          <div className="flex flex-1 items-end gap-1">
            {reviewStats.upcoming.map((day) => (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={`${day.date} · ${day.count} 张`}>
                <span className={`font-mono text-[11px] leading-none ${day.count > 0 ? "text-accent" : "text-gray-300 dark:text-gray-600"}`}>
                  {day.count || ""}
                </span>
                <div className={`h-1.5 w-full rounded-full ${day.count > 0 ? "bg-accent/50" : "bg-gray-100 dark:bg-white/[0.04]"}`} />
              </div>
            ))}
          </div>
          <span className="text-[11px] text-gray-300 dark:text-gray-600">
            {reviewStats.upcoming[0].date.slice(5)}~{reviewStats.upcoming[6].date.slice(5)}
          </span>
        </div>
      )}

      {error && <div className="mb-4"><InlineError message={error} onRetry={load} /></div>}

      <div className="mx-auto max-w-2xl">
        {loading ? (
          <LoadingState label="加载到期卡片..." rows={2} />
        ) : finished ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <EmptyState
              icon={PartyPopper}
              title={stats?.total_confirmed === 0 ? "还没有可复习的卡片" : "今天的复习已完成"}
              description={
                stats?.total_confirmed === 0
                  ? "把草稿卡片确认入库后，就会出现在这里。"
                  : `今天已复习 ${stats?.reviewed_today ?? 0} 张，明天再来巩固。`
              }
              action={
                stats?.total_confirmed === 0 ? (
                  <button type="button" onClick={() => onNavigate("knowledge")} className="ui-button-primary">
                    去知识页确认卡片
                  </button>
                ) : undefined
              }
            />
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
                  <span className="rounded-md bg-accent-light px-2 py-0.5 text-[11px] font-semibold text-accent dark:bg-accent-light/20">
                    {cardTypeLabels[current.card_type]}
                  </span>
                  {current.review_state && current.review_state !== "new" && (
                    <span
                      className={[
                        "rounded-md px-2 py-0.5 text-[11px] font-medium",
                        current.review_state === "mature"
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
                          : "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
                      ].join(" ")}
                    >
                      {reviewStateLabels[current.review_state] || current.review_state}
                    </span>
                  )}
                  {current.source_date && (
                    <span className="font-mono text-xs text-gray-400 dark:text-gray-500">
                      {current.source_date}
                    </span>
                  )}
                  {current.review_count ? (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      复习过 {current.review_count} 次
                    </span>
                  ) : null}
                </div>

                <h3 className="text-lg font-bold leading-snug text-gray-800 dark:text-gray-100">
                  {current.title}
                </h3>

                {current.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {current.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
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
                    <span className="text-xs text-gray-400 dark:text-gray-500">按空格键快速显示</span>
                  </div>
                ) : (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5">
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/[0.035]">
                      <MarkdownContent content={current.content} />
                    </div>

                    {current.source_excerpt && (
                      <div className="mt-3 rounded-xl border border-amber-200/40 bg-amber-50/70 p-3 dark:border-amber-500/15 dark:bg-amber-500/[0.06]">
                        <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                          <Sparkles size={11} /> 原文片段
                        </div>
                        <p className="text-xs leading-5 text-amber-900/80 dark:text-amber-200/70">
                          {current.source_excerpt}
                        </p>
                      </div>
                    )}

                    {current.source_date && (
                      <button
                        type="button"
                        onClick={openSource}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                      >
                        <ExternalLink size={12} /> 查看来源
                      </button>
                    )}

                    {relatedCards.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                          <Link2 size={11} /> 关联
                        </span>
                        {relatedCards.map((related) => (
                          <button
                            key={related.id}
                            type="button"
                            onClick={() => onOpenKnowledgeCard(related.id)}
                            className="rounded-md bg-accent-light px-2 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent-light/70 dark:bg-accent-light/20"
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
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-xs font-medium text-gray-500 transition-colors hover:border-accent/30 hover:text-accent dark:border-white/10 dark:text-gray-400"
                      >
                        <PencilLine size={12} /> 编辑卡片
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {gradeOptions.map((option) => (
                        <button
                          key={option.grade}
                          type="button"
                          onClick={() => void grade(option.grade)}
                          disabled={grading}
                          className={[
                            "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border font-semibold transition-all active:scale-95 disabled:opacity-50",
                            option.className,
                          ].join(" ")}
                        >
                          <span className="text-base leading-none">{option.label}</span>
                          <span className="text-[10px] font-normal opacity-70">{option.hint}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>

              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                <CheckCircle2 size={12} className="text-emerald-500" />
                剩余 {cards.length} 张 · 空格翻面，1-4 评分
              </p>
            </motion.div>
          </AnimatePresence>
        ) : null}
      </div>

      {toast && <Toast message={toast} tone="good" autoHideMs={5000} onClose={() => setToast("")} />}

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center"
            onClick={() => setEditing(null)}
          >
            <motion.div
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="ui-panel w-full max-w-md p-4 sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">编辑知识卡片</h3>
                <button type="button" onClick={() => setEditing(null)} className="ui-icon-button h-8 w-8" title="关闭">
                  <X size={15} />
                </button>
              </div>
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StatChip({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="ui-panel flex items-center gap-2 px-3 py-1.5">
      <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
      <span className={`font-mono text-sm font-bold ${highlight ? "text-accent" : "text-gray-700 dark:text-gray-200"}`}>
        {value}
      </span>
    </div>
  );
}
