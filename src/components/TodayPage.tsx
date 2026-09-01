import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
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
import DatePickerPopover from "./ui/date-picker";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
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

type LocalDraft = {
  title: string;
  content: string;
  mood: string;
  tags: string[];
  spaces?: string[];
  savedAt: number;
};

function localDraftKey(date: string) {
  return `daily-summary:draft:${date}`;
}

function readLocalDraft(date: string): LocalDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(localDraftKey(date)) || "null") as Partial<LocalDraft> | null;
    if (!parsed || typeof parsed.savedAt !== "number" || typeof parsed.title !== "string" || typeof parsed.content !== "string" || typeof parsed.mood !== "string" || !Array.isArray(parsed.tags)) {
      return null;
    }
    return {
      title: parsed.title,
      content: parsed.content,
      mood: parsed.mood,
      tags: parsed.tags.filter((tag): tag is string => typeof tag === "string"),
      spaces: Array.isArray(parsed.spaces)
        ? parsed.spaces.filter((space): space is string => typeof space === "string")
        : [],
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function writeLocalDraft(date: string, draft: Omit<LocalDraft, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(localDraftKey(date), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // localStorage 不可用时仍保留服务器自动保存流程。
  }
}

function clearLocalDraft(date: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(localDraftKey(date));
  } catch {
    // 忽略隐私模式或存储配额限制。
  }
}

function hasLocalStorageItem(key: string) {
  if (typeof window === "undefined") return false;
  try {
    return !!localStorage.getItem(key);
  } catch {
    return false;
  }
}

function setLocalStorageFlag(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, "1");
  } catch {
    // 该标记只用于减少提示频次，存储不可用时不影响主流程。
  }
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type MobilePane = "edit" | "preview";

export default function TodayPage({
  targetDate,
  targetNonce,
  onDateChange,
  onNavigate,
  returnTo,
  onReturn,
  zen,
  onToggleZen,
  dark,
  onWikiLink,
}: {
  targetDate?: string;
  targetNonce?: number;
  onDateChange?: (date: string) => void;
  onNavigate?: (page: "knowledge") => void;
  returnTo?: string;
  onReturn?: () => void;
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
  // 空间归属在知识确认阶段维护；这里只静默保留旧记录的关系，避免编辑日报时误清除。
  const [spaces, setSpaces] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("edit");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>(DEFAULT_TAG_SUGGESTIONS);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiSourceContent, setAiSourceContent] = useState("");
  const [aiError, setAiError] = useState("");
  const [extractingCards, setExtractingCards] = useState(false);
  const [cardExtractNotice, setCardExtractNotice] = useState("");
  const [cardExtractCount, setCardExtractCount] = useState(0);
  const [knowledgePrompt, setKnowledgePrompt] = useState(false);
  const knowledgePromptDate = useRef("");
  const aiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const localDraftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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
    if (localDraftTimer.current) clearTimeout(localDraftTimer.current);
    setArticle(null);
    setTitle("");
    setContent("");
    setMood("");
    setTags([]);
    setTagInput("");
    setSpaces([]);
    setDirty(false);
    setSaveStatus("idle");
    setSaveError("");
    setKnowledgePrompt(false);
    setAiLoading(false);
    setAiResult("");
    setAiSourceContent("");
    setAiError("");
    setExtractingCards(false);
    setCardExtractNotice("");
    setCardExtractCount(0);

    const generation = recordSession.current.begin(date, null);
    articleRef.current = null;
    const localDraft = readLocalDraft(date);
    const restoreLocalDraft = (serverArticle: Article | null) => {
      if (!localDraft) return false;
      const serverUpdatedAt = serverArticle ? Date.parse(serverArticle.updated_at) : Number.NaN;
      if (serverArticle && (!Number.isFinite(serverUpdatedAt) || localDraft.savedAt <= serverUpdatedAt)) {
        clearLocalDraft(date);
        return false;
      }
      setTitle(localDraft.title);
      setContent(localDraft.content);
      setMood(localDraft.mood);
      setTags(localDraft.tags);
      setSpaces(localDraft.spaces || []);
      setDirty(true);
      setSaveStatus("idle");
      setSaveError("");
      toast.info("已恢复尚未同步的本地草稿");
      return true;
    };
    api.getTodayArticle(date)
      .then((a) => {
        if (cancelled || !recordSession.current.acceptLoaded(generation, a)) return;
        if (a) {
          setArticle(a);
          articleRef.current = a;
          if (!restoreLocalDraft(a)) {
            setTitle(a.title);
            setContent(a.content);
            setMood(a.mood);
            setTags(a.tags);
            setSpaces(a.spaces || []);
            setDirty(false);
          }
        } else {
          restoreLocalDraft(null);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        const restored = restoreLocalDraft(null);
        setSaveError(restored ? "连接服务器失败，已保留本地草稿，恢复连接后可继续保存。" : "连接服务器失败: " + api.getErrorMessage(e));
        setSaveStatus("error");
      });

    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (localDraftTimer.current) clearTimeout(localDraftTimer.current);
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
    async (newTitle: string, newContent: string, newMood: string, newTags = tags, newSpaces = spaces) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
      }
      if (localDraftTimer.current) {
        clearTimeout(localDraftTimer.current);
        localDraftTimer.current = undefined;
      }
      writeLocalDraft(date, { title: newTitle, content: newContent, mood: newMood, tags: newTags, spaces: newSpaces });
      setSaveStatus("saving");
      setSaveError("");
      try {
        const result = await recordSession.current.save({
          date,
          title: newTitle || "(无标题)",
          content: newContent,
          mood: newMood,
          tags: newTags,
          spaces: newSpaces,
        });
        if (!result.applied) return false;
        setArticle(result.article);
        articleRef.current = result.article;
        clearLocalDraft(date);
        setDirty(false);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2000);
        // 沉淀提示（非侵入、当天一次）：内容超过阈值且当天尚未提示过
        const plainLength = newContent.trim().replace(/\s+/g, "").length;
        if (plainLength >= 500
          && knowledgePromptDate.current !== date
          && !hasLocalStorageItem(`knowledge-prompt:${date}`)) {
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
    [date, spaces, tags]
  );

  // Auto-save with debounce
  const autoSave = useCallback(
    (newTitle: string, newContent: string, newMood: string, newTags = tags, newSpaces = spaces) => {
      recordSession.current.markEdited();
      if (localDraftTimer.current) clearTimeout(localDraftTimer.current);
      localDraftTimer.current = setTimeout(() => {
        localDraftTimer.current = undefined;
        writeLocalDraft(date, { title: newTitle, content: newContent, mood: newMood, tags: newTags, spaces: newSpaces });
      }, 180);
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = undefined;
        doSave(newTitle, newContent, newMood, newTags, newSpaces);
      }, 1200);
    },
    [doSave, spaces, tags]
  );

  // Manual save
  const handleManualSave = () => {
    doSave(title, content, mood, tags, spaces);
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
        const saved = await doSave(title, content, mood, tags, spaces);
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
    onDateChange?.(nextDate);
  }, [confirm, content, date, dirty, doSave, mood, onDateChange, spaces, tags, title]);

  const requestReturn = useCallback(async () => {
    if (!onReturn) return;
    if (dirty || saveTimer.current) {
      const shouldSave = await confirm({
        title: "离开当天记录",
        message: "当前记录有未保存内容。返回复盘库前先保存吗？",
        confirmText: "先保存",
      });
      if (shouldSave) {
        const saved = await doSave(title, content, mood, tags, spaces);
        if (!saved) return;
      } else if (!(await confirm({
        title: "放弃未保存内容",
        message: "确定放弃未保存内容并返回复盘库？",
        confirmText: "放弃并返回",
        danger: true,
      }))) {
        return;
      }
    }
    onReturn();
  }, [confirm, content, dirty, doSave, mood, onReturn, spaces, tags, title]);

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
    // AI 总结是正文的派生版本；正文改变后必须重新生成，避免把旧摘要提取入库。
    if (aiResult || aiSourceContent) {
      setAiResult("");
      setAiSourceContent("");
      setAiError("");
      setCardExtractNotice("");
      setCardExtractCount(0);
    }
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
      setSpaces([]);
      setDirty(false);
      setSaveStatus("idle");
      setSaveError("");
      clearLocalDraft(date);
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
    setAiSourceContent("");
    setCardExtractNotice("");
    setCardExtractCount(0);
    try {
      const data = await api.summarizeWithAI({ content });
      const summary = data.summary?.trim() || "";
      if (!summary) {
        setAiError("AI 未返回可用总结，请稍后重试");
      } else {
        setAiResult(summary);
        setAiSourceContent(content);
      }
    } catch (e: any) {
      setAiError(api.getErrorMessage(e));
    }
    setAiLoading(false);
  };

  const handleExtractKnowledgeCards = async () => {
    const extractionSummary = aiSourceContent === content ? aiResult.trim() : "";
    if (!extractionSummary) {
      setCardExtractNotice(aiResult.trim() ? "正文已变更，请重新生成 AI 总结" : "先生成 AI 总结，再从总结提取知识卡片");
      return;
    }
    setExtractingCards(true);
    setCardExtractNotice("");
    setCardExtractCount(0);
    try {
      // AI 总结只负责确认用户已经生成过结果；证据必须从原文提取，才能和日报来源定位对应。
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

  const closeAiPanel = () => {
    setAiResult("");
    setAiSourceContent("");
    setAiError("");
    setCardExtractNotice("");
    setCardExtractCount(0);
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
        writeLocalDraft(date, { title, content, mood, tags, spaces });
        doSave(title, content, mood, tags, spaces);
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
  }, [content, dirty, doSave, mood, spaces, tags, title]);

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
      className="page-surface page-surface-today h-full flex flex-col relative"
    >
      {zen && (
        <div className="flex items-center justify-between px-3 py-2 md:px-8 md:py-3">
          <span className="text-xs font-medium text-[var(--ui-text-subtle)]">专注模式 · 按 Esc 退出</span>
          <button type="button" onClick={onToggleZen} className="ui-button-secondary h-8">
            <Minimize2 size={14} /> 退出
          </button>
        </div>
      )}
      {/* Header */}
      <div className="px-3 pb-2 pt-3 md:px-8 md:pt-4" style={zen ? { display: "none" } : undefined}>
        <div className="today-header-panel ui-panel px-2 py-2 sm:px-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
              <span className="ui-status-accent hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:flex">
                <Calendar size={16} strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <h1 className="text-base font-bold leading-tight tracking-tight text-[var(--ui-text)]">
                  每日记录
                </h1>
                <p className="mt-0.5 truncate text-xs text-[var(--ui-text-subtle)]">
                  {relativeDateLabel(date)} · {date}
                </p>
              </div>
              </div>

              <div className="flex items-center gap-1.5 md:hidden">
                <span className="text-[11px] text-[var(--ui-text-subtle)]">{wordCount} 字</span>
                <span
                  className={[
                    "text-[11px] font-medium",
                    saveStatus === "error"
                      ? "text-[var(--ui-danger-text)]"
                      : saveStatus === "saving"
                        ? "text-[var(--ui-accent-text)]"
                        : dirty
                          ? "text-[var(--ui-warning-text)]"
                          : "text-[var(--ui-success-text)]",
                  ].join(" ")}
                >
                  {saveStatus === "error" ? "保存失败" : saveStatus === "saving" ? "保存中" : dirty ? "未保存" : "已同步"}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
              <div className="ui-toolbar relative flex w-full items-center gap-1.5 sm:w-auto">
              <button
                type="button"
                onClick={() => requestDateChange(shiftDate(date, -1))}
                className="ui-icon-button h-9 w-9"
                aria-label="前一天"
                title="前一天"
              >
                <ChevronLeft size={16} />
              </button>
              <DatePickerPopover value={date} onChange={requestDateChange} className="flex-1 sm:w-[168px] sm:flex-none" />
              <button
                type="button"
                onClick={() => requestDateChange(shiftDate(date, 1))}
                className="ui-icon-button h-9 w-9"
                aria-label="后一天"
                title="后一天"
              >
                <ChevronRight size={16} />
              </button>
              {date !== todayDate() && (
                <button
                  type="button"
                  onClick={() => requestDateChange(todayDate())}
                  className="ui-button-secondary h-8 shrink-0 px-2.5 text-xs font-semibold text-[var(--ui-accent-text)]"
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
                  <span className="ui-status-accent inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium">
                    <LoaderCircle size={13} className="animate-spin" /> 保存中
                  </span>
                )}
                {saveStatus === "saved" && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="ui-status-success inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium"
                  >
                    <CheckCircle2 size={13} /> 已保存
                  </motion.span>
                )}
                {dirty && saveStatus !== "saving" && saveStatus !== "error" && (
                  <span className="ui-status-warning inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium">
                    <AlertTriangle size={13} /> 未保存
                  </span>
                )}
                {saveStatus === "error" && (
                  <span className="ui-status-danger inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium">
                    <AlertTriangle size={13} /> 保存失败
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="ui-soft-divider mt-2 grid grid-cols-2 gap-2 border-t pt-2 md:flex md:flex-wrap md:items-center xl:border-t-0 xl:pt-0">
            {returnTo && onReturn && (
              <button
                type="button"
                onClick={() => void requestReturn()}
                className="ui-button-secondary col-span-2 w-full md:col-span-1 md:w-auto"
                title="返回刚才的复盘库位置"
              >
                <ChevronLeft size={14} /> 返回复盘库
              </button>
            )}
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
              <DropdownMenuContent align="start" className="w-[calc(100vw-1.5rem)] max-w-[360px] p-2">
                {TEMPLATES.map((t) => (
                  <DropdownMenuItem
                    key={t.name}
                    onSelect={() => applyTemplate(t)}
                    className="flex-col items-start gap-1 px-3 py-2.5"
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-[var(--ui-text)]">{t.name}</span>
                      {t.autoTitle && (
                        <span className="ui-status-accent rounded-full px-2 py-0.5 text-[10px] font-medium">自动标题</span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-xs leading-5 text-[var(--ui-text-subtle)]">{t.description}</p>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* AI 总结 + 提取卡片（移动端占满一行，桌面端并排） */}
            <div className="col-span-2 flex w-full gap-2 md:col-span-1 md:w-auto">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={(event) => {
                  aiTriggerRef.current = event.currentTarget;
                  void handleAISummary();
                }}
                disabled={aiLoading}
                className="ui-button-secondary flex-1 text-[var(--ui-accent-text)] md:w-auto md:flex-none"
                title="AI 总结当前内容"
              >
                {aiLoading ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {aiLoading ? "总结中" : "AI 总结"}
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={(event) => {
                  aiTriggerRef.current = event.currentTarget;
                  void handleExtractKnowledgeCards();
                }}
                disabled={extractingCards}
                className="ui-button-secondary flex-1 text-[var(--ui-success-text)] md:w-auto md:flex-none"
                title="先生成 AI 总结，再从总结提取知识卡片草稿"
              >
                {extractingCards ? <LoaderCircle size={14} className="animate-spin" /> : <BookMarked size={14} />}
                {extractingCards ? "提取中" : "提取卡片"}
              </motion.button>
            </div>

            <button
              type="button"
              onClick={onToggleZen}
              className="ui-button-ghost hidden md:inline-flex"
              title="专注模式（隐藏侧栏与干扰）"
            >
              <Maximize2 size={14} /> 专注
            </button>

            <div className="col-span-2 flex items-center gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setMetaExpanded((value) => !value)}
                className="ui-button-secondary min-w-0 flex-1"
              >
                <Smile size={14} />
                心情与标签
                {metaExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              <div className="relative shrink-0" data-mobile-more>
                <button
                  type="button"
                  onClick={() => setShowMobileMore((value) => !value)}
                  className="ui-button-secondary h-10 w-10 px-0"
                  aria-label="打开更多操作"
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
                      className="ui-floating-surface absolute right-0 top-full z-30 mt-2 w-36 rounded-xl p-1.5"
                    >
                        <button
                          type="button"
                          onClick={() => {
                            setShowMobileMore(false);
                            onToggleZen?.();
                          }}
                          className="ui-button-ghost h-9 min-h-9 w-full justify-start gap-2 border-0 bg-transparent px-2.5 text-xs"
                        >
                          <Maximize2 size={14} /> 专注模式
                        </button>
                        {article && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowMobileMore(false);
                              handleDelete();
                            }}
                            className="ui-button-danger h-9 min-h-9 w-full justify-start gap-2 border-0 bg-transparent px-2.5 text-xs"
                          >
                            <Trash2 size={14} /> 删除记录
                          </button>
                        )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

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

        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ui-text-subtle)] md:hidden">
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
              className="ui-status-accent mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-xs"
            >
              <span className="text-[var(--ui-text-muted)]">今天的记录比较长，可以先生成 AI 总结，再从总结提取知识卡片。</span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLocalStorageFlag(`knowledge-prompt:${date}`);
                    setKnowledgePrompt(false);
                    void handleAISummary();
                  }}
                  className="ui-button-primary h-7 px-2.5 text-xs"
                >
                  <Sparkles size={12} /> 生成总结
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLocalStorageFlag(`knowledge-prompt:${date}`);
                    setKnowledgePrompt(false);
                  }}
                  className="ui-button-ghost h-7 min-h-7 px-2 text-xs"
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
            <Dialog.Root
              open
              onOpenChange={(open) => { if (!open) closeAiPanel(); }}
            >
              <Dialog.Portal>
                <Dialog.Overlay className="ui-overlay fixed inset-0 z-30 data-[state=open]:animate-fade-in md:hidden" />
                <Dialog.Content
                  asChild
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    aiTriggerRef.current?.focus();
                  }}
                >
                  <motion.div
                    initial={{ x: "100%", opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: "100%", opacity: 0 }}
                    transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    className="ui-modal-surface fixed bottom-0 right-0 top-auto z-40 flex h-[82dvh] w-full max-w-[100vw] flex-col overflow-hidden rounded-t-2xl outline-hidden md:bottom-auto md:top-[10dvh] md:h-[82dvh] md:w-[480px] md:max-w-[42vw] md:rounded-l-2xl md:rounded-tr-none md:border-r-0"
                  >
                    <Dialog.Title className="sr-only">{aiResult || aiError ? "AI 总结" : "提取知识卡片"}</Dialog.Title>
                    <Dialog.Description className="sr-only">查看 AI 生成的总结，或从总结提取知识卡片。</Dialog.Description>
                    <div className="ui-soft-divider flex items-center justify-between gap-3 border-b px-5 py-3.5">
                      <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--ui-text)]" aria-hidden="true">
                        {aiResult || aiError ? <Bot size={16} /> : <BookMarked size={16} />}
                        {aiResult || aiError ? "AI 总结" : "提取知识卡片"}
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            aiTriggerRef.current = event.currentTarget;
                            void handleExtractKnowledgeCards();
                          }}
                          disabled={extractingCards}
                          className="ui-button-secondary h-8 px-2.5 text-xs"
                          title="从 AI 总结提取知识卡片草稿"
                        >
                          {extractingCards ? <LoaderCircle size={13} className="animate-spin" /> : <BookMarked size={13} />}
                          提取卡片
                        </button>
                        <Dialog.Close asChild>
                          <button type="button" onClick={closeAiPanel} className="ui-icon-button" aria-label="关闭 AI 结果">
                            <X size={15} />
                          </button>
                        </Dialog.Close>
                      </div>
                    </div>
                    <div className={`flex-1 overflow-y-auto p-5 ${aiError ? "text-[var(--ui-danger-text)]" : ""}`}>
                      {cardExtractNotice && (
                        <div className="ui-panel-muted mb-3 flex flex-col gap-2 px-3 py-2 text-xs font-medium sm:flex-row sm:items-center sm:justify-between">
                          <span>{cardExtractNotice}</span>
                          {cardExtractCount > 0 && onNavigate && (
                            <button
                              type="button"
                              onClick={() => onNavigate("knowledge")}
                              className="ui-status-accent inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-xs font-semibold"
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
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
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
              <button type="button" onClick={handleManualSave} className="ml-2 underline">重试保存</button>
              <button type="button" onClick={() => setSaveError("")} className="ml-2 underline">关闭</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={`${metaExpanded ? "block" : "hidden"} px-3 pb-3 md:block md:px-8`} style={zen ? { display: "none" } : undefined}>
        <div className="today-meta-panel ui-panel-muted grid gap-3 p-2.5 lg:grid-cols-[minmax(260px,0.9fr)_1.1fr]">
          <div className="min-w-0">
            <div className="ui-section-kicker mb-2 flex items-center gap-2 px-1">
              <Smile size={13} /> 心情
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {moods.map((m) => (
                <motion.button
                  key={m.emoji}
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  onClick={() => handleMoodChange(m.emoji)}
                  aria-pressed={mood === m.emoji}
                  className={mood === m.emoji ? "ui-filter-button ui-filter-button-active h-8 shrink-0 gap-1.5 px-2 text-sm" : "ui-filter-button h-8 shrink-0 gap-1.5 border-transparent px-2 text-sm"}
                  title={m.label}
                >
                  <span>{m.emoji}</span>
                  <span className="text-xs font-medium">{m.label}</span>
                </motion.button>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <div className="ui-section-kicker mb-2 flex items-center justify-between gap-2 px-1">
              <span className="inline-flex items-center gap-2"><Tag size={13} /> 标签</span>
              {quickTags.length > 0 && <span className="font-normal normal-case tracking-normal">可快速选择</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="ui-status-accent ui-chip border-[var(--ui-selected-border)] bg-[var(--ui-surface-selected)] text-[var(--ui-accent-text)] hover:bg-[var(--ui-surface-hover)]"
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
                  className="ui-filter-button h-7 min-h-7 rounded-full px-2.5 text-xs"
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
          className="today-title-input w-full border-0 bg-transparent text-2xl font-semibold text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-disabled)] md:text-2xl"
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
          <div className="ui-section-kicker mb-2 flex items-center justify-between gap-3">
            <span>编辑</span>
            <span className="font-mono normal-case tracking-normal">{wordCount} 字</span>
          </div>
          <div className="ui-editor-surface ui-code-editor h-[56dvh] min-h-0 w-full overflow-hidden md:h-auto md:flex-1">
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
          <div className="ui-section-kicker mb-2 flex items-center justify-between gap-3">
            <span>预览</span>
            <span className="font-mono normal-case tracking-normal">{charCount} 字符</span>
          </div>
          <div className="ui-editor-surface h-[56dvh] min-h-0 overflow-y-auto p-4 md:h-auto md:flex-1 md:p-5">
            <div className="mx-auto max-w-[760px]">
              <MarkdownPreview content={content} onWikiLink={onWikiLink} onRepairContent={handleContentChange} />
            </div>
          </div>
          <div className="h-24 md:hidden" />
        </div>
      </div>
      {dialog}
    </motion.div>
  );
}

function MarkdownPreview({ content, onWikiLink, onRepairContent }: { content: string; onWikiLink?: (title: string) => void; onRepairContent?: (fixedContent: string) => void }) {
  return <MarkdownContent content={content} onWikiLink={onWikiLink} onRepairContent={onRepairContent} />;
}
