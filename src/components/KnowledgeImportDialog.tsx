import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Clipboard,
  Copy,
  FileText,
  FolderOpen,
  LoaderCircle,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import * as api from "../lib/api";
import { cardTypeLabels } from "../lib/cardLabels";
import {
  knowledgeCardImportPrompt,
  parseKnowledgeCardImport,
  parseKnowledgeCardMarkdownImport,
  parseKnowledgeCardTextImport,
} from "../lib/knowledgeImport";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

const MAX_SOURCE_CHARS = 1_000_000;
const MAX_FILE_BYTES = 8_000_000;
const JOB_POLL_INTERVAL_MS = 900;
const AI_JOB_STORAGE_KEY = "daily-summary-knowledge-import-job";
const cardTypeOptions = Object.entries(cardTypeLabels) as Array<[api.KnowledgeCardType, string]>;

type ImportMode = "ai" | "manual";
type ManualFormat = "json" | "markdown" | "text";
type AiStage = "input" | "progress" | "review";
type Candidate = api.KnowledgeCardImportInput & { id: string; batchIndex?: number };

function readStoredJobId() {
  try {
    return window.sessionStorage.getItem(AI_JOB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeJobId(jobId: string) {
  try {
    window.sessionStorage.setItem(AI_JOB_STORAGE_KEY, jobId);
  } catch {
    // 任务仍会在当前页面继续轮询；存储不可用时刷新后需要重新开始。
  }
}

function clearStoredJobId() {
  try {
    window.sessionStorage.removeItem(AI_JOB_STORAGE_KEY);
  } catch {
    // 隐私模式下 sessionStorage 可能不可用。
  }
}

function isTerminalJobStatus(status: api.KnowledgeAnalyzeJobStatus) {
  return status === "completed" || status === "completed_with_errors" || status === "failed" || status === "cancelled";
}

function candidatesFromJob(job: api.KnowledgeAnalyzeJob): Candidate[] {
  const batchedCards = job.batches.flatMap((batch) => batch.cards.map((card, cardIndex) => ({ card, batchIndex: batch.index, cardIndex })));
  const cards = batchedCards.length > 0 ? batchedCards : job.cards.map((card, cardIndex) => ({ card, batchIndex: undefined, cardIndex }));
  return cards.map(({ card, batchIndex, cardIndex }, index) => ({
    ...card,
    id: `${job.job_id}-${batchIndex ?? "all"}-${batchIndex === undefined ? index : cardIndex}`,
    batchIndex,
  }));
}

function readList(value: string) {
  return value
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function withDefaultSpace(card: api.KnowledgeCardImportInput, space: string): api.KnowledgeCardImportInput {
  const normalizedSpace = space.trim();
  if (!normalizedSpace) return card;
  const projects = [...(card.projects || [])];
  if (!projects.some((project) => project.toLocaleLowerCase() === normalizedSpace.toLocaleLowerCase())) {
    projects.push(normalizedSpace);
  }
  return { ...card, projects };
}

function formatCharCount(value: string) {
  return `${[...value].length.toLocaleString()} / ${MAX_SOURCE_CHARS.toLocaleString()} 字`;
}

export default function KnowledgeImportDialog({
  open,
  onOpenChange,
  spaces,
  onImported,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: api.KnowledgeProject[];
  onImported?: (result: { imported: number; skipped: number }) => void | Promise<void>;
  onOpenSettings?: () => void;
}) {
  const [mode, setMode] = useState<ImportMode>("ai");
  const [manualFormat, setManualFormat] = useState<ManualFormat>("json");
  const [manualRaw, setManualRaw] = useState("");
  const [singleTitle, setSingleTitle] = useState("");
  const [defaultSpace, setDefaultSpace] = useState("");
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState("");
  const [aiRaw, setAiRaw] = useState("");
  const [aiStage, setAiStage] = useState<AiStage>("input");
  const [aiCandidates, setAiCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [aiSkipped, setAiSkipped] = useState(0);
  const [aiModel, setAiModel] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiJobId, setAiJobId] = useState<string | null>(null);
  const [aiJob, setAiJob] = useState<api.KnowledgeAnalyzeJob | null>(null);
  const [jobPollNonce, setJobPollNonce] = useState(0);
  const [retryingChunks, setRetryingChunks] = useState(false);
  const [cancellingJob, setCancellingJob] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiConfig, setAiConfig] = useState<api.AiConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobPollTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const aiCandidatesRef = useRef<Candidate[]>([]);
  const selectedCandidateIdsRef = useRef<string[]>([]);
  aiCandidatesRef.current = aiCandidates;
  selectedCandidateIdsRef.current = selectedCandidateIds;

  const manualParsed = useMemo(() => {
    if (manualFormat === "json") return parseKnowledgeCardImport(manualRaw);
    if (manualFormat === "markdown") return parseKnowledgeCardMarkdownImport(manualRaw);
    return parseKnowledgeCardTextImport(manualRaw, singleTitle);
  }, [manualFormat, manualRaw, singleTitle]);
  const manualValidRows = useMemo(() => manualParsed.rows.filter((row) => row.card), [manualParsed.rows]);
  const manualInvalidRows = useMemo(() => manualParsed.rows.filter((row) => row.error), [manualParsed.rows]);
  const activeCandidate = useMemo(
    () => aiCandidates.find((candidate) => candidate.id === activeCandidateId) || aiCandidates[0] || null,
    [activeCandidateId, aiCandidates],
  );
  const aiSelectedCount = aiCandidates.filter((candidate) => selectedCandidateIds.includes(candidate.id)).length;
  const aiReady = !!aiConfig?.configured && !!aiConfig.api_key_configured;
  const aiConfigFailed = !!configError;

  function syncJobSnapshot(job: api.KnowledgeAnalyzeJob) {
    setAiJob(job);
    setAiSkipped(job.skipped_cards);
    setAiModel(job.model);
    setAiError(job.error || "");
    const previousCandidates = aiCandidatesRef.current;
    const previousById = new Map(previousCandidates.map((candidate) => [candidate.id, candidate]));
    const candidates = candidatesFromJob(job).map((candidate) => {
      const previous = previousById.get(candidate.id);
      return previous
        ? {
            ...candidate,
            card_type: previous.card_type,
            title: previous.title,
            content: previous.content,
            tags: previous.tags,
            projects: previous.projects,
            source_excerpt: previous.source_excerpt,
          }
        : candidate;
    });
    if (job.status === "completed" || (candidates.length > 0 && (job.status === "completed_with_errors" || job.status === "cancelled"))) {
      setAiCandidates(candidates);
      const previousSelected = new Set(selectedCandidateIdsRef.current);
      setSelectedCandidateIds(
        candidates
          .map((candidate) => candidate.id)
          .filter((id) => !previousCandidates.length || previousSelected.has(id) || !previousById.has(id)),
      );
      setActiveCandidateId((current) => (candidates.some((candidate) => candidate.id === current) ? current : candidates[0]?.id || null));
      setAiStage("review");
    } else {
      setAiStage("progress");
    }
  }

  useEffect(() => {
    if (!open) {
      setMode("ai");
      setManualFormat("json");
      setManualRaw("");
      setSingleTitle("");
      setDefaultSpace("");
      setSaving(false);
      setFileName("");
      setAiRaw("");
      setAiStage("input");
      setAiCandidates([]);
      setSelectedCandidateIds([]);
      setActiveCandidateId(null);
      setAiSkipped(0);
      setAiModel("");
      setAiBusy(false);
      setAiJobId(null);
      setAiJob(null);
      setJobPollNonce(0);
      setRetryingChunks(false);
      setCancellingJob(false);
      setAiError("");
      setAiConfig(null);
      setConfigError("");
      return;
    }

    let cancelled = false;
    setConfigLoading(true);
    setConfigError("");
    const savedJobId = readStoredJobId();
    if (savedJobId) setAiJobId(savedJobId);
    api.getAiConfig()
      .then((config) => {
        if (!cancelled) setAiConfig(config);
      })
      .catch((error) => {
        if (!cancelled) setConfigError(api.getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !aiJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const job = await api.getKnowledgeAnalyzeJob(aiJobId);
        if (cancelled) return;
        syncJobSnapshot(job);
        if (!isTerminalJobStatus(job.status)) {
          jobPollTimerRef.current = window.setTimeout(() => void poll(), JOB_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof api.ApiError && error.status === 404) {
          clearStoredJobId();
          setAiJobId(null);
          setAiJob(null);
          setAiStage("input");
          setAiError("后台分析任务已过期，请重新开始分析。 ");
          return;
        }
        setAiError(api.getErrorMessage(error));
        jobPollTimerRef.current = window.setTimeout(() => void poll(), JOB_POLL_INTERVAL_MS * 2);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (jobPollTimerRef.current !== null) {
        window.clearTimeout(jobPollTimerRef.current);
        jobPollTimerRef.current = null;
      }
    };
  }, [open, aiJobId, jobPollNonce]);

  const switchMode = (next: string) => {
    setMode(next as ImportMode);
    setFileName("");
    setAiError("");
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(knowledgeCardImportPrompt);
      toast.success("JSON 格式提示词已复制。", { duration: 2200 });
    } catch {
      toast.error("复制失败，请手动选中提示词复制。", { duration: 2800 });
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error("文件不能超过 8 MB，请拆分后再导入。", { duration: 3000 });
      return;
    }
    try {
      const text = await file.text();
      setFileName(file.name);
      if (mode === "ai") {
        setAiRaw(text);
        setAiStage("input");
        setAiCandidates([]);
        setSelectedCandidateIds([]);
        setActiveCandidateId(null);
        setAiSkipped(0);
        setAiError("");
      } else {
        setManualRaw(text);
        const lowerName = file.name.toLocaleLowerCase();
        setManualFormat(lowerName.endsWith(".json") ? "json" : lowerName.endsWith(".md") || lowerName.endsWith(".markdown") ? "markdown" : "text");
      }
      toast.success(`已读取 ${file.name}。`, { duration: 2200 });
    } catch {
      toast.error("文件读取失败，请改用一次性粘贴。", { duration: 3000 });
    }
  };

  const updateAiSource = (value: string) => {
    setAiRaw(value);
    if (aiStage === "review") {
      setAiStage("input");
      setAiCandidates([]);
      setSelectedCandidateIds([]);
      setActiveCandidateId(null);
      setAiSkipped(0);
    }
    setAiError("");
  };

  const analyze = async () => {
    const content = aiRaw.trim();
    if (!content) {
      setAiError("请先选择 Markdown / TXT 文件，或把文档粘贴到左侧。 ");
      return;
    }
    const sourceCharCount = [...content].length;
    if (sourceCharCount > MAX_SOURCE_CHARS) {
      setAiError(`文档过长（${sourceCharCount.toLocaleString()} 字），当前最多支持 ${MAX_SOURCE_CHARS.toLocaleString()} 字。`);
      return;
    }
    if (!aiReady) {
      setAiError(configError ? `AI 配置读取失败：${configError}` : "AI 尚未配置，请先到“设置 → AI”填写并保存 API Key。" );
      return;
    }
    setAiBusy(true);
    setAiError("");
    setAiCandidates([]);
    setSelectedCandidateIds([]);
    setActiveCandidateId(null);
    setAiSkipped(0);
    setAiJob(null);
    setAiModel("");
    try {
      const result = await api.createKnowledgeAnalyzeJob({
        content,
        source_name: fileName || "粘贴的文档",
        max_cards: 100,
      });
      storeJobId(result.job_id);
      setAiJobId(result.job_id);
      setAiStage("progress");
    } catch (error) {
      setAiError(api.getErrorMessage(error));
    } finally {
      setAiBusy(false);
    }
  };

  const retryFailedChunks = async () => {
    if (!aiJobId || retryingChunks) return;
    setRetryingChunks(true);
    setAiError("");
    try {
      const job = await api.retryKnowledgeAnalyzeJob(aiJobId);
      syncJobSnapshot(job);
      setJobPollNonce((current) => current + 1);
    } catch (error) {
      setAiError(api.getErrorMessage(error));
    } finally {
      setRetryingChunks(false);
    }
  };

  const stopAnalyze = async () => {
    if (!aiJobId || cancellingJob) return;
    setCancellingJob(true);
    try {
      const job = await api.cancelKnowledgeAnalyzeJob(aiJobId);
      syncJobSnapshot(job);
    } catch (error) {
      setAiError(api.getErrorMessage(error));
    } finally {
      setCancellingJob(false);
    }
  };

  const returnToInput = () => {
    const currentJob = aiJob;
    if (aiJobId && currentJob && !isTerminalJobStatus(currentJob.status)) {
      void api.cancelKnowledgeAnalyzeJob(aiJobId).catch(() => undefined);
    }
    clearStoredJobId();
    setAiJobId(null);
    setAiJob(null);
    setAiStage("input");
    setAiCandidates([]);
    setSelectedCandidateIds([]);
    setActiveCandidateId(null);
    setAiSkipped(0);
    setAiModel("");
    setAiError("");
  };

  const updateCandidate = (id: string, patch: Partial<Candidate>) => {
    setAiCandidates((current) => current.map((candidate) => candidate.id === id ? { ...candidate, ...patch } : candidate));
  };

  const toggleCandidate = (id: string) => {
    setSelectedCandidateIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const selectAllCandidates = () => {
    setSelectedCandidateIds((current) => current.length === aiCandidates.length ? [] : aiCandidates.map((candidate) => candidate.id));
  };

  const importCards = async () => {
    const sourceCards = mode === "ai"
      ? aiCandidates.filter((candidate) => selectedCandidateIds.includes(candidate.id))
      : manualValidRows.flatMap((row) => row.card ? [row.card] : []);
    if (!sourceCards.length || saving) return;
    const cards = sourceCards.map((card) => withDefaultSpace({
      card_type: card.card_type,
      title: card.title,
      content: card.content,
      tags: card.tags,
      projects: card.projects,
      source_article_id: card.source_article_id,
      source_review_id: card.source_review_id,
      source_date: card.source_date,
      source_excerpt: card.source_excerpt,
    }, defaultSpace));
    setSaving(true);
    try {
      const result = await api.importKnowledgeCards(cards);
      await onImported?.(result);
      clearStoredJobId();
      toast.success(
        result.skipped > 0
          ? `已导入 ${result.imported} 张草稿，跳过 ${result.skipped} 张重复卡片。`
          : `已导入 ${result.imported} 张草稿。`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(api.getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const formatLabel = manualFormat === "json" ? "JSON" : manualFormat === "markdown" ? "卡片 Markdown" : "单张文本";
  const importCount = mode === "ai" ? aiSelectedCount : manualValidRows.length;
  const editorTheme = typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-[80] backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="ui-modal-surface fixed inset-x-3 bottom-3 z-[81] flex max-h-[min(94dvh,900px)] w-auto flex-col overflow-hidden p-4 outline-hidden data-[state=open]:animate-slide-up sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[min(1120px,calc(100%-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:animate-fade-in sm:p-5">
          <header className="flex shrink-0 items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="ui-status-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                {mode === "ai" ? <Sparkles size={18} /> : <Upload size={18} />}
              </span>
              <div className="min-w-0">
                <Dialog.Title className="text-[15px] font-semibold leading-6 text-[var(--ui-text)]">导入知识卡片</Dialog.Title>
                <Dialog.Description className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--ui-text-muted)]">
                  把一份文档变成可核对的知识卡片草稿，确认后才会进入正式复习。
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="ui-icon-button h-9 w-9" aria-label="关闭导入卡片">
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>

          <div className="mt-4 shrink-0">
            <Tabs value={mode} onValueChange={switchMode}>
              <TabsList className="grid w-full max-w-[460px] grid-cols-2">
                <TabsTrigger value="ai" className="gap-1.5 text-xs">
                  <Sparkles size={14} /> AI 导入 <span className="ui-chip h-5 px-1.5 text-[10px]">推荐</span>
                </TabsTrigger>
                <TabsTrigger value="manual" className="gap-1.5 text-xs">
                  <Clipboard size={14} /> 手动导入
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-0.5">
            {mode === "ai" ? (
              aiStage === "input" ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.18fr)_minmax(270px,0.82fr)]">
                  <section className="ui-editor-surface flex min-h-[420px] min-w-0 flex-col overflow-hidden">
                    <div className="ui-soft-divider flex shrink-0 items-start justify-between gap-3 border-b px-3.5 py-3">
                      <div className="min-w-0">
                        <h2 className="flex items-center gap-2 text-xs font-semibold text-[var(--ui-text)]"><FileText size={14} className="text-[var(--ui-accent-text)]" /> 文档内容</h2>
                        <p className="mt-1 text-[11px] leading-4 text-[var(--ui-text-subtle)]">支持 Markdown、TXT；长文档会按章节和段落自动分批分析。</p>
                      </div>
                      <label className="ui-button-secondary h-8 shrink-0 cursor-pointer gap-1.5 px-2.5 text-[11px]">
                        <Upload size={13} /> 选择文件
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".md,.markdown,.txt,text/markdown,text/plain"
                          className="sr-only"
                          onChange={(event) => {
                            void loadFile(event.target.files?.[0]);
                            event.currentTarget.value = "";
                          }}
                          aria-label="选择 Markdown 或 TXT 文档"
                        />
                      </label>
                    </div>
                    <div className="min-h-[300px] flex-1 overflow-auto" aria-label="待分析的文档内容">
                      <CodeMirror
                        value={aiRaw}
                        onChange={updateAiSource}
                        extensions={[markdown(), EditorView.lineWrapping]}
                        placeholder={'# 我的学习笔记\n\n把 Markdown 或普通文字放在这里，AI 会按章节提炼可复习的知识点。'}
                        theme={editorTheme}
                        minHeight="300px"
                        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                        aria-label="待分析的文档内容"
                      />
                    </div>
                    <div className="ui-soft-divider flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3.5 py-2.5 text-[11px]">
                      <span className="flex min-w-0 items-center gap-1.5 text-[var(--ui-text-subtle)]">
                        {fileName ? <><FileText size={12} /> <span className="max-w-[220px] truncate">{fileName}</span></> : "尚未选择文件"}
                      </span>
                      <span className={aiRaw.length > MAX_SOURCE_CHARS ? "font-medium text-[var(--ui-danger-text)]" : "text-[var(--ui-text-subtle)]"}>{formatCharCount(aiRaw)}</span>
                    </div>
                  </section>

                  <aside className="flex min-w-0 flex-col gap-3">
                    <section className="ui-panel-muted p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ui-text)]"><Bot size={15} className="text-[var(--ui-accent-text)]" /> AI 会帮你完成</div>
                      <div className="mt-3 space-y-3 text-xs leading-5 text-[var(--ui-text-muted)]">
                        <div className="flex items-start gap-2"><span className="ui-status-accent flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px]">1</span><span>识别章节和段落，过滤没有依据的流水账。</span></div>
                        <div className="flex items-start gap-2"><span className="ui-status-accent flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px]">2</span><span>提炼事实、概念、方法和原则，并保留原文依据。</span></div>
                        <div className="flex items-start gap-2"><span className="ui-status-accent flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px]">3</span><span>生成草稿预览，由你决定哪些卡片真正入库。</span></div>
                      </div>
                    </section>

                    <section className={aiConfigFailed ? "ui-status-danger rounded-xl p-3.5" : aiReady ? "ui-status-success rounded-xl p-3.5" : "ui-status-warning rounded-xl p-3.5"}>
                      <div className="flex items-start gap-2.5">
                        {configLoading ? <LoaderCircle size={15} className="mt-0.5 shrink-0 animate-spin" /> : aiConfigFailed ? <AlertTriangle size={15} className="mt-0.5 shrink-0" /> : aiReady ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold">{configLoading ? "正在检查 AI 配置" : aiConfigFailed ? "无法读取 AI 配置" : aiReady ? "AI 已就绪" : "还没有配置 AI"}</div>
                          <p className="mt-1 text-[11px] leading-5">
                            {configLoading ? "正在读取服务端配置…" : aiConfigFailed ? configError : aiReady ? `${aiConfig?.model || "当前模型"} · API Key 保存在服务端` : "请先到“设置 → AI”填写兼容接口和 API Key。"}
                          </p>
                          {!configLoading && !aiReady && onOpenSettings && (
                            <button type="button" onClick={onOpenSettings} className="ui-button-ghost mt-1.5 h-7 min-h-7 px-0 text-[11px] font-semibold">去设置 AI <span aria-hidden="true">→</span></button>
                          )}
                        </div>
                      </div>
                    </section>

                    <ImportSpaceField spaces={spaces} value={defaultSpace} onChange={setDefaultSpace} />

                    <div className="mt-auto flex items-start gap-2 px-1 text-[11px] leading-5 text-[var(--ui-text-subtle)]">
                      <ShieldCheck size={13} className="mt-0.5 shrink-0 text-[var(--ui-accent-text)]" />
                      <span>AI 只生成待确认草稿，不会直接加入复习队列。文档会发送到你在 AI 设置中填写的服务。</span>
                    </div>
                  </aside>
                </div>
              ) : aiStage === "progress" ? (
                <AnalyzeProgressPanel
                  job={aiJob}
                  sourceName={fileName || aiJob?.source_name || "粘贴内容"}
                  retrying={retryingChunks}
                  cancelling={cancellingJob}
                  onRetry={() => void retryFailedChunks()}
                  onCancel={() => void stopAnalyze()}
                  onBack={returnToInput}
                />
              ) : (
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--ui-text)]">
                        <span>分析结果</span>
                        <span className="ui-status-accent rounded-md px-1.5 py-0.5">找到 {aiCandidates.length} 张</span>
                        {aiSkipped > 0 && <span className="ui-status-muted rounded-md px-1.5 py-0.5">跳过重复 {aiSkipped} 张</span>}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--ui-text-subtle)]">来源：{fileName || aiJob?.source_name || "粘贴内容"}{aiModel ? ` · 模型：${aiModel}` : ""} · {aiJob ? `已完成 ${aiJob.completed_chunks} / ${aiJob.total_chunks} 批` : "先核对依据"}，再批量导入草稿。</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {aiJob?.status === "completed_with_errors" && aiJob.failed_chunks > 0 && (
                        <button type="button" onClick={() => void retryFailedChunks()} disabled={retryingChunks} className="ui-button-secondary h-8 gap-1.5 px-2.5 text-[11px]">
                          {retryingChunks ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />} 重试失败 {aiJob.failed_chunks} 批
                        </button>
                      )}
                      <button type="button" onClick={returnToInput} className="ui-button-secondary h-8 gap-1.5 px-2.5 text-[11px]">
                      <FileText size={13} /> 返回修改文档
                      </button>
                    </div>
                  </div>

                  {aiError && <div className="ui-alert-bad mb-3 text-xs" role="alert">{aiError}</div>}

                  {aiCandidates.length > 0 ? (
                    <div className="grid min-h-[420px] gap-4 lg:grid-cols-[minmax(235px,0.64fr)_minmax(0,1.36fr)]">
                      <section className="ui-editor-surface flex min-h-0 min-w-0 flex-col overflow-hidden">
                        <div className="ui-soft-divider flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
                          <span className="text-xs font-semibold text-[var(--ui-text)]">候选卡片</span>
                          <button type="button" onClick={selectAllCandidates} className="ui-button-ghost h-7 min-h-7 px-1.5 text-[11px]">
                            {aiSelectedCount === aiCandidates.length ? "取消全选" : "全选"}
                          </button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
                          {aiCandidates.map((candidate, index) => {
                            const selected = selectedCandidateIds.includes(candidate.id);
                            const active = activeCandidate?.id === candidate.id;
                            return (
                              <div key={candidate.id} className={active ? "rounded-xl bg-[var(--ui-surface-selected)]" : "rounded-xl hover:bg-[var(--ui-surface-hover)]"}>
                                <div className="flex items-start gap-2 px-2.5 py-2.5">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => toggleCandidate(candidate.id)}
                                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--ui-accent-solid)]"
                                    aria-label={`选择第 ${index + 1} 张卡片`}
                                  />
                                  <button type="button" onClick={() => setActiveCandidateId(candidate.id)} className="min-w-0 flex-1 text-left">
                                    <span className="flex items-start gap-2">
                                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--ui-text)]">{candidate.title}</span>
                                      <span className="ui-chip h-5 shrink-0 px-1.5 text-[10px]">{cardTypeLabels[candidate.card_type]}</span>
                                    </span>
                                    <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">{candidate.content}</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>

                      <section className="ui-panel-muted min-w-0 p-3.5 sm:p-4">
                        {activeCandidate ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="ui-section-kicker flex items-center gap-1.5"><Sparkles size={12} /> 编辑候选卡片</div>
                              <span className="text-[11px] text-[var(--ui-text-subtle)]">{selectedCandidateIds.includes(activeCandidate.id) ? "将导入" : "已跳过"}</span>
                            </div>
                            <input
                              value={activeCandidate.title}
                              onChange={(event) => updateCandidate(activeCandidate.id, { title: event.target.value })}
                              className="ui-field h-10 text-sm font-semibold"
                              aria-label="候选卡片标题"
                            />
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
                              <label className="min-w-0">
                                <span className="ui-section-kicker mb-1.5 block">类型</span>
                                <Select
                                  value={activeCandidate.card_type}
                                  onValueChange={(value) => updateCandidate(activeCandidate.id, { card_type: value as api.KnowledgeCardType })}
                                >
                                  <SelectTrigger className="h-9 text-xs" aria-label="候选卡片类型"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {cardTypeOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </label>
                              <label className="min-w-0">
                                <span className="ui-section-kicker mb-1.5 block">标签</span>
                                <input
                                  value={(activeCandidate.tags || []).join(", ")}
                                  onChange={(event) => updateCandidate(activeCandidate.id, { tags: readList(event.target.value) })}
                                  className="ui-field h-9 text-xs"
                                  placeholder="例如：C++、资源管理"
                                  aria-label="候选卡片标签"
                                />
                              </label>
                            </div>
                            <label className="block">
                              <span className="ui-section-kicker mb-1.5 block">正文</span>
                              <textarea
                                value={activeCandidate.content}
                                onChange={(event) => updateCandidate(activeCandidate.id, { content: event.target.value })}
                                className="ui-textarea min-h-[132px] resize-y text-xs leading-5"
                                aria-label="候选卡片正文"
                              />
                            </label>
                            <label className="block">
                              <span className="ui-section-kicker mb-1.5 flex items-center gap-1.5"><CheckCircle2 size={12} className="text-[var(--ui-success-text)]" /> 原文依据</span>
                              <textarea
                                value={activeCandidate.source_excerpt || ""}
                                onChange={(event) => updateCandidate(activeCandidate.id, { source_excerpt: event.target.value })}
                                className="ui-textarea min-h-[92px] resize-y text-xs leading-5"
                                placeholder="AI 提取的原文片段；确认前建议保留。"
                                aria-label="候选卡片原文依据"
                              />
                            </label>
                            <label className="block">
                              <span className="ui-section-kicker mb-1.5 flex items-center gap-1.5"><FolderOpen size={12} /> 空间</span>
                              <input
                                value={(activeCandidate.projects || []).join(", ")}
                                onChange={(event) => updateCandidate(activeCandidate.id, { projects: readList(event.target.value) })}
                                className="ui-field h-9 text-xs"
                                placeholder="可选，多个空间用逗号分隔"
                                aria-label="候选卡片空间"
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="flex min-h-[360px] items-center justify-center text-center text-xs leading-5 text-[var(--ui-text-subtle)]">选择左侧卡片查看和编辑。</div>
                        )}
                      </section>
                    </div>
                  ) : (
                    <div className="ui-panel-muted flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
                      <span className="ui-status-muted flex h-11 w-11 items-center justify-center rounded-xl"><Sparkles size={20} /></span>
                      <p className="mt-3 text-sm font-medium text-[var(--ui-text)]">这份文档没有生成候选卡片</p>
                      <p className="mt-1 max-w-md text-xs leading-5 text-[var(--ui-text-muted)]">可以返回补充上下文，或者切换到手动导入，自己整理成卡片格式。</p>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <Tabs value={manualFormat} onValueChange={(value) => setManualFormat(value as ManualFormat)}>
                    <TabsList aria-label="手动导入格式">
                      <TabsTrigger value="json" className="h-8 px-2.5 text-[11px]">JSON</TabsTrigger>
                      <TabsTrigger value="markdown" className="h-8 px-2.5 text-[11px]">卡片 Markdown</TabsTrigger>
                      <TabsTrigger value="text" className="h-8 px-2.5 text-[11px]">单张文本</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <div className="flex items-center gap-1.5">
                    {manualFormat === "json" && (
                      <button type="button" onClick={() => void copyPrompt()} className="ui-button-ghost h-8 min-h-8 gap-1.5 px-2 text-[11px]"><Copy size={13} /> 复制 JSON 格式</button>
                    )}
                    <label className="ui-button-secondary h-8 cursor-pointer gap-1.5 px-2.5 text-[11px]">
                      <Upload size={13} /> 选择文件
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
                        className="sr-only"
                        onChange={(event) => {
                          void loadFile(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                        aria-label="选择手动导入文件"
                      />
                    </label>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)]">
                  <section className="ui-editor-surface flex min-h-[420px] min-w-0 flex-col overflow-hidden">
                    <div className="ui-soft-divider flex shrink-0 items-start justify-between gap-3 border-b px-3.5 py-3">
                      <div className="min-w-0">
                        <h2 className="flex items-center gap-2 text-xs font-semibold text-[var(--ui-text)]"><Clipboard size={14} className="text-[var(--ui-accent-text)]" /> {formatLabel} 内容</h2>
                        <p className="mt-1 text-[11px] leading-4 text-[var(--ui-text-subtle)]">{manualFormat === "json" ? "粘贴 AI 输出的 JSON 数组或 cards 对象。" : manualFormat === "markdown" ? "每个“## 标题”代表一张卡片，标签和空间可写在正文末尾。" : "明确按一张卡片导入，不会自动猜测如何拆分。"}</p>
                      </div>
                      {fileName && <span className="max-w-[160px] truncate text-[11px] text-[var(--ui-text-subtle)]" title={fileName}>{fileName}</span>}
                    </div>
                    {manualFormat === "text" && (
                      <input
                        value={singleTitle}
                        onChange={(event) => setSingleTitle(event.target.value)}
                        placeholder="这张卡片的标题"
                        className="ui-field mx-3.5 mt-3 h-10 w-auto text-sm"
                        aria-label="单张文本卡片标题"
                      />
                    )}
                    {manualFormat === "json" ? (
                      <div className="min-h-[260px] flex-1 overflow-auto" aria-label="JSON 导入内容">
                        <CodeMirror
                          value={manualRaw}
                          onChange={setManualRaw}
                          extensions={[json(), EditorView.lineWrapping]}
                          placeholder={'{"cards":[{"card_type":"concept","title":"...","content":"..."}]}'}
                          theme={editorTheme}
                          minHeight="260px"
                          basicSetup={{ foldGutter: false, highlightActiveLine: true }}
                        />
                      </div>
                    ) : (
                      <textarea
                        value={manualRaw}
                        onChange={(event) => setManualRaw(event.target.value)}
                        placeholder={manualFormat === "markdown" ? "## 什么是复利？\n\n复利是本金和利息共同参与下一轮收益计算的增长方式。\n\n标签：金融, 基础\n空间：投资学习" : "把要沉淀的内容粘贴到这里…"}
                        className="min-h-[260px] flex-1 resize-none border-0 bg-transparent px-3.5 py-3 font-mono text-xs leading-5 text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-subtle)]"
                        spellCheck={false}
                        aria-label={`${formatLabel} 导入内容`}
                      />
                    )}
                    <div className="ui-soft-divider flex shrink-0 items-center justify-between gap-2 border-t px-3.5 py-2.5 text-[11px] text-[var(--ui-text-subtle)]">
                      <span>格式：{formatLabel}</span>
                      <span>{manualRaw.length.toLocaleString()} 字</span>
                    </div>
                  </section>

                  <section className="ui-panel-muted min-w-0 p-3.5 sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-xs font-semibold text-[var(--ui-text)]">导入预览</h2>
                        <p className="mt-1 text-[11px] text-[var(--ui-text-subtle)]">{manualValidRows.length ? `可导入 ${manualValidRows.length} 张` : "输入内容后显示校验结果"}{manualInvalidRows.length ? ` · ${manualInvalidRows.length} 张有问题` : ""}</p>
                      </div>
                      {manualValidRows.length > 0 && <span className="ui-status-success rounded-md px-1.5 py-0.5 text-[11px]">可用</span>}
                    </div>
                    {manualParsed.error && <div className="ui-alert-bad mt-3 text-[11px] leading-5" role="alert">{manualParsed.error}</div>}
                    <div className="mt-3">
                      {manualParsed.rows.length > 0 ? <PreviewRows rows={manualParsed.rows} /> : <div className="ui-editor-surface flex min-h-[260px] items-center justify-center px-5 text-center text-xs leading-5 text-[var(--ui-text-subtle)]">预览会显示每张卡片的标题、类型和校验状态。</div>}
                    </div>
                    {manualFormat === "markdown" && (
                      <div className="ui-status-info mt-3 flex items-start gap-2 p-2.5 text-[11px] leading-5">
                        <FileText size={13} className="mt-0.5 shrink-0" />
                        <span>使用二级标题分隔卡片；“标签：”“空间：”“来源：”会自动识别为元数据。</span>
                      </div>
                    )}
                  </section>
                </div>

                <div className="mt-4">
                  <ImportSpaceField spaces={spaces} value={defaultSpace} onChange={setDefaultSpace} />
                </div>
              </div>
            )}

          </div>

          <footer className="ui-soft-divider mt-4 flex shrink-0 flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">
              {mode === "ai" && aiStage === "input" ? <><Sparkles size={12} className="text-[var(--ui-accent-text)]" /> 长文档会按章节和段落自动分批分析，导入前可逐张编辑。</> : mode === "ai" && aiStage === "progress" ? <><Layers3 size={12} className="text-[var(--ui-accent-text)]" /> 分析任务会在后台继续运行，关闭窗口后可重新打开查看。</> : <><Check size={12} className="text-[var(--ui-success-text)]" /> 导入后不会直接进入复习队列。</>}
            </p>
            <div className="flex gap-2 sm:justify-end">
              <Dialog.Close asChild>
                <button type="button" className="ui-button-secondary h-10 flex-1 px-4 text-xs sm:flex-none">{mode === "ai" && aiStage === "progress" ? "放到后台" : "取消"}</button>
              </Dialog.Close>
              {mode === "ai" && aiStage === "input" ? (
                <button type="button" onClick={() => void analyze()} disabled={aiBusy || configLoading || !aiRaw.trim() || aiRaw.length > MAX_SOURCE_CHARS || !aiReady} className="ui-button-primary h-10 flex-1 px-4 text-xs sm:flex-none">
                  {aiBusy ? <><LoaderCircle size={14} className="animate-spin" /> 分析中…</> : <><Sparkles size={14} /> 开始分析</>}
                </button>
              ) : mode === "manual" || aiStage === "review" ? (
                <button type="button" onClick={() => void importCards()} disabled={saving || !importCount} className="ui-button-primary h-10 flex-1 px-4 text-xs sm:flex-none">
                  {saving ? <><LoaderCircle size={14} className="animate-spin" /> 导入中…</> : <><Upload size={14} /> 导入 {importCount || ""} 张草稿</>}
                </button>
              ) : null}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AnalyzeProgressPanel({
  job,
  sourceName,
  retrying,
  cancelling,
  onRetry,
  onCancel,
  onBack,
}: {
  job: api.KnowledgeAnalyzeJob | null;
  sourceName: string;
  retrying: boolean;
  cancelling: boolean;
  onRetry: () => void;
  onCancel: () => void;
  onBack: () => void;
}) {
  const isWorking = !job || job.status === "queued" || job.status === "running";
  const progress = job?.progress_percent ?? 0;
  const statusLabel = !job
    ? "正在创建分析任务"
    : job.status === "queued"
      ? "等待开始"
      : job.status === "running"
        ? "正在分析"
        : job.status === "failed"
          ? "分析失败"
          : job.status === "cancelled"
            ? "已停止"
            : job.status === "completed_with_errors"
              ? "部分完成"
              : "分析完成";
  const statusClass = !job || job.status === "queued" || job.status === "running"
    ? "ui-status-accent"
    : job.status === "failed" || job.status === "cancelled"
      ? "ui-status-danger"
      : job.status === "completed_with_errors"
        ? "ui-status-warning"
        : "ui-status-success";

  return (
    <div className="space-y-3">
      <section className="ui-panel-muted p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--ui-text)]">
              <span className="ui-status-accent flex h-8 w-8 items-center justify-center rounded-lg">
                {isWorking ? <LoaderCircle size={16} className="animate-spin" /> : <Layers3 size={16} />}
              </span>
              <span>{isWorking ? "文档正在分批分析" : statusLabel}</span>
              <span className={`${statusClass} rounded-md px-1.5 py-0.5 text-[10px] font-medium`}>{progress}%</span>
            </div>
            <p className="mt-2 truncate text-[11px] text-[var(--ui-text-subtle)]" title={sourceName}>来源：{sourceName}</p>
          </div>
          {job && <span className="shrink-0 text-[11px] text-[var(--ui-text-subtle)]">{job.total_chars.toLocaleString()} 字 · 上限 {job.max_cards} 张</span>}
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--ui-surface-raised)]" aria-label={`分析进度 ${progress}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-full rounded-full bg-[var(--ui-accent-solid)] transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--ui-text-subtle)]">
          <span>{job?.active_chunk !== null && job?.active_chunk !== undefined ? `正在分析第 ${job.active_chunk + 1} 批 · 已完成 ${job.finished_chunks} / ${job.total_chunks} 批` : job ? `已完成 ${job.finished_chunks} / ${job.total_chunks} 批` : "正在准备分块…"}</span>
          <span>{job ? `已发现 ${job.cards.length} 张候选${job.skipped_cards ? ` · 跳过重复 ${job.skipped_cards} 张` : ""}` : "长文档会自动按章节和段落切分"}</span>
        </div>
      </section>

      {job?.error && (
        <div className={`${job.failed_chunks > 0 ? "ui-status-warning" : "ui-status-danger"} flex flex-wrap items-center justify-between gap-3 p-3 text-[11px] leading-5`} role="alert">
          <span>{job.error}</span>
          {job.failed_chunks > 0 && job.status !== "queued" && job.status !== "running" && (
            <button type="button" onClick={onRetry} disabled={retrying} className="ui-button-secondary h-8 shrink-0 gap-1.5 px-2.5 text-[11px]">
              {retrying ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />} 仅重试失败批次
            </button>
          )}
        </div>
      )}

      <section className="ui-editor-surface min-h-[360px] overflow-hidden">
        <div className="ui-soft-divider flex items-center justify-between gap-2 border-b px-3.5 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ui-text)]"><Layers3 size={14} className="text-[var(--ui-accent-text)]" /> 分批预览</div>
          <span className="text-[11px] text-[var(--ui-text-subtle)]">{job?.batches.length || 0} 批已返回</span>
        </div>
        {job?.batches.length ? (
          <div className="max-h-[360px] space-y-2 overflow-y-auto p-2.5 sm:p-3">
            {job.batches.map((batch) => (
              <article key={batch.index} className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ui-text)]">
                    <span>第 {batch.index + 1} 批</span>
                    <span className="ui-chip h-5 px-1.5 text-[10px]">{batch.cards.length} 张候选</span>
                  </div>
                  <span className="text-[10px] text-[var(--ui-text-subtle)]">原文 {batch.start_char.toLocaleString()}–{batch.end_char.toLocaleString()} 字</span>
                </div>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {batch.cards.slice(0, 6).map((card, index) => (
                    <div key={`${batch.index}-${index}`} className="min-w-0 rounded-lg bg-[var(--ui-surface-raised)] px-2.5 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11px] font-medium text-[var(--ui-text)]">{card.title}</span>
                        <span className="ui-chip h-5 shrink-0 px-1.5 text-[10px]">{cardTypeLabels[card.card_type]}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--ui-text-subtle)]">{card.content}</p>
                    </div>
                  ))}
                </div>
                {batch.cards.length > 6 && <p className="mt-2 text-[10px] text-[var(--ui-text-subtle)]">还有 {batch.cards.length - 6} 张，分析完成后可逐张编辑。</p>}
              </article>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
            <span className="ui-status-muted flex h-11 w-11 items-center justify-center rounded-xl">{isWorking ? <LoaderCircle size={20} className="animate-spin" /> : <AlertTriangle size={20} />}</span>
            <p className="mt-3 text-sm font-medium text-[var(--ui-text)]">{isWorking ? "正在等待第一批结果" : "暂时没有可预览的卡片"}</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-[var(--ui-text-muted)]">{isWorking ? "结果会按分块陆续出现，不需要等整份文档完成才看到反馈。" : "可以检查 AI 配置后重试失败批次，或返回手动导入。"}</p>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2">
        {isWorking && job && (
          <button type="button" onClick={onCancel} disabled={cancelling} className="ui-button-ghost h-8 gap-1.5 px-2.5 text-[11px]">
            {cancelling ? <LoaderCircle size={13} className="animate-spin" /> : <Square size={12} />} 停止分析
          </button>
        )}
        {!isWorking && <button type="button" onClick={onBack} className="ui-button-ghost h-8 px-2.5 text-[11px]">返回修改文档</button>}
      </div>
    </div>
  );
}

function ImportSpaceField({
  spaces,
  value,
  onChange,
}: {
  spaces: api.KnowledgeProject[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ui-panel-muted p-3.5">
      <label className="block">
        <span className="ui-section-kicker mb-1.5 flex items-center gap-1.5"><FolderOpen size={12} /> 默认空间 <span className="font-normal normal-case tracking-normal text-[var(--ui-text-subtle)]">可选</span></span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          list="knowledge-import-spaces"
          placeholder="例如：C++ 或投资学习"
          className="ui-field h-9 text-xs"
          aria-label="导入卡片的默认空间"
        />
      </label>
      <datalist id="knowledge-import-spaces">
        {spaces.map((space) => <option key={space.name} value={space.name} />)}
      </datalist>
      <p className="mt-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">只会补到没有该空间的卡片，不会覆盖 AI 或文件里的空间。</p>
    </div>
  );
}

function PreviewRows({ rows }: { rows: Array<{ index: number; card?: api.KnowledgeCardImportInput; error?: string }> }) {
  return (
    <div className="ui-editor-surface max-h-[310px] divide-y divide-[var(--ui-border)] overflow-y-auto">
      {rows.map((row) => (
        <div key={row.index} className="flex items-start gap-2.5 px-3 py-2.5">
          {row.card ? (
            <span className="ui-status-success mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"><Check size={12} /></span>
          ) : (
            <span className="ui-status-danger mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"><AlertTriangle size={12} /></span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-mono text-[10px] text-[var(--ui-text-subtle)]">#{row.index + 1}</span>
              <span className="truncate text-xs font-medium text-[var(--ui-text)]">{row.card?.title || "无法识别标题"}</span>
              {row.card && <span className="ui-chip h-5 shrink-0 px-1.5 text-[10px]">{cardTypeLabels[row.card.card_type]}</span>}
            </div>
            <p className={row.error ? "mt-1 text-[11px] leading-4 text-[var(--ui-danger-text)]" : "mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]"}>
              {row.error || row.card?.content}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
