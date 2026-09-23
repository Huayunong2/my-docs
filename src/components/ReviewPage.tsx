import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
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
  PencilLine,
  X,
  ArrowRight,
  ArrowLeft,
  HelpCircle,
  RotateCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as api from "../lib/api";
import type { KnowledgeCard, ReviewCard, ReviewGrade } from "../lib/api";
import { cardTypeLabels } from "../lib/cardLabels";
import type { Page } from "../App";
import MarkdownContent from "./MarkdownContent";
import { InlineError, LoadingState, useConfirmDialog } from "./ui/Feedback";
import WorkspaceHeader from "./workspace/WorkspaceHeader";
import { isKnowledgeShortcut } from "../lib/knowledgePresentation";
import { writeSessionStorage } from "../lib/storage";
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
  if (preview.interval_days <= 30)
    return `${Math.round(preview.interval_days)} 天后`;
  return preview.next_review_at
    ? `${preview.next_review_at.slice(5).replace("-", "/")}`
    : "稍后安排";
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
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionRatings, setSessionRatings] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const gradeLock = useRef(false);
  const discardLock = useRef(false);
  const { confirm, dialog } = useConfirmDialog();
  const questionRef = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [stats, setStats] = useState<api.DueReviewStats | null>(null);
  const [reviewStats, setReviewStats] =
    useState<api.ReviewStatsResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<KnowledgeCard | null>(null);
  const [editLabelIndex, setEditLabelIndex] = useState<api.KnowledgeCardLabel[] | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
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
  const editorLoadToken = useRef(0);
  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError("");
    try {
      const [res, statsRes] = await Promise.all([
        api.getDueReviewCards(),
        api.getReviewStats().catch(() => null),
      ]);
      if (token !== loadToken.current) return;
      editorLoadToken.current += 1;
      setEditorLoading(false);
      setCards(res.cards);
      setStats(res.stats);
      setReviewStats(statsRes);
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
  const currentCardIdRef = useRef<string | null>(null);
  currentCardIdRef.current = current?.knowledge_card_id || null;
  const currentRelatedIds = current?.related_ids || [];
  const relatedLabelsQuery = useQuery({
    queryKey: api.knowledgeQueryKeys.labels(currentRelatedIds),
    queryFn: ({ signal }) => api.getKnowledgeCardLabels(currentRelatedIds, { signal }),
    enabled: Boolean(current && revealed && currentRelatedIds.length),
    staleTime: 5 * 60_000,
  });

  const gradePreviewQuery = useQuery({
    queryKey: api.reviewQueryKeys.preview(current?.id || ""),
    queryFn: ({ signal }) => api.getReviewPreview(current!.id, { signal }),
    enabled: Boolean(current && revealed),
    staleTime: 5 * 60_000,
  });
  const gradePreviews = useMemo(
    () =>
      new Map(
        (gradePreviewQuery.data || []).map((preview) => [
          preview.grade,
          preview,
        ]),
      ),
    [gradePreviewQuery.data],
  );

  const grade = useCallback(
    async (value: ReviewGrade) => {
      if (
        !current ||
        !revealed ||
        !sessionStarted ||
        grading ||
        gradeLock.current
      )
        return;
      gradeLock.current = true;
      editorLoadToken.current += 1;
      setEditorLoading(false);
      setGrading(true);
      setError("");
      try {
        const updated = await api.gradeReviewCard(current.id, value);
        setSessionRatings((count) => count + 1);
        void queryClient.invalidateQueries({ queryKey: ["dueCount"] });
        setShowHint(false);
        await queryClient.invalidateQueries({
          queryKey: api.reviewQueryKeys.preview(current.id),
        });
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
        setStats((s) =>
          s
            ? {
                ...s,
                due: value === "again" ? s.due : Math.max(0, s.due - 1),
                due_reviews:
                  typeof s.due_reviews === "number"
                    ? Math.max(
                        0,
                        s.due_reviews -
                          (value === "again" || !current.next_review_at
                            ? 0
                            : 1),
                      )
                    : s.due_reviews,
                new_cards:
                  typeof s.new_cards === "number"
                    ? Math.max(
                        0,
                        s.new_cards -
                          (value === "again" || current.next_review_at ? 0 : 1),
                      )
                    : s.new_cards,
                reviewed_today: s.reviewed_today + 1,
              }
            : s,
        );
      } catch (e) {
        setError(api.getErrorMessage(e));
      } finally {
        gradeLock.current = false;
        setGrading(false);
      }
    },
    [
      cards,
      current,
      revealed,
      sessionStarted,
      grading,
      load,
      queryClient,
      stats,
    ],
  );

  // 空格显示答案，1-4 评分
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !isKnowledgeShortcut(e) ||
        e.repeat ||
        editing ||
        grading ||
        !sessionStarted ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      if (!current || loading) return;
      if (!revealed) {
        if (
          (e.key === " " || e.key === "Enter") &&
          !(e.target instanceof Element && e.target.closest("button, a"))
        ) {
          e.preventDefault();
          setRevealed(true);
        }
        return;
      }
      const map: Record<string, ReviewGrade> = {
        "1": "again",
        "2": "hard",
        "3": "good",
        "4": "easy",
      };
      const gradeKey = map[e.key];
      if (gradeKey) void grade(gradeKey);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, grade, loading, revealed, sessionStarted, editing, grading]);

  useEffect(() => {
    if (sessionStarted && current) {
      setShowHint(false);
      questionRef.current?.parentElement?.scrollTo({ top: 0 });
      questionRef.current?.focus({ preventScroll: true });
    }
  }, [current?.id, sessionStarted]);

  const openSource = () => {
    if (!current) return;
    if (current.source_review_id) {
      onNavigate("reviews");
      return;
    }
    const date = current.source_date;
    if (date) onEditDate(date);
  };

  const relatedCards = relatedLabelsQuery.data || [];

  const openEdit = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (!current || editorLoading) return;
    if (event) editingTriggerRef.current = event.currentTarget;
    const cardId = current.knowledge_card_id;
    const requestId = ++editorLoadToken.current;
    setEditorLoading(true);
    void Promise.all([
      api.getKnowledgeCard(cardId),
      api.getKnowledgeCardLabels(),
    ])
      .then(([card, labels]) => {
        if (
          requestId !== editorLoadToken.current ||
          currentCardIdRef.current !== cardId
        ) return;
        setEditLabelIndex(labels);
        setEditing(card);
        setEditTitle(card.title);
        setEditContent(card.content);
        setEditTagsText(card.tags.join(", "));
        setEditRelatedText(
          ((card.declared_related_ids?.length
            ? card.declared_related_ids
            : card.related_ids) || [])
            .map((id) => labels.find((item) => item.id === id)?.title || "")
            .filter(Boolean)
            .join(", "),
        );
      })
      .catch((error) => {
        if (
          requestId === editorLoadToken.current &&
          currentCardIdRef.current === cardId
        ) {
          toast.error(`无法加载知识条目编辑信息：${api.getErrorMessage(error)}。请重试。`);
        }
      })
      .finally(() => {
        if (requestId === editorLoadToken.current) setEditorLoading(false);
      });
  };

  const resolveRelatedIds = (text: string): string[] => {
    const titles = text
      .split(",")
      .map((title) => title.trim())
      .filter(Boolean);
    const ids: string[] = [];
    for (const title of titles) {
      const matched = editLabelIndex?.find(
        (card) => card.id !== editing?.id && card.title === title,
      );
      if (matched && !ids.includes(matched.id)) ids.push(matched.id);
    }
    return ids;
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    setError("");
    try {
      await api.updateKnowledgeCard(editing.id, {
        title: editTitle.trim(),
        content: editContent.trim(),
        tags: editTagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        related_ids: resolveRelatedIds(editRelatedText),
      });
      setEditing(null);
      setEditLabelIndex(null);
      // 编辑知识正文可能让当前复习题变为 stale；重新取队列，避免继续操作已失效的投影。
      await load();
      toast.success("卡片已更新");
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const finished =
    !loading &&
    !error &&
    !batchComplete &&
    stats !== null &&
    cards.length === 0;

  const closeEditor = async () => {
    if (!editing || savingEdit || discardLock.current) return;
    const changed =
      editTitle !== editing.title ||
      editContent !== editing.content ||
      editTagsText !== editing.tags.join(", ") ||
      editRelatedText !==
        (
          (editing.declared_related_ids?.length
            ? editing.declared_related_ids
            : editing.related_ids) || []
        )
          .map((id) => editLabelIndex?.find((card) => card.id === id)?.title || "")
          .filter(Boolean)
          .join(", ");
    if (changed) {
      discardLock.current = true;
      try {
        const leave = await confirm({
          title: "放弃知识条目的修改？",
          message: "当前标题或正文的修改尚未保存。",
          confirmText: "放弃修改",
        });
        if (!leave) return;
      } finally {
        discardLock.current = false;
      }
    }
    setEditing(null);
    setEditLabelIndex(null);
  };

  return (
    <div className="wb-page rs-page">
      <WorkspaceHeader
        icon={Brain}
        title="复习"
        actions={
          <>
            <button
              type="button"
              className="ui-button-ghost"
              onClick={() => {
                writeSessionStorage("daily-summary-settings-tab", "review");
                onNavigate("settings");
              }}
            >
              <CalendarClock size={15} />
              复习计划
            </button>
            <button
              type="button"
              className="ui-button-secondary"
              onClick={() => void load()}
              disabled={grading || loading}
            >
              <RotateCcw size={15} />
              刷新队列
            </button>
          </>
        }
      />
      {error && (
        <div className="rs-error">
          <InlineError message={error} onRetry={load} />
        </div>
      )}
      <div className="rs-layout" data-studying={sessionStarted && !!current}>
        <section className="rs-main">
          {loading ? (
            <LoadingState label="读取今日复习队列…" rows={3} />
          ) : batchComplete ? (
            <ReviewBatchComplete
              remaining={batchRemaining}
              onContinue={() => {
                setSessionStarted(true);
                void load();
              }}
              onNavigate={onNavigate}
            />
          ) : finished ? (
            <ReviewEmptyState
              stats={stats}
              reviewStats={reviewStats}
              onNavigate={onNavigate}
            />
          ) : current && !sessionStarted ? (
            <div className="wb-panel rs-ready">
              <div className="wb-eyebrow">今日复习</div>
              <h2>给记忆一次主动回想。</h2>
              <p className="rs-ready-copy">
                一次只专注一道题。先尝试回忆，再打开答案，按真实记忆程度评分。
              </p>
              <div className="rs-due-count">
                <strong>{stats?.due ?? cards.length}</strong>
                <span>道题可以开始</span>
              </div>
              <div className="rs-queue-details">
                {typeof stats?.due_reviews === "number" && (
                  <span>
                    到期复习 <b>{stats.due_reviews}</b>
                  </span>
                )}
                {typeof stats?.new_cards === "number" && (
                  <span>
                    可加入新题 <b>{stats.new_cards}</b>
                  </span>
                )}
                <span>
                  本批 <b>{cards.length}</b> 道
                </span>
              </div>
              <button
                type="button"
                className="ui-button-primary rs-start"
                onClick={() => setSessionStarted(true)}
              >
                {sessionRatings ? "继续复习" : "开始复习"}
                <ArrowRight size={17} />
              </button>
              <div className="rs-method">
                <span>
                  <b>01</b>回想问题
                </span>
                <span>
                  <b>02</b>核对答案
                </span>
                <span>
                  <b>03</b>记录记忆程度
                </span>
              </div>
            </div>
          ) : current ? (
            <div className="wb-panel rs-session">
              <div className="rs-session-bar">
                <button
                  type="button"
                  className="ui-button-ghost"
                  disabled={grading}
                  onClick={() => {
                    setSessionStarted(false);
                    setRevealed(false);
                  }}
                >
                  <ArrowLeft size={15} />
                  暂停本轮
                </button>
                <span role="status">
                  本轮评分 {sessionRatings} 次 · 剩余 {cards.length} 题
                </span>
              </div>
              <div className="rs-study-content">
                <div className="rs-question" ref={questionRef} tabIndex={-1}>
                  <div className="rs-question-meta">
                    <span>
                      {reviewItemTypeLabels[current.item_type] ||
                        current.item_type}
                    </span>
                    <span>{cardTypeLabels[current.card_type]}</span>
                    {current.review_count ? (
                      <span>已复习 {current.review_count} 次</span>
                    ) : (
                      <span>首次回忆</span>
                    )}
                  </div>
                  <p className="rs-context-title">{current.title}</p>
                  <div className="wb-eyebrow">尝试回答</div>
                  <div className="rs-prompt">
                    <MarkdownContent content={current.prompt} />
                  </div>
                  {current.hint && !revealed && (
                    <div className="rs-hint">
                      <button
                        type="button"
                        className="ui-button-ghost"
                        aria-expanded={showHint}
                        onClick={() => setShowHint((value) => !value)}
                      >
                        <HelpCircle size={15} />
                        {showHint ? "收起提示" : "给我一点提示"}
                      </button>
                      {showHint && <p>{current.hint}</p>}
                    </div>
                  )}
                </div>
                {revealed && (
                  <section className="rs-answer" aria-label="参考答案">
                    <div className="rs-answer-label">
                      <CheckCircle2 size={15} />
                      参考答案
                    </div>
                    <MarkdownContent content={current.answer} />
                    <details className="rs-evidence">
                      <summary>
                        <Link2 size={14} />
                        来源与关联知识
                      </summary>
                      {current.source_excerpt && (
                        <blockquote>{current.source_excerpt}</blockquote>
                      )}
                      <div className="wb-inline-actions">
                        {(current.source_date || current.source_review_id) && (
                          <button
                            type="button"
                            className="ui-button-ghost"
                            onClick={openSource}
                          >
                            <ExternalLink size={14} />
                            查看来源
                          </button>
                        )}
                        <button
                          type="button"
                          className="ui-button-ghost"
                          onClick={openEdit}
                          disabled={editorLoading}
                        >
                          <PencilLine size={14} />
                          {editorLoading ? "读取中…" : "编辑知识条目"}
                        </button>
                        {relatedLabelsQuery.isError && (
                          <InlineError
                            message={`关联知识暂时无法加载：${api.getErrorMessage(relatedLabelsQuery.error)}`}
                            onRetry={() => void relatedLabelsQuery.refetch()}
                          />
                        )}
                        {relatedCards.map((related) => (
                          <button
                            key={related.id}
                            type="button"
                            className="ui-button-ghost"
                            onClick={() => onOpenKnowledgeCard(related.id)}
                          >
                            {related.title}
                          </button>
                        ))}
                      </div>
                    </details>
                  </section>
                )}
              </div>
              <footer className="rs-answer-actions">
                {!revealed ? (
                  <>
                    <p>先在心中回答，再查看答案。</p>
                    <button
                      type="button"
                      className="ui-button-primary"
                      onClick={() => setRevealed(true)}
                    >
                      <Eye size={16} />
                      显示答案<kbd aria-hidden="true">Space</kbd>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="rs-grade-heading">
                      <span>这次记得怎么样？</span>
                      <span>
                        {grading
                          ? "正在记录…"
                          : gradePreviewQuery.isFetching
                            ? "正在读取下次复习安排…"
                            : gradePreviewQuery.isError
                              ? "暂时无法预览间隔，仍可评分"
                              : "下次复习时间由服务端计算"}
                      </span>
                    </div>
                    <div className="rs-grade-grid">
                      {gradeOptions.map((option, i) => (
                        <button
                          type="button"
                          key={option.grade}
                          data-grade={option.grade}
                          disabled={grading}
                          onClick={() => void grade(option.grade)}
                        >
                          <span>
                            <kbd>{i + 1}</kbd>
                            {option.label}
                          </span>
                          <small>
                            {formatReviewPreview(
                              gradePreviews.get(option.grade),
                            ) || "间隔待返回"}
                          </small>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </footer>
            </div>
          ) : !error ? (
            <div className="wb-panel wb-empty">
              <Brain size={30} />
              <h2>暂时没有可用的复习题</h2>
              <button
                type="button"
                className="ui-button-secondary"
                onClick={() => void load()}
              >
                重新读取队列
              </button>
            </div>
          ) : null}
        </section>
        <aside className="rs-sidebar">
          <section className="wb-panel rs-today">
            <h3>今天的积累</h3>
            <div>
              <strong>{stats?.reviewed_today ?? "—"}</strong>
              <span>次复习已记录</span>
            </div>
            <p>知识条目 {stats?.total_confirmed ?? "—"} 个已沉淀</p>
          </section>
          <section className="wb-panel rs-schedule">
            <div className="rs-aside-title">
              <h3>接下来 7 天</h3>
              <CalendarClock size={15} />
            </div>
            {reviewStats?.upcoming.length ? (
              <>
                <div className="rs-days">
                  {reviewStats.upcoming.slice(0, 7).map((day) => (
                    <div
                      key={day.date}
                      title={`${day.date} · ${day.count} 道题`}
                    >
                      <span>{day.count}</span>
                      <i
                        style={{
                          height: `${Math.max(3, (day.count / Math.max(1, ...reviewStats.upcoming.map((item) => item.count))) * 60)}px`,
                        }}
                      />
                      <time dateTime={day.date}>
                        {day.date.slice(5).replace("-", "/")}
                      </time>
                    </div>
                  ))}
                </div>
                <p className="wb-muted">
                  按当前服务端安排展示，评分后可能变化。
                </p>
              </>
            ) : (
              <p className="wb-muted">暂无未来复习安排。</p>
            )}
          </section>
          <section className="rs-guide">
            <h3>复习题不等于知识正文</h3>
            <p>
              知识条目用来查阅和维护，复习题用来主动回忆。新知识需要创建复习题后才会进入队列。
            </p>
            <button
              type="button"
              className="ui-button-ghost"
              onClick={() => onNavigate("knowledge")}
            >
              管理知识与复习题
              <ArrowRight size={14} />
            </button>
          </section>
        </aside>
      </div>
      <Dialog.Root
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) void closeEditor();
        }}
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
                className="wb-modal rs-edit-dialog ui-modal-surface fixed inset-x-3 bottom-3 z-50 max-w-md p-4 outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-5"
              >
                <div className="mb-3 flex items-center justify-between">
                  <Dialog.Title className="text-sm font-bold text-[var(--ui-text)]">
                    编辑知识条目
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="ui-icon-button h-8 w-8"
                      title="关闭"
                      aria-label="关闭编辑知识条目"
                    >
                      <X size={15} />
                    </button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  编辑知识条目的标题、正文、标签和关联知识条目。
                </Dialog.Description>
                {error && (
                  <div className="ui-alert-bad mb-3" role="alert">
                    {error}
                  </div>
                )}
                <div className="grid gap-3">
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="知识标题"
                    aria-label="知识标题"
                    className="ui-field h-10"
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    placeholder="知识正文"
                    aria-label="知识正文"
                    className="ui-textarea min-h-[140px] text-sm leading-6"
                  />
                  <input
                    value={editTagsText}
                    onChange={(e) => setEditTagsText(e.target.value)}
                    placeholder="标签，用逗号分隔"
                    aria-label="标签"
                    className="ui-field h-10"
                  />
                  <input
                    value={editRelatedText}
                    onChange={(e) => setEditRelatedText(e.target.value)}
                    placeholder="关联知识条目（逗号分隔的标题）"
                    aria-label="关联知识条目"
                    className="ui-field h-10"
                  />
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={savingEdit}
                    onClick={() => void closeEditor()}
                    className="ui-button-secondary"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEdit()}
                    disabled={
                      savingEdit || !editLabelIndex || !editTitle.trim() || !editContent.trim()
                    }
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
      {dialog}
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
    ? "从第一道复习题开始"
    : reviewedToday > 0
      ? "当前队列已完成"
      : "今天没有可复习内容";
  const description = hasNoConfirmedCards
    ? "先确认知识条目，再为它创建复习题；知识正文与复习题分别维护。"
    : reviewedToday > 0
      ? "当前队列已经清空，可按自己的节奏稍后继续。"
      : "没有需要立即处理的复习题，可以继续整理知识或查看学习节奏。";

  return (
    <section className="ui-panel overflow-hidden">
      <div className="ui-soft-divider border-b px-5 py-7 text-center sm:px-8 sm:py-9">
        <span className="ui-status-accent mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl ring-1 ring-[var(--ui-selected-border)]">
          {hasNoConfirmedCards ? (
            <Brain size={23} strokeWidth={2} />
          ) : (
            <CheckCircle2 size={23} strokeWidth={2} />
          )}
        </span>
        <p className="ui-section-kicker">今日复习</p>
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-[var(--ui-text)]">
          {title}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ui-text-muted)]">
          {description}
        </p>
        <p className="mt-4 text-3xl font-semibold tracking-tight text-[var(--ui-text)]">
          {hasNoConfirmedCards ? "—" : "0"}
          <span className="ml-1 text-sm font-medium text-[var(--ui-text-subtle)]">
            道待复习题
          </span>
        </p>
      </div>

      <div className="ui-metric-grid grid grid-cols-3">
        <ReviewMetric
          icon={CheckCircle2}
          label="今日已复习"
          value={reviewedToday}
          suffix="次"
        />
        <ReviewMetric
          icon={BookMarked}
          label="已沉淀条目"
          value={stats?.total_confirmed ?? 0}
          suffix="个"
        />
        <ReviewMetric
          icon={CalendarClock}
          label="下一批复习"
          value={nextScheduled ? nextScheduled.date.slice(5) : "—"}
          suffix={nextScheduled ? `${nextScheduled.count} 道` : ""}
        />
      </div>

      <div className="ui-soft-divider flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => onNavigate("knowledge")}
          className="ui-button-primary w-full sm:w-auto"
        >
          <BookMarked size={14} />{" "}
          {hasNoConfirmedCards ? "去知识页创建复习题" : "查看知识库"}
        </button>
        <button
          type="button"
          onClick={() => onNavigate("stats")}
          className="ui-button-secondary w-full sm:w-auto"
        >
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
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-[var(--ui-text)]">
          这一批完成了
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ui-text-muted)]">
          还有待复习题，可以按自己的节奏继续下一批。
        </p>
        <p className="mt-4 text-3xl font-semibold tracking-tight text-[var(--ui-text)]">
          {remaining}
          <span className="ml-1 text-sm font-medium text-[var(--ui-text-subtle)]">
            道待复习题
          </span>
        </p>
      </div>
      <div className="ui-soft-divider flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={onContinue}
          className="ui-button-primary w-full sm:w-auto"
        >
          <ArrowRight size={14} /> 继续下一批
        </button>
        <button
          type="button"
          onClick={() => onNavigate("stats")}
          className="ui-button-secondary w-full sm:w-auto"
        >
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
      <span className="truncate text-[11px] text-[var(--ui-text-subtle)]">
        {label}
      </span>
      <span className="text-sm font-semibold text-[var(--ui-text)]">
        {value}
        {suffix && (
          <span className="ml-1 text-[11px] font-normal text-[var(--ui-text-subtle)]">
            {suffix}
          </span>
        )}
      </span>
    </div>
  );
}
