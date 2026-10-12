import ReadingActions from "./workspace/ReadingActions";
import { ReadingSurface } from "./ui/reading-surface";
import { useWideLayout } from "../lib/useWideLayout";
import ResponsiveSplit, { preloadSplit } from "./workspace/ResponsiveSplit";
import { useMobileLayout } from "../lib/useMobileLayout";
import {useQueryClient} from "@tanstack/react-query";
import {useDeferredValue} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import TodayAIPanel from "./TodayAIPanel";
import { WallpaperSurface } from "./workspace/WallpaperSurface";
import {
  AlertTriangle,
  BookMarked,
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
import { offerArticleUndo } from "../lib/articleUndo";
import { normalizeTag } from "../lib/tags";
import { DailyRecordSession } from "../lib/dailyRecordSession";
import MarkdownContent from "./MarkdownContent";
import { LoadingState, useConfirmDialog } from "./ui/Feedback";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import DatePickerPopover from "./ui/date-picker";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import "./TodayPage.css";

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


### 2. 我实际做了什么

- 
- 
- 

### 3. 为什么会这样



### 4. 我学到的通用规律



### 5. 下次先查哪里
`;

const TEMPLATES = [
  {
    name: "日总结（5问）",
    description: "适合严肃复盘，保留原因、规律和下次动作",
    template: DAILY_TEMPLATE,
    autoTitle: "{date} 总结",
  },
  {
    name: "空白",
    description: "直接从空白页开始写",
    template: "",
    autoTitle: "",
  },
  {
    name: "简洁日记",
    description: "轻量记录当天状态和收获",
    template: "## {date}\n\n今天...\n\n### 收获\n\n- \n\n### 反思\n\n- ",
    autoTitle: "{date} 日记",
  },
  {
    name: "问题复盘",
    description: "用于拆解问题、根因和预防动作",
    template:
      "## {date} 问题复盘\n\n### 问题是什么\n\n\n### 影响范围\n\n\n### 直接原因\n\n\n### 根因判断\n\n\n### 下次预防动作\n\n- ",
    autoTitle: "{date} 问题复盘",
  },
  {
    name: "学习记录",
    description: "记录概念、例子和仍未弄懂的问题",
    template:
      "## {date} 学习记录\n\n### 学了什么\n\n\n### 关键概念\n\n- \n\n### 例子或应用\n\n\n### 还没弄懂\n\n- ",
    autoTitle: "{date} 学习记录",
  },
  {
    name: "工作日志",
    description: "适合整理完成事项、问题和明日计划",
    template:
      "## {date}\n\n### 今日完成\n- \n- \n\n### 遇到的问题\n- \n\n### 明日计划\n- \n- ",
    autoTitle: "{date} 工作日志",
  },
];

const DEFAULT_TAG_SUGGESTIONS = [
  "工作",
  "学习",
  "复盘",
  "项目",
  "问题",
  "设计",
  "阅读",
  "健康",
  "沟通",
  "计划",
];

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
    const parsed = JSON.parse(
      localStorage.getItem(localDraftKey(date)) || "null",
    ) as Partial<LocalDraft> | null;
    if (
      !parsed ||
      typeof parsed.savedAt !== "number" ||
      typeof parsed.title !== "string" ||
      typeof parsed.content !== "string" ||
      typeof parsed.mood !== "string" ||
      !Array.isArray(parsed.tags)
    ) {
      return null;
    }
    return {
      title: parsed.title,
      content: parsed.content,
      mood: parsed.mood,
      tags: parsed.tags.filter((tag): tag is string => typeof tag === "string"),
      spaces: Array.isArray(parsed.spaces)
        ? parsed.spaces.filter(
            (space): space is string => typeof space === "string",
          )
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
    localStorage.setItem(
      localDraftKey(date),
      JSON.stringify({ ...draft, savedAt: Date.now() }),
    );
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

preloadSplit();

type SaveStatus = "idle" | "saving" | "saved" | "error";
type MobilePane = "edit" | "preview";

export default function TodayPage({
  targetDate,
  targetNonce,
  initialEditing = false,
  onRead,
  onDateChange,
  onNavigate,
  returnTo,
  onReturn,
  returnLabel = "复盘库",
  zen,
  onToggleZen,
  dark,
  onWikiLink,
}: {
  targetDate?: string;
  targetNonce?: number;
  initialEditing?: boolean;
  onRead?: () => void;
  onDateChange?: (date: string) => void;
  onNavigate?: (page: "knowledge") => void;
  returnTo?: string;
  onReturn?: () => void;
  returnLabel?: string;
  zen?: boolean;
  onToggleZen?: () => void;
  dark?: boolean;
  onWikiLink?: (title: string) => void;
}) {
  const queryClient=useQueryClient();
  const titleFieldRef = useRef<HTMLTextAreaElement>(null);
  const [selectedDate, setSelectedDate] = useState(
    () => targetDate || todayDate(),
  );
  const [article, setArticle] = useState<Article | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mood, setMood] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  // 空间归属在知识确认阶段维护；这里只静默保留旧记录的关系，避免编辑日报时误清除。
  const [spaces, setSpaces] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const deferredContent = useDeferredValue(content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const isMobile = useMobileLayout();
  const wide=useWideLayout();
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>(() =>
    typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches
      ? initialEditing ? "edit" : "preview"
      : "edit",
  );
  useEffect(() => {
    if (isMobile) { setMobilePane(initialEditing ? "edit" : "preview"); setMetaExpanded(false); }
  }, [selectedDate, isMobile, initialEditing]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>(
    DEFAULT_TAG_SUGGESTIONS,
  );
  const [aiMode, setAiMode] = useState<"summary" | "knowledge" | null>(null);
  useEffect(() => setAiMode(null), [selectedDate]);
  const aiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const localDraftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const articleRef = useRef<Article | null>(null);
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const recordSession = useRef(
    new DailyRecordSession({
      create: api.createArticle,
      update: api.updateArticle,
    }),
  );
  const externalNonceRef = useRef(targetNonce);
  const { confirm, dialog } = useConfirmDialog();
  const date = selectedDate;
  const quickTags = useMemo(
    () => tagSuggestions.filter((tag) => !tags.includes(tag)).slice(0, 10),
    [tagSuggestions, tags],
  );
  // Load article for selected date
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
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
    const generation = recordSession.current.begin(date, null);
    articleRef.current = null;
    const localDraft = readLocalDraft(date);
    const restoreLocalDraft = (serverArticle: Article | null) => {
      if (!localDraft) return false;
      const serverUpdatedAt = serverArticle
        ? Date.parse(serverArticle.updated_at)
        : Number.NaN;
      if (
        serverArticle &&
        (!Number.isFinite(serverUpdatedAt) ||
          localDraft.savedAt <= serverUpdatedAt)
      ) {
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
    api
      .getTodayArticle(date)
      .then((a) => {
        if (cancelled || !recordSession.current.acceptLoaded(generation, a))
          return;
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
        setLoadError(api.getErrorMessage(e));
        setSaveError(
          restored
            ? "连接服务器失败，已保留本地草稿，恢复连接后可继续保存。"
            : "连接服务器失败: " + api.getErrorMessage(e),
        );
        setSaveStatus("error");
      }).finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (localDraftTimer.current) clearTimeout(localDraftTimer.current);
    };
  }, [date, loadAttempt]);

  // Keep ref in sync
  useEffect(() => {
    articleRef.current = article;
  }, [article]);

  useEffect(() => {
    let cancelled = false;
    queryClient.fetchQuery({queryKey:["articleTagSuggestions",api.getServerUrl()],queryFn:({signal})=>api.getArticleTagSuggestions({signal}),staleTime:60_000})
      .then((frequent) => {
        if (cancelled) return;
        setTagSuggestions([...new Set([...frequent,...DEFAULT_TAG_SUGGESTIONS])].slice(0,16));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  // Persist save — uses ref to avoid stale closure
  const doSave = useCallback(
    async (
      newTitle: string,
      newContent: string,
      newMood: string,
      newTags = tags,
      newSpaces = spaces,
    ) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
      }
      if (localDraftTimer.current) {
        clearTimeout(localDraftTimer.current);
        localDraftTimer.current = undefined;
      }
      writeLocalDraft(date, {
        title: newTitle,
        content: newContent,
        mood: newMood,
        tags: newTags,
        spaces: newSpaces,
      });
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
        setTimeout(
          () => setSaveStatus((s) => (s === "saved" ? "idle" : s)),
          2000,
        );
        return true;
      } catch (e: any) {
        setSaveStatus("error");
        setSaveError(api.getErrorMessage(e));
        return false;
      }
    },
    [date, spaces, tags],
  );

  // Auto-save with debounce
  const autoSave = useCallback(
    (
      newTitle: string,
      newContent: string,
      newMood: string,
      newTags = tags,
      newSpaces = spaces,
    ) => {
      recordSession.current.markEdited();
      if (localDraftTimer.current) clearTimeout(localDraftTimer.current);
      localDraftTimer.current = setTimeout(() => {
        localDraftTimer.current = undefined;
        writeLocalDraft(date, {
          title: newTitle,
          content: newContent,
          mood: newMood,
          tags: newTags,
          spaces: newSpaces,
        });
      }, 180);
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = undefined;
        doSave(newTitle, newContent, newMood, newTags, newSpaces);
      }, 1200);
    },
    [doSave, spaces, tags],
  );

  // Manual save
  const handleManualSave = () => {
    doSave(title, content, mood, tags, spaces);
  };

  const requestDateChange = useCallback(
    async (nextDate: string) => {
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
        } else if (
          !(await confirm({
            title: "放弃未保存内容",
            message: "确定放弃未保存内容并切换日期？",
            confirmText: "放弃并切换",
            danger: true,
          }))
        ) {
          return;
        }
      }
      setSelectedDate(nextDate);
      onDateChange?.(nextDate);
    },
    [
      confirm,
      content,
      date,
      dirty,
      doSave,
      mood,
      onDateChange,
      spaces,
      tags,
      title,
    ],
  );

  const requestReturn = useCallback(async () => {
    if (!onReturn) return;
    if (dirty || saveTimer.current) {
      const shouldSave = await confirm({
        title: "离开当天记录",
        message: `当前记录有未保存内容。返回${returnLabel}前先保存吗？`,
        confirmText: "先保存",
      });
      if (shouldSave) {
        const saved = await doSave(title, content, mood, tags, spaces);
        if (!saved) return;
      } else if (
        !(await confirm({
          title: "放弃未保存内容",
          message: `确定放弃未保存内容并返回${returnLabel}？`,
          confirmText: "放弃并返回",
          danger: true,
        }))
      ) {
        return;
      }
    }
    onReturn();
  }, [
    confirm,
    content,
    dirty,
    doSave,
    mood,
    onReturn,
    returnLabel,
    spaces,
    tags,
    title,
  ]);

  useEffect(() => {
    if (targetDate && targetNonce !== externalNonceRef.current) {
      externalNonceRef.current = targetNonce;
      void requestDateChange(targetDate);
    }
  }, [requestDateChange, targetDate, targetNonce]);

  const handleTitleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
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
      title: "移入记录回收站",
      message: `确定要把 ${date} 的记录移入回收站吗？正文和空间关系会保留，可随时恢复。`,
      confirmText: "移入回收站",
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
      offerArticleUndo({ id: current.id, date }, async () => {
        if (selectedDateRef.current !== date) return;
        const restored = await api.getTodayArticle(date);
        if (!restored)
          throw new Error("恢复后暂时找不到这条记录，请刷新后重试。");
        articleRef.current = restored;
        setArticle(restored);
        setTitle(restored.title);
        setContent(restored.content);
        setMood(restored.mood);
        setTags(restored.tags);
        setSpaces(restored.spaces || []);
        setDirty(false);
        setSaveStatus("idle");
        setSaveError("");
      });
    } catch (e: any) {
      setSaveError("删除失败: " + api.getErrorMessage(e));
    }
  };

  const applyTemplate = async (tmpl: (typeof TEMPLATES)[number]) => {
    // Warn if overwriting existing content
    if (
      content.trim() &&
      !(await confirm({
        title: "套用模板",
        message: "当前内容将被模板替换，确定继续？",
        confirmText: "替换",
        danger: true,
      }))
    )
      return;
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

  // Ctrl+S keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.isComposing ||
        e.defaultPrevented ||
        document.querySelector('[role="dialog"]')
      )
        return;
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
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !document.querySelector('[role="dialog"]')
      )
        onToggleZen?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [zen, onToggleZen]);

  useEffect(() => {
    const field = titleFieldRef.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [title, zen, mobilePane, isMobile]);

  // Word & char count
  const charCount = content.length;
  const wordCount = content ? content.replace(/\s/g, "").length : 0;

  const editorPane = <div
          className={`${zen || mobilePane === "edit" ? "flex" : "hidden"} today-editor-pane min-w-0 flex-col md:flex`}
        >
          <div className="today-pane-heading ui-section-kicker mb-2 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <PenLine size={13} /> 编辑{" "}
              <span className="today-format-hint">Markdown</span>
            </span>
            <span className="font-mono normal-case tracking-normal">
              {wordCount} 字
            </span>
          </div>
          <WallpaperSurface target="today.editor" className="today-writing-surface ui-editor-surface ui-code-editor h-[56dvh] min-h-0 w-full overflow-hidden md:h-auto md:flex-1">
            <CodeMirror
              value={content}
              onCreateEditor={view => { if (isMobile) view.dispatch({ selection: { anchor: view.state.doc.length } }); }}
              onChange={handleContentChange}
              extensions={[markdown(), EditorView.lineWrapping]}
              placeholder={`记录 ${date} 的进展、想法与收获…`}
              aria-label="今日记录正文"
              theme={dark ? "dark" : "light"}
              height="100%"
              style={{ height: "100%" }}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: false,
              }}
            />
          </WallpaperSurface>
        </div>;
  const previewPane = <div
          className={`${mobilePane === "preview" ? "flex" : "hidden"} today-preview-pane min-w-0 flex-col md:flex`}
          style={zen ? { display: "none" } : undefined}
        >
          <div className="today-pane-heading ui-section-kicker mb-2 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <Eye size={13} /> 实时预览
            </span>
            <span className="font-mono normal-case tracking-normal">
              {charCount} 字符
            </span>
          </div>
          <WallpaperSurface target="today.preview" className="today-preview-surface ui-editor-surface h-[56dvh] min-h-0 overflow-y-auto p-4 md:h-auto md:flex-1 md:p-5">
            <ReadingSurface className="today-reading-document mx-auto max-w-[760px]">
              {isMobile && loading ? <LoadingState label="正在读取记录…" rows={3}/> : isMobile && loadError && !content.trim() && !dirty ? <div className="today-reading-empty" role="alert"><h2>暂时无法读取记录</h2><p>{loadError}</p><button className="ui-button-secondary" onClick={() => setLoadAttempt(value => value + 1)}>重新读取</button></div> : isMobile && !content.trim() ? <div className="today-reading-empty"><Calendar size={30} strokeWidth={1.4}/><h2>{article || title.trim() ? "正文暂时为空" : "这一天还没有记录"}</h2><p>可以查看其他日期，或补记今天的进展与想法。</p><button className="ui-button-primary" onClick={() => setMobilePane("edit")}>{article || title.trim() ? "补充正文" : "开始记录"}</button></div> : <MarkdownPreview
                content={deferredContent}
                onWikiLink={onWikiLink}
                onRepairContent={handleContentChange}
              />}
            </ReadingSurface>
          </WallpaperSurface>
        </div>;
  return (
    <motion.div
      initial={false}
      className="page-surface page-surface-today h-full flex flex-col relative"
      data-zen={zen || undefined}
      data-mobile-pane={mobilePane}
    >
      {zen && (
        <div className="flex items-center justify-between px-3 py-2 md:px-8 md:py-3">
          <span className="text-xs font-medium text-[var(--ui-text-subtle)]">
            专注模式 · 按 Esc 退出
          </span>
          <button
            type="button"
            onClick={onToggleZen}
            className="ui-button-secondary h-8"
          >
            <Minimize2 size={14} /> 退出
          </button>
        </div>
      )}
      {/* Header */}
      <div
        className="px-3 pb-2 pt-3 md:px-8 md:pt-4"
        style={zen ? { display: "none" } : undefined}
      >
        {isMobile ? <header className="today-reading-header">
          <div className="today-reading-topline">
            <h1>今日记录</h1>
            <div className="today-reading-tools">
              <button className="ui-button-secondary" disabled={loading} onClick={() => { if (mobilePane === "preview") setMobilePane("edit"); else { setMobilePane("preview"); if (initialEditing) onRead?.(); } }}><PenLine size={16}/>{mobilePane === "preview" ? "补记" : "返回阅读"}</button>
              <ReadingActions label="今日记录操作" actions={[
                ...(returnTo && onReturn ? [{id:"return",label:`返回${returnLabel}`,icon:<ChevronLeft size={16}/>,onSelect:()=>void requestReturn()}] : []),
                {id:"save",label:"立即保存",icon:<Save size={16}/>,disabled:loading || saveStatus === "saving",onSelect:handleManualSave},
                {id:"summary",label:"AI 总结",icon:<Sparkles size={16}/>,disabled:loading || !content.trim(),onSelect:origin=>{aiTriggerRef.current=origin;setAiMode("summary");}},
                {id:"knowledge",label:"提取知识",icon:<BookMarked size={16}/>,disabled:loading || !content.trim(),onSelect:origin=>{aiTriggerRef.current=origin;setAiMode("knowledge");}},
                {id:"meta",label:"心情与标签",icon:<Smile size={16}/>,disabled:loading,onSelect:()=>setMetaExpanded(value=>!value)},
                {id:"focus",label:"专注编辑",icon:<Maximize2 size={16}/>,disabled:loading,onSelect:()=>{setMobilePane("edit");onToggleZen?.();}},
                ...TEMPLATES.map(template=>({id:`template:${template.name}`,label:`使用模板：${template.name}`,disabled:loading,onSelect:()=>void applyTemplate(template)})),
                ...(article ? [{id:"trash",label:"移入回收站",variant:"danger" as const,icon:<Trash2 size={16}/>,onSelect:()=>void handleDelete()}] : []),
              ]}/>

            </div>
          </div>
          <div className="today-reading-date">
            <button className="ui-icon-button" aria-label="前一天" onClick={() => requestDateChange(shiftDate(date,-1))}><ChevronLeft size={18}/></button>
            <DatePickerPopover value={date} onChange={requestDateChange}/>
            <button className="ui-icon-button" aria-label="后一天" onClick={() => requestDateChange(shiftDate(date,1))}><ChevronRight size={18}/></button>
          </div>
          <div className="today-reading-status" role="status"><span>{relativeDateLabel(date)} · {wordCount} 字</span><span>{loading ? "正在读取" : loadError ? "服务器读取失败" : saveStatus === "error" ? "保存失败，请重试" : saveStatus === "saving" ? "正在保存" : dirty ? "本机修改尚未保存" : article ? "已同步" : "尚无记录"}</span></div>
        </header> : (
        <div className="today-header-panel px-2 py-2 sm:px-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="ui-status-accent hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:flex">
                  <Calendar size={16} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <h1 className="text-base font-bold leading-tight tracking-tight text-[var(--ui-text)]">
                    今日记录
                  </h1>
                  <p className="mt-0.5 truncate text-xs text-[var(--ui-text-subtle)]">
                    {relativeDateLabel(date)} · {date}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 md:hidden">
                <span className="text-[11px] text-[var(--ui-text-subtle)]">
                  {wordCount} 字
                </span>
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
                  {saveStatus === "error"
                    ? "保存失败"
                    : saveStatus === "saving"
                      ? "保存中"
                      : dirty
                        ? "未保存"
                        : "已同步"}
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
                <DatePickerPopover
                  value={date}
                  onChange={requestDateChange}
                  className="flex-1 sm:w-[168px] sm:flex-none"
                />
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

              <div className="hidden flex-wrap items-center gap-1.5 md:flex">
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

          <div className="today-actions ui-soft-divider mt-2 grid grid-cols-2 gap-2 border-t pt-2 md:flex md:flex-wrap md:items-center xl:border-t-0 xl:pt-0">
            {returnTo && onReturn && (
              <button
                type="button"
                onClick={() => void requestReturn()}
                className="ui-button-secondary col-span-2 w-full md:col-span-1 md:w-auto"
                title={`返回刚才的${returnLabel}位置`}
              >
                <ChevronLeft size={14} /> 返回{returnLabel}
              </button>
            )}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleManualSave}
              disabled={saveStatus === "saving"}
              className="ui-button-primary w-full md:w-auto"
              title="手动保存（Ctrl / ⌘ + S）"
            >
              <Save size={14} /> 保存
            </motion.button>

            {/* Template picker */}
            <DropdownMenu>
              <DropdownMenuTrigger className="ui-button-secondary w-full md:w-auto">
                <ClipboardList size={14} /> 模板
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[calc(100vw-1.5rem)] max-w-[360px] p-2"
              >
                {TEMPLATES.map((t) => (
                  <DropdownMenuItem
                    key={t.name}
                    onSelect={() => applyTemplate(t)}
                    className="flex-col items-start gap-1 px-3 py-2.5"
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-[var(--ui-text)]">
                        {t.name}
                      </span>
                      {t.autoTitle && (
                        <span className="ui-status-accent rounded-full px-2 py-0.5 text-[10px] font-medium">
                          自动标题
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-xs leading-5 text-[var(--ui-text-subtle)]">
                      {t.description}
                    </p>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="col-span-2 flex w-full gap-2 md:col-span-1 md:w-auto">
              <button
                type="button"
                onClick={(event) => {
                  aiTriggerRef.current = event.currentTarget;
                  setAiMode("summary");
                }}
                className="ui-button-secondary flex-1 md:flex-none"
              >
                <Sparkles size={14} />
                AI 总结
              </button>
              <button
                type="button"
                onClick={(event) => {
                  aiTriggerRef.current = event.currentTarget;
                  setAiMode("knowledge");
                }}
                className="ui-button-secondary flex-1 md:flex-none"
              >
                <BookMarked size={14} />
                提取知识
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleZen}
              className="ui-button-ghost hidden md:inline-flex"
              title="专注模式（隐藏侧栏与干扰）"
            >
              <Maximize2 size={14} /> 专注
            </button>

            <div className="col-span-2 flex items-center gap-2 md:ml-auto">
              <button
                type="button"
                onClick={() => setMetaExpanded((value) => !value)}
                className="ui-button-ghost min-w-0 flex-1"
                aria-expanded={metaExpanded}
                aria-controls="today-metadata"
              >
                <Smile size={14} />
                心情与标签
                {metaExpanded ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </button>

              <div className="relative shrink-0 md:hidden" data-mobile-more>
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
                          <Trash2 size={14} /> 移入回收站
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {article && (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleDelete}
                className="ui-button-ghost hidden text-[var(--ui-danger-text)] md:inline-flex"
                title="移入回收站"
              >
                <Trash2 size={14} /> 移入回收站
              </motion.button>
            )}
          </div>
        </div>

        )}
        <TodayAIPanel
          key={date}
          mode={aiMode}
          date={date}
          title={title}
          content={content}
          onMode={setAiMode}
          returnFocusRef={aiTriggerRef}
          onKnowledge={() => {
            setAiMode(null);
            onNavigate?.("knowledge");
          }}
          ensureSource={async () => {
            if (!dirty && articleRef.current?.content === content)
              return articleRef.current;
            const sourceDate = date;
            const saved = await doSave(title, content, mood, tags, spaces);
            return saved && selectedDateRef.current === sourceDate
              ? articleRef.current
              : null;
          }}
        />

        {/* Save error banner */}
        <AnimatePresence>
          {saveError && (!isMobile || !loadError || dirty) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="ui-alert-bad mt-2 text-xs"
            >
              {saveError}
              <button
                type="button"
                onClick={handleManualSave}
                className="ml-2 underline"
              >
                重试保存
              </button>
              <button
                type="button"
                onClick={() => setSaveError("")}
                className="ml-2 underline"
              >
                关闭
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        id="today-metadata"
        className={`${metaExpanded ? "block" : "hidden"} px-3 pb-3 md:px-8`}
        style={zen ? { display: "none" } : undefined}
      >
        <div className="today-meta-panel ui-panel-muted grid gap-3 p-2.5 lg:grid-cols-[minmax(260px,0.9fr)_1.1fr]">
          <div className="min-w-0">
            <div className="ui-section-kicker mb-2 flex items-center gap-2 px-1">
              <Smile size={13} /> 心情
            </div>
            <div className="flex flex-wrap gap-1.5 pb-0.5">
              {moods.map((m) => (
                <motion.button
                  key={m.emoji}
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleMoodChange(m.emoji)}
                  aria-pressed={mood === m.emoji}
                  className={
                    mood === m.emoji
                      ? "ui-filter-button ui-filter-button-active h-8 shrink-0 gap-1.5 px-2 text-sm"
                      : "ui-filter-button h-8 shrink-0 gap-1.5 border-transparent px-2 text-sm"
                  }
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
              <span className="inline-flex items-center gap-2">
                <Tag size={13} /> 标签
              </span>
              {quickTags.length > 0 && (
                <span className="font-normal normal-case tracking-normal">
                  可快速选择
                </span>
              )}
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
                placeholder="添加标签"
                aria-label="添加标签"
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
      <div
        className={`today-title-block px-3 pb-2 md:px-8 ${zen ? "mx-auto w-full max-w-2xl" : ""}`}
      >
        {isMobile && mobilePane === "preview" ? (title.trim() && <h2 className="today-reading-title">{title}</h2>) : <textarea
          ref={titleFieldRef}
          rows={1}
          value={title}
          onChange={handleTitleChange}
          placeholder="为这一天写个标题…"
          aria-label="今日记录标题"
          disabled={isMobile && loading}
          className="today-title-input w-full resize-none overflow-hidden border-0 bg-transparent text-2xl font-semibold text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-disabled)] md:text-2xl"
        />}
      </div>

      {!isMobile && !wide && !zen && <div className="today-narrow-tabs" role="group" aria-label="今日记录视图"><button className="ui-button-secondary" aria-pressed={mobilePane === "edit"} onClick={()=>setMobilePane("edit")}>编辑记录</button><button className="ui-button-secondary" aria-pressed={mobilePane === "preview"} onClick={()=>setMobilePane("preview")}>阅读预览</button></div>}
      <div className="today-workspace flex-1 min-h-0 px-3 pb-28 md:px-8 md:pb-6" data-pane={mobilePane} data-wide={wide} data-zen={zen}>
        {wide && !zen ? <ResponsiveSplit workspace="today" first={editorPane} second={previewPane}/> : <>{(!isMobile || !loading && (zen || mobilePane === "edit")) && editorPane}{previewPane}</>}
      </div>
      {dialog}
    </motion.div>
  );
}

function MarkdownPreview({
  content,
  onWikiLink,
  onRepairContent,
}: {
  content: string;
  onWikiLink?: (title: string) => void;
  onRepairContent?: (fixedContent: string) => void;
}) {
  return (
    <MarkdownContent
      content={content}
      onWikiLink={onWikiLink}
      onRepairContent={onRepairContent}
    />
  );
}
