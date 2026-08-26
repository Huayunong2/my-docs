import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  BookMarked,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Eye,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MoreVertical,
  PenLine,
  Save,
  Share2,
  Smile,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import type { Article } from "../lib/api";
import { normalizeTag } from "../lib/tags";
import { DailyRecordSession } from "../lib/dailyRecordSession";
import MarkdownContent from "./MarkdownContent";
import { useConfirmDialog } from "./ui/Feedback";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

const moods = [
  { emoji: "😊", label: "开心" },
  { emoji: "😐", label: "平静" },
  { emoji: "😢", label: "难过" },
  { emoji: "😤", label: "生气" },
  { emoji: "🤩", label: "兴奋" },
  { emoji: "😴", label: "疲惫" },
  { emoji: "😌", label: "放松" },
  { emoji: "🤔", label: "思考" },
  { emoji: "😰", label: "焦虑" },
  { emoji: "🔥", label: "高效" },
  { emoji: "🌱", label: "成长" },
  { emoji: "💡", label: "顿悟" },
];

const DAILY_TEMPLATE = `## {date}

### 1. 今天最重要的一个点


---

### 2. 我实际做了什么

- 
- 
- 

---

### 3. 为什么会这样



---

### 4. 我学到的通用规律



---

### 5. 下次先查哪里
`;

const TEMPLATES = [
  { name: "日总结（5问）", description: "适合严肃复盘，保留原因、规律和下次动作", template: DAILY_TEMPLATE, autoTitle: "{date} 总结" },
  { name: "空白", description: "直接从空白页开始写", template: "", autoTitle: "" },
  { name: "简洁日记", description: "轻量记录当天状态和收获", template: "## {date}\n\n今天...\n\n### 收获\n\n- \n\n### 反思\n\n- ", autoTitle: "{date} 日记" },
  { name: "问题复盘", description: "用于拆解问题、根因和预防动作", template: "## {date} 问题复盘\n\n### 问题是什么\n\n\n### 影响范围\n\n\n### 直接原因\n\n\n### 根因判断\n\n\n### 下次预防动作\n\n- ", autoTitle: "{date} 问题复盘" },
  { name: "学习记录", description: "记录概念、例子和仍未弄懂的问题", template: "## {date} 学习记录\n\n### 学了什么\n\n\n### 关键概念\n\n- \n\n### 例子或应用\n\n\n### 还没弄懂\n\n- ", autoTitle: "{date} 学习记录" },
  { name: "工作日志", description: "适合整理完成事项、问题和明日计划", template: "## {date}\n\n### 今日完成\n- \n- \n\n### 遇到的问题\n- \n\n### 明日计划\n- \n- ", autoTitle: "{date} 工作日志" },
];

const DEFAULT_TAG_SUGGESTIONS = ["工作", "学习", "复盘", "项目", "问题", "设计", "阅读", "健康", "沟通", "计划"];

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function relativeDateLabel(date: string): string {
  const today = todayDate();
  if (date === today) return "今天";
  if (date === shiftDate(today, -1)) return "昨天";
  if (date === shiftDate(today, 1)) return "明天";
  return date;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type MobilePane = "edit" | "preview";

export default function TodayPage({
  targetDate,
  targetNonce,
  onNavigate,
  zen,
  onToggleZen,
  dark,
  onWikiLink,
}: {
  targetDate?: string;
  targetNonce?: number;
  onNavigate?: (page: "knowledge") => void;
  zen?: boolean;
  onToggleZen?: () => void;
  dark?: boolean;
  onWikiLink?: (title: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState(() => targetDate || todayDate());
  const [article, setArticle] = useState<Article | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mood, setMood] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("edit");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>(DEFAULT_TAG_SUGGESTIONS);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiError, setAiError] = useState("");
  const [extractingCards, setExtractingCards] = useState(false);
  const [cardExtractNotice, setCardExtractNotice] = useState("");
  const [cardExtractCount, setCardExtractCount] = useState(0);
  const [knowledgePrompt, setKnowledgePrompt] = useState(false);
  const knowledgePromptDate = useRef("");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const articleRef = useRef<Article | null>(null);
  const recordSession = useRef(new DailyRecordSession({
    create: api.createArticle,
    update: api.updateArticle,
  }));
  const externalNonceRef = useRef(targetNonce);
  const { confirm, dialog } = useConfirmDialog();
  const date = selectedDate;
  const quickTags = useMemo(
    () => tagSuggestions.filter((tag) => !tags.includes(tag)).slice(0, 10),
    [tagSuggestions, tags]
  );

  // Load article for selected date
  useEffect(() => {
    let cancelled = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setArticle(null);
    setTitle("");
    setContent("");
    setMood("");
    setTags([]);
    setTagInput("");
    setDirty(false);
    setSaveStatus("idle");
    setSaveError("");
    setKnowledgePrompt(false);

    const generation = recordSession.current.begin(date, null);
    articleRef.current = null;
    api.getTodayArticle(date)
      .then((a) => {
        if (cancelled || !recordSession.current.acceptLoaded(generation, a)) return;
        if (a) {
          setArticle(a);
          articleRef.current = a;
          setTitle(a.title);
          setContent(a.content);
          setMood(a.mood);
          setTags(a.tags);
          setDirty(false);
        }
        // 消费 Web Share Target 分享进来的内容（追加到当前记录）
        const rawShare = localStorage.getItem("pendingShare");
        if (rawShare) {
          localStorage.removeItem("pendingShare");
          try {
            const shared = JSON.parse(rawShare) as { text?: string; title?: string };
            if (shared.text) {
              setContent((prev) => (prev ? `${prev}\n\n${shared.text}` : shared.text || ""));
              if (shared.title && !a?.title) setTitle(shared.title);
              setDirty(true);
            }
          } catch {
            /* 忽略损坏的分享数据 */
          }
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setSaveError("连接服务器失败: " + api.getErrorMessage(e));
        setSaveStatus("error");
      });

    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [date]);

  // Keep ref in sync
  useEffect(() => { articleRef.current = article; }, [article]);

  useEffect(() => {
    let cancelled = false;
    api.listArticles(1, 60)
      .then((items) => {
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const item of items) {
          for (const tag of item.tags) {
            counts.set(tag, (counts.get(tag) || 0) + 1);
          }
        }
        const frequent = [...counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([tag]) => tag);
        setTagSuggestions([...new Set([...frequent, ...DEFAULT_TAG_SUGGESTIONS])].slice(0, 16));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // Persist save — uses ref to avoid stale closure
  const doSave = useCallback(
    async (newTitle: string, newContent: string, newMood: string, newTags = tags) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
      }
      setSaveStatus("saving");
      setSaveError("");
      try {
        const result = await recordSession.current.save({
          date,
          title: newTitle || "(无标题)",
          content: newContent,
          mood: newMood,
          tags: newTags,
        });
        if (!result.applied) return false;
        setArticle(result.article);
        articleRef.current = result.article;
        setDirty(false);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2000);
        // 沉淀提示（非侵入、当天一次）：内容超过阈值且当天尚未提示过
        const plainLength = newContent.trim().replace(/\s+/g, "").length;
        if (plainLength >= 500
          && knowledgePromptDate.current !== date
          && !localStorage.getItem(`knowledge-prompt:${date}`)) {
          knowledgePromptDate.current = date;
          setKnowledgePrompt(true);
        }
        return true;
      } catch (e: any) {
        setSaveStatus("error");
        setSaveError(api.getErrorMessage(e));
        return false;
      }
    },
    [date, tags]
  );

  // Auto-save with debounce
  const autoSave = useCallback(
    (newTitle: string, newContent: string, newMood: string, newTags = tags) => {
      recordSession.current.markEdited();
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = undefined;
        doSave(newTitle, newContent, newMood, newTags);
      }, 1200);
    },
    [doSave, tags]
  );

  // Manual save
  const handleManualSave = () => {
    doSave(title, content, mood, tags);
  };

  const handleShare = async () => {
    const text = `${title || date}${content ? `\n\n${content}` : ""}`.trim();
    try {
      if (navigator.share) {
        await navigator.share({ title: title || date, text });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        toast.success("已复制到剪贴板");
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        toast.error("分享失败");
      }
    }
  };

  const requestDateChange = useCallback(async (nextDate: string) => {
    if (!nextDate || nextDate === date) return;
    if (dirty || saveTimer.current) {
      const shouldSave = await confirm({
        title: "切换日期",
        message: "当前记录有未保存内容。切换日期前先保存吗？",
        confirmText: "先保存",
      });
      if (shouldSave) {
        const saved = await doSave(title, content, mood, tags);
        if (!saved) return;
      } else if (!(await confirm({
        title: "放弃未保存内容",
        message: "确定放弃未保存内容并切换日期？",
        confirmText: "放弃并切换",
        danger: true,
      }))) {
        return;
      }
    }
    setSelectedDate(nextDate);
  }, [confirm, content, date, dirty, doSave, mood, tags, title]);

  useEffect(() => {
    if (targetDate && targetNonce !== externalNonceRef.current) {
      externalNonceRef.current = targetNonce;
      void requestDateChange(targetDate);
    }
  }, [requestDateChange, targetDate, targetNonce]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    autoSave(e.target.value, content, mood);
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    autoSave(title, value, mood);
  };

  const handleMoodChange = (m: string) => {
    // Click selected mood again to clear
    const newMood = mood === m ? "" : m;
    setMood(newMood);
    autoSave(title, content, newMood);
  };

  const addTag = () => {
    const tag = normalizeTag(tagInput);
    if (!tag || tags.includes(tag)) {
      setTagInput("");
      return;
    }
    const next = [...tags, tag].slice(0, 12);
    setTags(next);
    setTagInput("");
    autoSave(title, content, mood, next);
  };

  const addQuickTag = (tag: string) => {
    const normalized = normalizeTag(tag);
    if (!normalized || tags.includes(normalized)) return;
    const next = [...tags, normalized].slice(0, 12);
    setTags(next);
    autoSave(title, content, mood, next);
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((item) => item !== tag);
    setTags(next);
    autoSave(title, content, mood, next);
  };

  const handleDelete = async () => {
    const current = articleRef.current;
    if (!current) return;
    const ok = await confirm({
      title: "删除记录",
      message: `确定要删除 ${date} 的记录吗？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
    }
    try {
      await recordSession.current.whenIdle();
      await api.deleteArticle(current.id);
      recordSession.current.clear();
      articleRef.current = null;
      setArticle(null);
      setTitle("");
      setContent("");
      setMood("");
      setTags([]);
      setDirty(false);
      setSaveStatus("idle");
      setSaveError("");
    } catch (e: any) {
      setSaveError("删除失败: " + api.getErrorMessage(e));
    }
  };

  const applyTemplate = async (tmpl: typeof TEMPLATES[number]) => {
    // Warn if overwriting existing content
    if (content.trim() && !(await confirm({
      title: "套用模板",
      message: "当前内容将被模板替换，确定继续？",
      confirmText: "替换",
      danger: true,
    }))) return;
    const filled = tmpl.template.replace(/\{date\}/g, date);
    setContent(filled);
    setMobilePane("edit");
    toast.success(`已套用「${tmpl.name}」`);
    if (tmpl.autoTitle) {
      const t = tmpl.autoTitle.replace(/\{date\}/g, date);
      setTitle(t);
      autoSave(t, filled, mood, tags);
    } else {
      autoSave(title, filled, mood, tags);
    }
  };

  const handleAISummary = async () => {
    if (!content.trim()) { setAiError("先写点内容再总结"); return; }
    setAiLoading(true);
    setAiError("");
    setAiResult("");
    setCardExtractNotice("");
    setCardExtractCount(0);
    try {
      const data = await api.summarizeWithAI({ content });
      setAiResult(data.summary || "无返回内容");
    } catch (e: any) {
      setAiError(api.getErrorMessage(e));
    }
    setAiLoading(false);
  };

  const handleExtractKnowledgeCards = async () => {
    if (!content.trim()) {
      setCardExtractNotice("先写点内容再提取知识卡片");
      return;
    }
    setExtractingCards(true);
    setCardExtractNotice("");
    setCardExtractCount(0);
    try {
      const { cards, skipped } = await api.extractKnowledgeCards({
        content,
        source_article_id: article?.id,
        source_date: date,
        max_cards: 6,
      });
      setCardExtractNotice(
        cards.length
          ? skipped > 0
            ? `已生成 ${cards.length} 张新草稿，跳过 ${skipped} 张与已有卡片重复，可到知识库确认。`
            : `已生成 ${cards.length} 张知识卡片草稿，可到知识库确认。`
          : skipped > 0
            ? `没有新的知识点（${skipped} 张与已有卡片重复），可到知识库查看已有卡片。`
            : "这篇内容里没有足够稳定的知识卡片。"
      );
      setCardExtractCount(cards.length);
    } catch (e: any) {
      setCardExtractNotice(api.getErrorMessage(e));
    } finally {
      setExtractingCards(false);
    }
  };

  // Ctrl+S keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Guard against mobile tab switches or accidental browser close while edits are pending.
  useEffect(() => {
    const flushPendingSave = () => {
      if (dirty || saveTimer.current) {
        doSave(title, content, mood, tags);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingSave();
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty && !saveTimer.current) return;
      e.preventDefault();
      e.returnValue = "";
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [content, dirty, doSave, mood, tags, title]);

  // Close mobile more menu on outside click
  useEffect(() => {
    if (!showMobileMore) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-mobile-more]")) {
        setShowMobileMore(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMobileMore]);

  // 专注模式下按 Esc 退出
  useEffect(() => {
    if (!zen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleZen?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [zen, onToggleZen]);

  // Word & char count
  const charCount = content.length;
  const wordCount = content ? content.replace(/\s/g, "").length : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full flex flex-col relative"
    >
      {zen && (
        <div className="flex items-center justify-between px-3 py-2 md:px-8 md:py-3">
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">专注模式 · 按 Esc 退出</span>
          <button onClick={onToggleZen} className="ui-button-secondary h-8">
            <Minimize2 size={14} /> 退出
          </button>
        </div>
      )}
      {/* Header */}
      <div className="px-3 pb-2 pt-3 md:px-8 md:pt-4" style={zen ? { display: "none" } : undefined}>
        <div className="glass-card rounded-xl px-2 py-2 sm:px-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
              <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-light text-accent dark:bg-accent-light/20 sm:flex">
                <Calendar size={16} strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <h2 className="bg-gradient-to-r from-accent to-accent-hover bg-clip-text text-base font-bold leading-tight text-transparent">
                  每日记录
                </h2>
                <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-400">
                  {relativeDateLabel(date)} · {date}
                </p>
              </div>
              </div>

              <div className="flex items-center gap-1.5 md:hidden">
                <span className="text-[11px] text-gray-400 dark:text-gray-500">{wordCount} 字</span>
                <span
                  className={[
                    "text-[11px] font-medium",
                    saveStatus === "error"
                      ? "text-red-500"
                      : saveStatus === "saving"
                        ? "text-accent"
                        : dirty
                          ? "text-amber-500"
                          : "text-emerald-500",
                  ].join(" ")}
                >
                  {saveStatus === "error" ? "保存失败" : saveStatus === "saving" ? "保存中" : dirty ? "未保存" : "已同步"}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
              <div className="relative flex w-full items-center gap-1 rounded-xl border border-gray-200/70 bg-gray-50 p-1 dark:border-white/10 dark:bg-white/[0.04] sm:w-auto">
              <button
                type="button"
                onClick={() => requestDateChange(shiftDate(date, -1))}
                className="ui-icon-button h-8 w-8"
                title="前一天"
              >
                <ChevronLeft size={16} />
              </button>
              <DatePickerPopover selectedDate={date} onSelect={requestDateChange} />
              <button
                type="button"
                onClick={() => requestDateChange(shiftDate(date, 1))}
                className="ui-icon-button h-8 w-8"
                title="后一天"
              >
                <ChevronRight size={16} />
              </button>
              {date !== todayDate() && (
                <button
                  type="button"
                  onClick={() => requestDateChange(todayDate())}
                  className="gradient-border h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold text-accent transition-transform hover:scale-[1.04]"
                >
                  今天
                </button>
              )}
            </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="ui-chip hidden h-8 sm:inline-flex">
                  {wordCount} 字 · {charCount} 字符
                </span>

                {saveStatus === "saving" && (
                  <span className="ui-chip h-8 text-accent">
                    <LoaderCircle size={13} className="animate-spin" /> 保存中
                  </span>
                )}
                {saveStatus === "saved" && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="ui-chip h-8 text-emerald-600 dark:text-emerald-300"
                  >
                    <CheckCircle2 size={13} /> 已保存
                  </motion.span>
                )}
                {dirty && saveStatus !== "saving" && saveStatus !== "error" && (
                  <span className="ui-chip h-8 text-amber-600 dark:text-amber-300">
                    <AlertTriangle size={13} /> 未保存
                  </span>
                )}
                {saveStatus === "error" && (
                  <span className="ui-chip h-8 text-red-600 dark:text-red-300">
                    <AlertTriangle size={13} /> 保存失败
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-gray-100 pt-2 dark:border-white/10 md:flex md:flex-wrap md:items-center xl:border-t-0 xl:pt-0">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleManualSave}
              disabled={saveStatus === "saving"}
              className="ui-button-primary w-full md:w-auto"
              title="手动保存"
            >
              <Save size={14} /> 保存
            </motion.button>

            {/* Template picker */}
            <DropdownMenu>
              <DropdownMenuTrigger className="ui-button-secondary w-full md:w-auto">
                <ClipboardList size={14} /> 模板
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[360px] p-2">
                {TEMPLATES.map((t) => (
                  <DropdownMenuItem
                    key={t.name}
                    onSelect={() => applyTemplate(t)}
                    className="flex-col items-start gap-1 px-3 py-2.5"
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t.name}</span>
                      {t.autoTitle && (
                        <span className="rounded-full bg-accent-light px-2 py-0.5 text-[10px] font-medium text-accent dark:bg-accent-light/20">自动标题</span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-xs leading-5 text-gray-400 dark:text-gray-500">{t.description}</p>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* AI 总结 + 提取卡片（移动端占满一行，桌面端并排） */}
            <div className="col-span-2 flex w-full gap-2 md:col-span-1 md:w-auto">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleAISummary}
                disabled={aiLoading}
                className="ui-button-secondary flex-1 text-accent dark:text-accent md:flex-none md:w-auto"
                title="AI 总结当前内容"
              >
                {aiLoading ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {aiLoading ? "总结中" : "AI 总结"}
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleExtractKnowledgeCards}
                disabled={extractingCards}
                className="ui-button-secondary flex-1 text-emerald-600 dark:text-emerald-300 md:flex-none md:w-auto"
                title="从当前正文抽取知识卡片草稿"
              >
                {extractingCards ? <LoaderCircle size={14} className="animate-spin" /> : <BookMarked size={14} />}
                {extractingCards ? "提取中" : "提取卡片"}
              </motion.button>
            </div>

            <button
              onClick={handleShare}
              className="ui-button-ghost hidden md:inline-flex"
              title="分享当前记录"
            >
              <Share2 size={14} /> 分享
            </button>

            <button
              onClick={onToggleZen}
              className="ui-button-ghost hidden md:inline-flex"
              title="专注模式（隐藏侧栏与干扰）"
            >
              <Maximize2 size={14} /> 专注
            </button>

            <button
              type="button"
              onClick={() => setMetaExpanded((value) => !value)}
              className="ui-button-secondary col-span-2 w-full md:hidden"
            >
              <Smile size={14} />
              心情/标签
              {metaExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {article && (
            <div className="relative md:hidden" data-mobile-more>
              <button
                type="button"
                onClick={() => setShowMobileMore((value) => !value)}
                className="ui-icon-button"
                title="更多操作"
              >
                <MoreVertical size={16} />
              </button>
              <AnimatePresence>
                {showMobileMore && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full z-30 mt-2 w-36 rounded-xl border border-gray-100 bg-white p-1.5 shadow-modal dark:border-white/10 dark:bg-gray-900"
                  >
                      <button
                        type="button"
                        onClick={() => {
                          setShowMobileMore(false);
                          handleShare();
                        }}
                        className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
                      >
                        <Share2 size={14} /> 分享记录
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMobileMore(false);
                          handleDelete();
                        }}
                        className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
                      >
                        <Trash2 size={14} /> 删除记录
                      </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            )}

            {article && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleDelete}
                className="ui-button-danger hidden md:ml-auto md:inline-flex"
                title="删除"
              >
                <Trash2 size={14} /> 删除
              </motion.button>
            )}
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500 md:hidden">
          <span>{wordCount} 字</span>
          <span>·</span>
          <span>{tags.length ? `${tags.length} 标签` : "无标签"}</span>
        </div>

        <AnimatePresence>
          {knowledgePrompt && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/20 bg-accent-light/40 px-4 py-2.5 text-xs dark:bg-accent-light/10"
            >
              <span className="text-gray-600 dark:text-gray-300">今天的记录比较长，想把其中的规律沉淀成知识卡片？</span>
              <span className="flex items-center gap-2">
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.setItem(`knowledge-prompt:${date}`, "1");
                      setKnowledgePrompt(false);
                      onNavigate("knowledge");
                    }}
                    className="inline-flex h-7 items-center gap-1 rounded-lg bg-accent px-2.5 text-xs font-semibold text-white hover:bg-accent/90"
                  >
                    <BookMarked size={12} /> 去沉淀
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem(`knowledge-prompt:${date}`, "1");
                    setKnowledgePrompt(false);
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:text-gray-300"
                >
                  稍后
                </button>
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* AI result panel */}
        <AnimatePresence>
          {(aiResult || aiError || cardExtractNotice) && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/20 z-30 md:hidden" onClick={() => { setAiResult(""); setAiError(""); setCardExtractNotice(""); setCardExtractCount(0); }} />
              <motion.div
                initial={{ x: "100%", opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="fixed bottom-0 right-0 top-auto z-40 flex h-[82dvh] w-full max-w-[100vw] flex-col overflow-hidden rounded-t-2xl border border-gray-200/60 bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900 md:bottom-auto md:top-[10dvh] md:h-[82dvh] md:w-[480px] md:max-w-[42vw] md:rounded-l-2xl md:rounded-tr-none md:border-r-0"
              >
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5 dark:border-white/5">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-100">
                    {aiResult || aiError ? <Bot size={16} /> : <BookMarked size={16} />}
                    {aiResult || aiError ? "AI 总结" : "提取知识卡片"}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExtractKnowledgeCards}
                      disabled={extractingCards}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-600 transition-colors hover:border-accent/30 hover:text-accent disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300"
                      title="从当前真实正文抽取知识卡片草稿"
                    >
                      {extractingCards ? <LoaderCircle size={13} className="animate-spin" /> : <BookMarked size={13} />}
                      提取卡片
                    </button>
                    <button onClick={() => { setAiResult(""); setAiError(""); setCardExtractNotice(""); setCardExtractCount(0); }}
                      className="ui-icon-button"><X size={15} /></button>
                  </div>
                </div>
                <div className={`flex-1 overflow-y-auto p-5 ${aiError ? "text-red-500" : ""}`}>
                  {cardExtractNotice && (
                    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300 sm:flex-row sm:items-center sm:justify-between">
                      <span>{cardExtractNotice}</span>
                      {cardExtractCount > 0 && onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate("knowledge")}
                          className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-accent/20 bg-accent-light px-2 text-xs font-semibold text-accent dark:bg-accent-light/20"
                        >
                          查看待确认
                        </button>
                      )}
                    </div>
                  )}
                  {aiError ? aiError : (
                    <div className="mx-auto max-w-[760px]">
                      <MarkdownPreview content={aiResult} onWikiLink={onWikiLink} />
                    </div>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Save error banner */}
        <AnimatePresence>
          {saveError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="ui-alert-bad mt-2 text-xs"
            >
              {saveError}
              <button onClick={handleManualSave} className="ml-2 underline">重试保存</button>
              <button onClick={() => setSaveError("")} className="ml-2 underline">关闭</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={`${metaExpanded ? "block" : "hidden"} px-3 pb-3 md:block md:px-8`} style={zen ? { display: "none" } : undefined}>
        <div className="ui-panel-muted grid gap-3 p-2.5 lg:grid-cols-[minmax(260px,0.9fr)_1.1fr]">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              <Smile size={13} /> 心情
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {moods.map((m) => (
                <motion.button
                  key={m.emoji}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => handleMoodChange(m.emoji)}
                  className={`relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-sm leading-none transition-all duration-200 ${
                    mood === m.emoji
                      ? "border-accent/30 bg-accent-light text-accent shadow-xs dark:bg-accent-light/20"
                      : "border-transparent text-gray-500 hover:bg-white dark:text-gray-400 dark:hover:bg-white/10"
                  }`}
                  title={m.label}
                >
                  <span>{m.emoji}</span>
                  <span className="text-xs font-medium">{m.label}</span>
                </motion.button>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              <span className="inline-flex items-center gap-2"><Tag size={13} /> 标签</span>
              {quickTags.length > 0 && <span className="font-normal normal-case tracking-normal">可快速选择</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="ui-chip border-accent/20 bg-accent-light text-accent hover:bg-accent-light/80 dark:bg-accent-light/20"
                  title="点击移除标签"
                >
                  #{tag} <X size={12} />
                </button>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                  if (e.key === "Backspace" && !tagInput && tags.length) {
                    removeTag(tags[tags.length - 1]);
                  }
                }}
                onBlur={addTag}
                placeholder={tags.length ? "添加标签" : "添加标签"}
                className="ui-field h-8 min-w-[120px] flex-1 rounded-lg px-3 py-0 text-xs"
              />
              {quickTags.slice(0, 6).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addQuickTag(tag)}
                  className="h-7 rounded-full border border-gray-200/70 px-2.5 text-xs text-gray-400 transition-colors hover:border-accent/30 hover:bg-accent-light hover:text-accent dark:border-white/10 dark:hover:bg-accent-light/20"
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Title input */}
      <div className={`px-3 pb-2 md:px-8 ${zen ? "mx-auto w-full max-w-2xl" : ""}`}>
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="标题..."
          className="w-full bg-transparent text-2xl font-semibold text-gray-800 outline-hidden border-none placeholder-gray-300 dark:text-gray-100 dark:placeholder-gray-600 md:text-2xl"
        />
      </div>

      <div className="px-3 pb-2 md:hidden" style={zen ? { display: "none" } : undefined}>
        <Tabs value={mobilePane} onValueChange={(v) => setMobilePane(v as "edit" | "preview")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="edit">
              <PenLine size={14} /> 编辑
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye size={14} /> 预览
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Split editor */}
      <div className={`grid flex-1 grid-cols-1 gap-4 px-3 pb-28 md:px-8 md:pb-6 min-h-0 ${zen ? "" : "md:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]"}`}>
        <div className={`${mobilePane === "edit" ? "flex" : "hidden"} min-w-0 flex-col md:flex`}>
          <div className="mb-2 flex items-center justify-between gap-3 text-2xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            <span>编辑</span>
            <span className="font-mono normal-case tracking-normal">{wordCount} 字</span>
          </div>
          <div className="ui-editor-surface h-[56dvh] min-h-0 w-full overflow-hidden md:h-auto md:flex-1">
            <CodeMirror
              value={content}
              onChange={handleContentChange}
              extensions={[markdown(), EditorView.lineWrapping]}
              placeholder={`开始写 ${date} 的总结...`}
              theme={dark ? "dark" : "light"}
              height="100%"
              style={{ height: "100%" }}
              basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            />
          </div>
          <div className="h-24 md:hidden" />
        </div>

        <div className={`${mobilePane === "preview" ? "flex" : "hidden"} min-w-0 flex-col md:flex`} style={zen ? { display: "none" } : undefined}>
          <div className="mb-2 flex items-center justify-between gap-3 text-2xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            <span>预览</span>
            <span className="font-mono normal-case tracking-normal">{charCount} 字符</span>
          </div>
          <div className="ui-editor-surface h-[56dvh] min-h-0 overflow-y-auto p-4 md:h-auto md:flex-1 md:p-5">
            <div className="mx-auto max-w-[760px]">
              <MarkdownPreview content={content} onWikiLink={onWikiLink} />
            </div>
          </div>
          <div className="h-24 md:hidden" />
        </div>
      </div>
      {dialog}
    </motion.div>
  );
}

function MarkdownPreview({ content, onWikiLink }: { content: string; onWikiLink?: (title: string) => void }) {
  return <MarkdownContent content={content} onWikiLink={onWikiLink} />;
}

function DatePickerPopover({
  selectedDate,
  onSelect,
}: {
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => new Date(`${selectedDate}T12:00:00`), [selectedDate]);
  const format = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 outline-hidden transition-colors hover:border-accent/30 dark:border-white/10 dark:bg-gray-950/30 dark:text-gray-200 sm:flex-none sm:w-[148px]"
          aria-label="选择记录日期"
        >
          <span className="font-mono">{selectedDate.replace(/-/g, "/")}</span>
          <Calendar size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <DayPicker
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (date) {
              onSelect(format(date));
              setOpen(false);
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-white/10">
          <button
            type="button"
            onClick={() => {
              onSelect(todayDate());
              setOpen(false);
            }}
            className="h-8 rounded-lg bg-accent-light px-3 text-xs font-semibold text-accent hover:bg-accent-light/80 dark:bg-accent-light/20"
          >
            回到今天
          </button>
          <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-lg px-3 text-xs text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
            关闭
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
