import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { Command } from "cmdk";
import {
  ArrowLeft,
  BookMarked,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderCog,
  LayoutList,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Rows3,
  SlidersHorizontal,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import type { Page } from "../App";
import type { Article, KnowledgeCard, KnowledgeCardStatus, KnowledgeCardType } from "../lib/api";
import { cardStatusLabels as statusLabels, cardTypeLabels as typeLabels } from "../lib/cardLabels";
import { normalizeSpaceNames, normalizeTags } from "../lib/tags";
import MarkdownContent from "./MarkdownContent";
import ArticleDetail from "./ArticleDetail";
import ReviewSourceDetail from "./ReviewSourceDetail";
import ReviewItemsPanel from "./ReviewItemsPanel";
import KnowledgeImportDialog from "./KnowledgeImportDialog";
import SpaceManagerDialog from "./SpaceManagerDialog";
import SpaceAutocomplete from "./ui/space-autocomplete";
import { useConfirmDialog } from "./ui/Feedback";
import { refreshKnowledgeMetadata as refreshKnowledgeMetadataQuery } from "../lib/knowledgeMetadata";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import PageHeader, { PageHeaderActions } from "./ui/PageHeader";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { connectionReturnStorageKey, readLocalStorage, writeLocalStorage, writeSessionStorage } from "../lib/storage";

const typeOptions = Object.entries(typeLabels) as Array<[KnowledgeCardType, string]>;
const statusOptions = Object.entries(statusLabels) as Array<[KnowledgeCardStatus, string]>;
const statusFilterOptions: Array<[KnowledgeStatusFilter, string]> = [["all", "全部"], ...statusOptions];
const knowledgeQueryStaleTime = 30_000;
const knowledgePageSize = 24;
const workflowHelpDismissedKey = "knowledge-workflow-help-dismissed";
const sortOptions: Array<[KnowledgeSort, string]> = [
  ["updated", "最近更新"],
  ["created", "最近创建"],
  ["usage", "使用最多"],
  ["review", "优先复习"],
];
const qualityOptions: Array<[api.KnowledgeCardQuality, string, string]> = [
  ["missing_source", "缺少来源", "需要补回原文日期或证据片段"],
  ["missing_project", "未归入空间", "还没有主题或项目归属"],
  ["missing_tags", "缺少标签", "还没有可检索标签"],
  ["short_content", "内容过短", "正文少于 24 个字符"],
];

const emptyDraft = {
  card_type: "fact" as KnowledgeCardType,
  status: "draft" as KnowledgeCardStatus,
  title: "",
  content: "",
  tagsText: "",
  projectsText: "",
  source_date: "",
  source_article_id: "",
  source_review_id: "",
  source_excerpt: "",
};

type DraftState = typeof emptyDraft;
type SaveState = "idle" | "saving" | "saved" | "error";
type NoticeTone = "neutral" | "good" | "bad";
type KnowledgeValidationField = "title" | "content" | "source";
type KnowledgeValidationErrors = Partial<Record<KnowledgeValidationField, string>>;
type KnowledgeView = "list" | "detail";
type KnowledgeSort = "updated" | "created" | "usage" | "review";
type KnowledgeUsage = "" | "never_used";
type KnowledgeQuality = "" | api.KnowledgeCardQuality;
type KnowledgeStatusFilter = "all" | KnowledgeCardStatus;
type KnowledgeDensity = "comfortable" | "compact";
type KnowledgeBatchMode = "" | "tag" | "remove_tag" | "add_project" | "move_project" | "remove_project";

function toDraft(card: KnowledgeCard): DraftState {
  return {
    card_type: card.card_type,
    status: card.status,
    title: card.title,
    content: card.content,
    tagsText: card.tags.join(", "),
    projectsText: (card.projects || []).join(", "),
    source_date: card.source_date,
    source_article_id: card.source_article_id,
    source_review_id: card.source_review_id,
    source_excerpt: card.source_excerpt || "",
  };
}

function declaredRelatedIds(card: KnowledgeCard): string[] {
  return Array.isArray(card.declared_related_ids)
    ? card.declared_related_ids
    : card.related_ids || [];
}

function payloadFromDraft(draft: DraftState, relatedIds: string[] = []) {
  return {
    card_type: draft.card_type,
    status: draft.status,
    title: draft.title.trim(),
    content: draft.content.trim(),
    tags: normalizeTags(draft.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean)),
    projects: normalizeSpaceNames(draft.projectsText.split(",").map((project) => project.trim()).filter(Boolean)),
    source_date: draft.source_date.trim(),
    source_article_id: draft.source_article_id.trim(),
    source_review_id: draft.source_review_id.trim(),
    source_excerpt: draft.source_excerpt.trim(),
    related_ids: relatedIds,
  };
}

function compact(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function hasKnowledgeSource(value: { source_article_id?: string; source_review_id?: string; source_date?: string; source_excerpt?: string }) {
  return [value.source_article_id, value.source_review_id, value.source_date, value.source_excerpt]
    .some((item) => !!item?.trim());
}

function hasDraftInput(draft: DraftState) {
  return [
    draft.title,
    draft.content,
    draft.tagsText,
    draft.projectsText,
    draft.source_date,
    draft.source_article_id,
    draft.source_review_id,
    draft.source_excerpt,
  ].some((value) => value.trim());
}

function sortKnowledgeCards(items: KnowledgeCard[], sort: KnowledgeSort) {
  return [...items].sort((a, b) => {
    if (sort === "usage") return (b.usage_count || 0) - (a.usage_count || 0) || b.updated_at.localeCompare(a.updated_at);
    if (sort === "review") return (a.next_review_at || "9999-12-31").localeCompare(b.next_review_at || "9999-12-31") || b.updated_at.localeCompare(a.updated_at);
    if (sort === "created") return b.created_at.localeCompare(a.created_at);
    return b.updated_at.localeCompare(a.updated_at);
  });
}

function mergeProjectCounts(current: api.KnowledgeProject[], incoming: api.KnowledgeProject[]) {
  const merged = [...current];
  for (const project of incoming) {
    const existing = merged.findIndex((item) => item.name.toLocaleLowerCase() === project.name.toLocaleLowerCase());
    if (existing >= 0) merged[existing] = project;
    else merged.push(project);
  }
  return merged.sort((a, b) => (b.total_count ?? b.count) - (a.total_count ?? a.count) || a.name.localeCompare(b.name));
}

function listSignature(values: string[] | undefined, normalize = normalizeTags) {
  return normalize(values || [])
    .map((value) => value.toLocaleLowerCase())
    .sort()
    .join("\u001f");
}

export default function KnowledgePage({
  onEditDate,
  onNavigate,
  initialCardId,
  initialNonce,
  initialQuery,
  initialProject,
  initialTag,
  initialStatus,
  initialType,
  initialSort,
  initialUsage,
  initialQuality,
  initialView,
  initialPage,
  onSearchParamsChange,
  onOpenCard,
  onNewCard,
  onBackToList,
  dark,
  onWikiLink,
}: {
  onEditDate: (date: string) => void;
  onNavigate: (page: Page) => void;
  initialCardId?: string;
  initialNonce?: number;
  initialQuery?: string;
  initialProject?: string;
  initialTag?: string;
  initialStatus?: KnowledgeStatusFilter;
  initialType?: KnowledgeCardType;
  initialSort?: KnowledgeSort;
  initialUsage?: KnowledgeUsage;
  initialQuality?: api.KnowledgeCardQuality;
  initialView?: KnowledgeView;
  initialPage?: number;
  onSearchParamsChange?: (patch: Record<string, unknown>) => void;
  onOpenCard?: (cardId: string) => void;
  onNewCard?: () => void;
  onBackToList?: () => void;
  dark?: boolean;
  onWikiLink?: (title: string) => void;
}) {
  const [listParent] = useAutoAnimate();
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [detailCard, setDetailCard] = useState<KnowledgeCard | null>(null);
  const [summary, setSummary] = useState<api.KnowledgeSummary>({ total: 0, draft: 0, confirmed: 0, outdated: 0, missing_source: 0, missing_project: 0, missing_tags: 0, short_content: 0 });
  const [relatedCards, setRelatedCards] = useState<KnowledgeCard[]>([]);
  const [relatedSearchCards, setRelatedSearchCards] = useState<KnowledgeCard[]>([]);
  const [duplicateCards, setDuplicateCards] = useState<KnowledgeCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(() => Math.max(1, initialPage || 1));
  const [totalCards, setTotalCards] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [activeStatus, setActiveStatus] = useState<KnowledgeStatusFilter>(initialStatus || "all");
  const [typeFilter, setTypeFilter] = useState(initialType || "");
  const [usageFilter, setUsageFilter] = useState<KnowledgeUsage>(initialUsage || "");
  const [qualityFilter, setQualityFilter] = useState<KnowledgeQuality>(initialQuality || "");
  const [sort, setSort] = useState<KnowledgeSort>(initialSort || "updated");
  const [tagFilter, setTagFilter] = useState(initialTag || "");
  const [tagCounts, setTagCounts] = useState<api.KnowledgeTagCount[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [projectFilter, setProjectFilter] = useState(initialProject || "");
  const [projectCounts, setProjectCounts] = useState<api.KnowledgeProject[]>([]);
  const [spaceArticles, setSpaceArticles] = useState<api.ArticleSummary[]>([]);
  const [spaceArticlesLoading, setSpaceArticlesLoading] = useState(false);
  const [spaceArticlesError, setSpaceArticlesError] = useState("");
  const [projectInput, setProjectInput] = useState("");
  const [spaceManagerOpen, setSpaceManagerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [batchMode, setBatchMode] = useState<KnowledgeBatchMode>("");
  const [batchValue, setBatchValue] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileBatchOpen, setMobileBatchOpen] = useState(false);
  const [density, setDensity] = useState<KnowledgeDensity>(() => {
    if (typeof window === "undefined") return "comfortable";
    return readLocalStorage("knowledge-density") === "compact" ? "compact" : "comfortable";
  });
  const [query, setQuery] = useState(initialQuery || "");
  const [mobileView, setMobileView] = useState<KnowledgeView>(initialView || (initialCardId ? "detail" : "list"));
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("neutral");
  const [fieldErrors, setFieldErrors] = useState<KnowledgeValidationErrors>({});
  const [sourceArticle, setSourceArticle] = useState<Article | null>(null);
  const [sourceReview, setSourceReview] = useState<api.Review | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [sourceDetailOpen, setSourceDetailOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [workflowHelpOpen, setWorkflowHelpOpen] = useState(() => readLocalStorage(workflowHelpDismissedKey) !== "1");
  const [draftRelatedIds, setDraftRelatedIds] = useState<string[]>([]);
  const [relatedQuery, setRelatedQuery] = useState("");
  const [reviewHistory, setReviewHistory] = useState<api.ReviewHistoryEntry[]>([]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const validationSummaryRef = useRef<HTMLDivElement>(null);
  const knowledgeEditorRef = useRef<EditorView | null>(null);
  const editorGenerationRef = useRef(0);
  const lastSavedSignature = useRef("");
  const touchedCardIds = useRef<Set<string>>(new Set());
  const routeQueryRef = useRef(initialQuery || "");
  const cardListRequestRef = useRef(0);
  const sourceRequestRef = useRef(0);
  const relatedSearchRequestRef = useRef(0);
  const duplicateSearchRequestRef = useRef(0);
  const { confirm, dialog } = useConfirmDialog();
  const queryClient = useQueryClient();
  const isNewRoute = initialView === "detail" && !initialCardId;
  const invalidateKnowledgeQueries = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.cardsRoot }),
    queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.summaryRoot }),
  ]);
  const invalidateKnowledgeMetadata = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.tags }),
    queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.projects }),
  ]);
  const refreshMetadata = async () => {
    const metadata = await refreshKnowledgeMetadataQuery(queryClient);
    setTagCounts(metadata.tags);
    setProjectCounts(mergeProjectCounts([], metadata.projects));
    return metadata;
  };
  const showNotice = (message: string, tone: NoticeTone = "neutral") => {
    setNotice(message);
    setNoticeTone(tone);
  };
  const dismissWorkflowHelp = () => {
    setWorkflowHelpOpen(false);
    writeLocalStorage(workflowHelpDismissedKey, "1");
  };
  const showWorkflowHelp = () => setWorkflowHelpOpen(true);

  const validationFieldLabels: Record<KnowledgeValidationField, string> = {
    title: "标题",
    content: "正文",
    source: "来源追溯",
  };
  const validationFieldIds: Record<KnowledgeValidationField, string> = {
    title: "knowledge-card-title",
    content: "knowledge-card-content",
    source: "knowledge-source-excerpt",
  };
  const validationErrorIds: Record<KnowledgeValidationField, string> = {
    title: "knowledge-card-title-error",
    content: "knowledge-card-content-error",
    source: "knowledge-source-error",
  };
  const validationEntries = (Object.entries(fieldErrors) as Array<[KnowledgeValidationField, string]>)
    .filter(([, message]) => !!message);

  const focusValidationField = (field: KnowledgeValidationField) => {
    const target = document.getElementById(validationFieldIds[field]);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    if (field === "content") {
      const editorContent = target.querySelector<HTMLElement>(".cm-content");
      editorContent?.focus();
      return;
    }
    (target as HTMLElement).focus();
  };

  const reportValidation = (errors: KnowledgeValidationErrors) => {
    setFieldErrors(errors);
    showNotice(`还有 ${Object.keys(errors).length} 项需要处理。`, "bad");
    window.setTimeout(() => validationSummaryRef.current?.focus(), 0);
  };

  const clearValidationFields = (...fields: KnowledgeValidationField[]) => {
    if (!fields.length) return;
    setFieldErrors((current) => {
      const next = { ...current };
      fields.forEach((field) => { delete next[field]; });
      return next;
    });
  };

  const syncEditorAccessibility = () => {
    const editorContent = knowledgeEditorRef.current?.contentDOM;
    if (!editorContent) return;
    editorContent.setAttribute("aria-label", "知识卡片正文");
    editorContent.setAttribute("aria-required", "true");
    editorContent.setAttribute("aria-describedby", ["knowledge-card-content-help", fieldErrors.content ? validationErrorIds.content : ""].filter(Boolean).join(" "));
    if (fieldErrors.content) editorContent.setAttribute("aria-invalid", "true");
    else editorContent.removeAttribute("aria-invalid");
  };

  useEffect(() => {
    syncEditorAccessibility();
  }, [fieldErrors.content]);

  const changeDensity = (next: KnowledgeDensity) => {
    setDensity(next);
    try {
      if (typeof window !== "undefined") writeLocalStorage("knowledge-density", next);
    } catch {
      // 仅影响显示偏好，不应阻断编辑或保存。
    }
  };

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const nextProject = initialProject || "";
    if (nextProject !== projectFilter) setProjectFilter(nextProject);
  }, [initialProject, projectFilter]);

  useEffect(() => {
    const nextTag = initialTag || "";
    if (nextTag !== tagFilter) setTagFilter(nextTag);
  }, [initialTag, tagFilter]);

  useEffect(() => {
    const nextStatus = initialStatus || "all";
    if (nextStatus !== activeStatus) setActiveStatus(nextStatus);
  }, [activeStatus, initialStatus]);

  useEffect(() => {
    const nextType = initialType || "";
    if (nextType !== typeFilter) setTypeFilter(nextType);
  }, [initialType, typeFilter]);

  useEffect(() => {
    const nextSort = initialSort || "updated";
    if (nextSort !== sort) setSort(nextSort);
  }, [initialSort, sort]);

  useEffect(() => {
    const nextUsage = initialUsage || "";
    if (nextUsage !== usageFilter) setUsageFilter(nextUsage);
  }, [initialUsage, usageFilter]);

  useEffect(() => {
    const nextQuality = initialQuality || "";
    if (nextQuality !== qualityFilter) setQualityFilter(nextQuality);
  }, [initialQuality, qualityFilter]);

  useEffect(() => {
    if (initialType || initialUsage || initialQuality || initialTag || initialProject || (initialStatus && initialStatus !== "all")) {
      setShowFilters(true);
    }
  }, [initialProject, initialQuality, initialStatus, initialTag, initialType, initialUsage]);

  useEffect(() => {
    if (initialView && initialView !== mobileView) setMobileView(initialView);
  }, [initialView, mobileView]);

  useEffect(() => {
    const nextPage = Math.max(1, initialPage || 1);
    setPage((current) => current === nextPage ? current : nextPage);
  }, [initialPage]);

  const sortedCards = useMemo(() => sortKnowledgeCards(cards, sort), [cards, sort]);
  const selectedCard = useMemo(() => cards.find((card) => card.id === selectedId) || (detailCard?.id === selectedId ? detailCard : null), [cards, detailCard, selectedId]);
  const selectedSpace = useMemo(
    () => projectCounts.find((space) => space.name.toLocaleLowerCase() === projectFilter.toLocaleLowerCase()),
    [projectCounts, projectFilter]
  );
  const counts = summary;

  const duplicateHint = useMemo(() => {
    const title = compact(draft.title);
    const content = compact(draft.content);
    if (!title && content.length < 20) return "";
    const duplicate = duplicateCards.find((card) => {
      if (card.id === selectedId) return false;
      return (!!title && compact(card.title) === title) || (!!content && compact(card.content) === content);
    });
    return duplicate ? `可能与「${duplicate.title}」重复。` : "";
  }, [duplicateCards, draft.content, draft.title, selectedId]);

  const changeStatus = (status: KnowledgeStatusFilter) => {
    setActiveStatus(status);
    setPage(1);
    onSearchParamsChange?.({ status, page: undefined });
  };

  const changeType = (type: string) => {
    setTypeFilter(type);
    setPage(1);
    onSearchParamsChange?.({ type: type || undefined, page: undefined });
  };

  const changeProject = (project: string) => {
    setProjectFilter(project);
    setPage(1);
    onSearchParamsChange?.({ project: project || undefined, page: undefined });
  };

  const changeTag = (tag: string) => {
    setTagFilter(tag);
    setPage(1);
    onSearchParamsChange?.({ tag: tag || undefined, page: undefined });
  };

  const changeSort = (value: string) => {
    const next = sortOptions.some(([option]) => option === value) ? value as KnowledgeSort : "updated";
    setSort(next);
    setPage(1);
    onSearchParamsChange?.({ sort: next === "updated" ? undefined : next, page: undefined });
  };

  const changeUsage = (value: KnowledgeUsage) => {
    setUsageFilter(value);
    setPage(1);
    onSearchParamsChange?.({ usage: value || undefined, page: undefined });
  };

  const changeQuality = (value: KnowledgeQuality) => {
    setQualityFilter(value);
    setPage(1);
    onSearchParamsChange?.({ quality: value || undefined, page: undefined });
  };

  const searchCards = () => {
    const nextQuery = query.trim();
    routeQueryRef.current = nextQuery;
    setPage(1);
    onSearchParamsChange?.({ q: nextQuery || undefined, page: undefined });
    void loadCards(false, true, nextQuery, undefined, 1);
  };

  const resetFilters = () => {
    routeQueryRef.current = "";
    setQuery("");
    setActiveStatus("all");
    setTypeFilter("");
    setUsageFilter("");
    setQualityFilter("");
    setTagFilter("");
    setProjectFilter("");
    setSort("updated");
    setPage(1);
    onSearchParamsChange?.({
      q: undefined,
      status: "all",
      type: undefined,
      usage: undefined,
      quality: undefined,
      tag: undefined,
      project: undefined,
      sort: undefined,
      page: undefined,
    });
    void loadCards(false, true, "", {
      cardType: "",
      status: "all",
      usage: "",
      quality: "",
      tag: "",
      project: "",
      sort: "updated",
    }, 1);
  };

  useEffect(() => {
    if (!projectFilter.trim()) {
      setSpaceArticles([]);
      setSpaceArticlesError("");
      setSpaceArticlesLoading(false);
      return;
    }
    let cancelled = false;
    setSpaceArticlesLoading(true);
    setSpaceArticlesError("");
    api.listSpaceArticles(projectFilter, 1, 6)
      .then((articles) => { if (!cancelled) setSpaceArticles(articles); })
      .catch((e) => { if (!cancelled) { setSpaceArticles([]); setSpaceArticlesError(api.getErrorMessage(e)); } })
      .finally(() => { if (!cancelled) setSpaceArticlesLoading(false); });
    return () => { cancelled = true; };
  }, [projectFilter]);

  const saveDirtyDraft = async (): Promise<boolean> => {
    if (!dirty || !selectedId) return true;
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = undefined;
    }
    const saveGeneration = editorGenerationRef.current;
    const pending = payloadFromDraft(draft, draftRelatedIds);
    const pendingErrors: KnowledgeValidationErrors = {};
    if (!pending.title) pendingErrors.title = "请输入标题，用一句话说明这条知识。";
    if (!pending.content) pendingErrors.content = "请输入正文，先写清可复习的结论。";
    if (Object.keys(pendingErrors).length > 0) {
      reportValidation(pendingErrors);
      throw new Error("请先补全当前卡片的标题和内容。");
    }
    const currentCard = selectedCard?.id === selectedId
      ? selectedCard
      : detailCard?.id === selectedId ? detailCard : null;
    const relationshipsChanged = listSignature(currentCard?.tags) !== listSignature(pending.tags)
      || listSignature(currentCard?.projects, normalizeSpaceNames) !== listSignature(pending.projects, normalizeSpaceNames);
    const saved = await api.updateKnowledgeCard(selectedId, pending);
    if (editorGenerationRef.current !== saveGeneration) return false;
    await invalidateKnowledgeQueries();
    if (editorGenerationRef.current !== saveGeneration) return false;
    if (relationshipsChanged) await refreshMetadata().catch(() => undefined);
    lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(saved), declaredRelatedIds(saved)));
    setCards((items) => items.map((item) => item.id === saved.id ? saved : item));
    setDetailCard(saved);
    setDirty(false);
    return true;
  };

  const retrySaveDraft = async () => {
    if (!dirty || !selectedId) return;
    setSaveState("saving");
    try {
      if (await saveDirtyDraft()) {
        setSaveState("saved");
        showNotice("已保存当前知识卡片。", "good");
      }
    } catch (e) {
      const message = api.getErrorMessage(e);
      setSaveState("error");
      showNotice(message, "bad");
    }
  };

  const loadCards = async (
    keepSelection = true,
    savePending = true,
    queryOverride?: string,
    filtersOverride?: {
      cardType?: string;
      status?: KnowledgeStatusFilter;
      usage?: KnowledgeUsage;
      tag?: string;
      project?: string;
      sort?: KnowledgeSort;
      quality?: KnowledgeQuality;
    },
    pageOverride?: number,
  ) => {
    // 切换筛选/状态前先落盘未保存的编辑，避免列表刷新时覆盖草稿。
    // related_ids 随编辑草稿一起保存，避免只调整关联卡片时刷新后丢失。
    if (savePending && dirty && selectedId) {
      try {
        if (!(await saveDirtyDraft())) {
          setSaveState("error");
          showNotice("保存期间内容发生变化，请先重试保存。", "bad");
          return;
        }
      } catch (e) {
        setSaveState("error");
        showNotice(api.getErrorMessage(e), "bad");
        return;
      }
    }
    setLoading(true);
    setError("");
    const requestId = ++cardListRequestRef.current;
    try {
      const cardType = filtersOverride?.cardType ?? typeFilter;
      const status = filtersOverride?.status ?? activeStatus;
      const statusParam = status === "all" ? undefined : status;
      const usage = filtersOverride?.usage ?? usageFilter;
      const tag = filtersOverride?.tag ?? tagFilter;
      const project = filtersOverride?.project ?? projectFilter;
      const cardSort = filtersOverride?.sort ?? sort;
      const quality = filtersOverride?.quality ?? qualityFilter;
      const search = (queryOverride ?? query).trim();
      const currentPage = Math.max(1, pageOverride ?? page);
      const filterKey = {
        cardType: cardType || "",
        status: status || "",
        usage: usage || "",
        tag: tag || "",
        project: project || "",
        q: search,
        sort: cardSort,
        quality: quality || "",
        page: String(currentPage),
        pageSize: String(knowledgePageSize),
      };
      const [pageResult, summaryResult] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: api.knowledgeQueryKeys.cards(filterKey),
          queryFn: ({ signal }) => api.queryKnowledgeCards({
            card_type: cardType,
            status: statusParam,
            q: search,
            usage: usage || undefined,
            tag: tag || undefined,
            project: project || undefined,
            sort: cardSort,
            quality: quality || undefined,
            page: currentPage,
            page_size: knowledgePageSize,
          }, { signal }),
          staleTime: knowledgeQueryStaleTime,
        }),
        queryClient.fetchQuery({
          queryKey: api.knowledgeQueryKeys.summary(project),
          queryFn: ({ signal }) => api.getKnowledgeSummary(project, { signal }),
          staleTime: knowledgeQueryStaleTime,
        }).catch(() => null),
      ]);
      if (requestId !== cardListRequestRef.current) return;
      setCards(pageResult.cards);
      if (summaryResult) setSummary(summaryResult);
      setTotalCards(pageResult.total);
      setHasMore(pageResult.has_more);
      setPage(pageResult.page);
      setSelectedIds((ids) => ids.filter((id) => pageResult.cards.some((card) => card.id === id)));
      if (isNewRoute && !selectedId) {
        // 筛选/列表刷新不应清掉尚未创建的新卡片草稿（包括空间、来源和关联卡片）。
        setDraft((current) => hasDraftInput(current) ? current : { ...emptyDraft, status: "draft" });
        lastSavedSignature.current = "";
        return;
      }
      if ((keepSelection || initialCardId) && selectedId && pageResult.cards.some((card) => card.id === selectedId)) return;
      const next = pageResult.cards[0] || null;
      editorGenerationRef.current += 1;
      setSelectedId(next?.id || null);
      setDraft(next ? toDraft(next) : emptyDraft);
      setDraftRelatedIds(next ? declaredRelatedIds(next) : []);
      setDetailCard(next);
      setDirty(false);
      lastSavedSignature.current = next ? JSON.stringify(payloadFromDraft(toDraft(next), declaredRelatedIds(next))) : "";
    } catch (e) {
      if (requestId === cardListRequestRef.current) setError(api.getErrorMessage(e));
    } finally {
      if (requestId === cardListRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => { void loadCards(false); }, [activeStatus, qualityFilter, typeFilter, usageFilter, tagFilter, projectFilter, sort, page]);

  // 当前页稳定后预取下一页；用户点击下一页时通常可以直接从 Query cache 读取。
  useEffect(() => {
    if (!hasMore || loading) return;
    const nextPage = page + 1;
    const cardType = typeFilter || undefined;
    const status = activeStatus || undefined;
    const statusParam = status === "all" ? undefined : status;
    const usage = usageFilter || undefined;
    const tag = tagFilter || undefined;
    const project = projectFilter || undefined;
    const quality = qualityFilter || undefined;
    const search = query.trim();
    const filterKey = {
      cardType: cardType || "",
      status: status || "",
      usage: usage || "",
      tag: tag || "",
      project: project || "",
      q: search,
      sort,
      quality: quality || "",
      page: String(nextPage),
      pageSize: String(knowledgePageSize),
    };
    void queryClient.prefetchQuery({
      queryKey: api.knowledgeQueryKeys.cards(filterKey),
      queryFn: ({ signal }) => api.queryKnowledgeCards({
        card_type: cardType,
        status: statusParam,
        q: search,
        usage,
        tag,
        project,
        quality,
        sort,
        page: nextPage,
        page_size: knowledgePageSize,
      }, { signal }),
      staleTime: knowledgeQueryStaleTime,
    }).catch(() => { /* 预取失败不影响当前页，点击后仍会正常请求 */ });
  }, [activeStatus, hasMore, loading, page, projectFilter, qualityFilter, query, queryClient, sort, tagFilter, typeFilter, usageFilter]);

  // 浏览器后退/前进只改变 URL 查询参数时，也要重新加载对应结果；手动搜索已在 searchCards 中即时加载。
  useEffect(() => {
    const nextQuery = initialQuery || "";
    if (routeQueryRef.current === nextQuery) return;
    routeQueryRef.current = nextQuery;
    setQuery(nextQuery);
    setPage(1);
    void loadCards(false, true, nextQuery, undefined, 1);
  }, [initialQuery]);

  useEffect(() => {
    let cancelled = false;
    queryClient.fetchQuery({
      queryKey: api.knowledgeQueryKeys.tags,
      queryFn: ({ signal }) => api.listKnowledgeTags({ signal }),
      staleTime: 60_000,
    })
      .then((tags) => { if (!cancelled) setTagCounts(tags); })
      .catch(() => { if (!cancelled) setTagCounts([]); });
    return () => { cancelled = true; };
  }, [queryClient]);

  const loadSourceDetail = async (): Promise<boolean> => {
    const sourceArticleId = (draft.source_article_id || selectedCard?.source_article_id || "").trim();
    const sourceReviewId = (draft.source_review_id || selectedCard?.source_review_id || "").trim();
    const sourceDate = (draft.source_date || selectedCard?.source_date || "").trim();
    const requestId = ++sourceRequestRef.current;
    setSourceLoading(true);
    setSourceError("");
    setSourceArticle(null);
    setSourceReview(null);
    try {
      if (sourceArticleId) {
        const article = await api.getArticle(sourceArticleId);
        if (requestId !== sourceRequestRef.current) return false;
        setSourceArticle(article);
        return true;
      }
      if (sourceReviewId) {
        const review = await api.getReview(sourceReviewId);
        if (requestId !== sourceRequestRef.current) return false;
        setSourceReview(review);
        return true;
      }
      if (sourceDate) {
        const article = await api.getTodayArticle(sourceDate);
        if (!article) throw new Error(`找不到 ${sourceDate} 的每日记录`);
        if (requestId !== sourceRequestRef.current) return false;
        setSourceArticle(article);
        return true;
      }
      throw new Error("当前卡片没有可定位的来源");
    } catch (loadError) {
      if (requestId !== sourceRequestRef.current) return false;
      setSourceArticle(null);
      setSourceReview(null);
      setSourceError(api.getErrorMessage(loadError));
      return false;
    } finally {
      if (requestId === sourceRequestRef.current) setSourceLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    queryClient.fetchQuery({
      queryKey: api.knowledgeQueryKeys.projects,
      queryFn: ({ signal }) => api.listSpaces({ signal }),
      staleTime: 60_000,
    })
      .then((projects) => { if (!cancelled) setProjectCounts((current) => mergeProjectCounts(current, projects)); })
      .catch(() => { if (!cancelled) setProjectCounts([]); });
    return () => { cancelled = true; };
  }, [queryClient]);

  useEffect(() => {
    if (!selectedCard?.source_article_id) {
      sourceRequestRef.current += 1;
      setSourceArticle(null);
      setSourceReview(null);
      setSourceError("");
      setSourceLoading(false);
      return;
    }
    let cancelled = false;
    const requestId = ++sourceRequestRef.current;
    setSourceArticle(null);
    setSourceReview(null);
    setSourceError("");
    setSourceLoading(true);
    api.getArticle(selectedCard.source_article_id)
      .then((article) => { if (!cancelled && requestId === sourceRequestRef.current) setSourceArticle(article); })
      .catch((error) => { if (!cancelled && requestId === sourceRequestRef.current) { setSourceArticle(null); setSourceReview(null); setSourceError(api.getErrorMessage(error)); } })
      .finally(() => { if (!cancelled && requestId === sourceRequestRef.current) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCard?.source_article_id]);

  const retrySourceLoad = () => {
    void loadSourceDetail();
  };

  useEffect(() => {
    if (!selectedId || !dirty) return;
    const payload = payloadFromDraft(draft, draftRelatedIds);
    if (!payload.title || !payload.content) return;
    const signature = JSON.stringify(payload);
    if (signature === lastSavedSignature.current) return;
    const saveGeneration = editorGenerationRef.current;
    const saveId = selectedId;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        const saved = await api.updateKnowledgeCard(selectedId, payload);
        if (editorGenerationRef.current !== saveGeneration || selectedId !== saveId) return;
        await invalidateKnowledgeQueries();
        if (editorGenerationRef.current !== saveGeneration || selectedId !== saveId) return;
        const currentCard = selectedCard?.id === selectedId
          ? selectedCard
          : detailCard?.id === selectedId ? detailCard : null;
        const relationshipsChanged = listSignature(currentCard?.tags) !== listSignature(payload.tags)
          || listSignature(currentCard?.projects, normalizeSpaceNames) !== listSignature(payload.projects, normalizeSpaceNames);
        if (relationshipsChanged) await refreshMetadata().catch(() => undefined);
        lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(saved), declaredRelatedIds(saved)));
        setCards((items) => items.map((item) => item.id === saved.id ? saved : item));
        setDetailCard(saved);
        setDirty(false);
        setSaveState("saved");
      } catch (e) {
        if (editorGenerationRef.current !== saveGeneration || selectedId !== saveId) return;
        setSaveState("error");
        showNotice(api.getErrorMessage(e), "bad");
      }
    }, 900);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [dirty, draft, draftRelatedIds, selectedId]);

  const updateDraft = (patch: Partial<DraftState>) => {
    editorGenerationRef.current += 1;
    setDraft((value) => ({ ...value, ...patch }));
    setDirty(true);
    const fieldsToClear: KnowledgeValidationField[] = [];
    if ("title" in patch) fieldsToClear.push("title");
    if ("content" in patch) fieldsToClear.push("content");
    if (["source_date", "source_article_id", "source_review_id", "source_excerpt"].some((field) => field in patch)) fieldsToClear.push("source");
    clearValidationFields(...fieldsToClear);
    setNotice("");
    setSaveState("idle");
  };

  const parsedTags = useMemo(
    () => normalizeTags(draft.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean)),
    [draft.tagsText]
  );

  const addTag = (raw?: string) => {
    const input = (raw ?? tagInput).trim().replace(/^#/, "");
    const parts = input.split(",").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...parsedTags];
    for (const part of parts) {
      const tag = normalizeTags([part])[0];
      if (tag && !next.includes(tag)) next.push(tag);
    }
    updateDraft({ tagsText: next.join(", ") });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    updateDraft({ tagsText: parsedTags.filter((item) => item !== tag).join(", ") });
  };

  const parsedProjects = useMemo(
    () => normalizeSpaceNames(draft.projectsText.split(",").map((project) => project.trim()).filter(Boolean)),
    [draft.projectsText]
  );

  const addProject = (raw?: string) => {
    const input = (raw ?? projectInput).trim();
    const parts = input.split(",").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...parsedProjects];
    for (const part of parts) {
      const project = normalizeSpaceNames([part])[0];
      if (project && !next.includes(project)) next.push(project);
    }
    updateDraft({ projectsText: next.join(", ") });
    setProjectInput("");
  };

  const removeProject = (project: string) => {
    updateDraft({ projectsText: parsedProjects.filter((item) => item !== project).join(", ") });
  };

  const openSpaceManager = () => {
    setSpaceManagerOpen(true);
  };

  const handleSpacesChanged = (
    spaces: api.KnowledgeProject[],
    change?: { previousName?: string; nextName?: string },
  ) => {
    const activeSpaces = spaces.filter((space) => space.status !== "archived");
    setProjectCounts(mergeProjectCounts([], activeSpaces));
    const currentName = projectFilter.trim().toLocaleLowerCase();
    if (change?.previousName && currentName === change.previousName.trim().toLocaleLowerCase()) {
      const nextName = change.nextName && activeSpaces.some((space) => space.name.toLocaleLowerCase() === change.nextName?.toLocaleLowerCase())
        ? change.nextName
        : "";
      changeProject(nextName);
    }
    void invalidateKnowledgeMetadata();
  };

  const handleImported = async () => {
    await invalidateKnowledgeQueries();
    await refreshMetadata().catch(() => undefined);
    await loadCards(false, false);
  };

  const tagSuggestions = useMemo(
    () => tagCounts.filter(({ tag }) => !parsedTags.includes(tag)).slice(0, 8),
    [tagCounts, parsedTags]
  );

  const selectCard = (card: KnowledgeCard) => {
    editorGenerationRef.current += 1;
    setSelectedId(card.id);
    setDetailCard(card);
    setDraft(toDraft(card));
    setDraftRelatedIds(declaredRelatedIds(card));
    setDirty(false);
    setFieldErrors({});
    setNotice("");
    setSaveState("idle");
    setOrganizeOpen(false);
    setSourceDetailOpen(false);
    setSourceReview(null);
    lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(card), declaredRelatedIds(card)));
    // 复用追踪：每张卡在页面会话内只记一次打开
    if (!touchedCardIds.current.has(card.id)) {
      touchedCardIds.current.add(card.id);
      api.touchKnowledgeCard(card.id)
        .then((touched) => {
          const patch = (item: KnowledgeCard) => item.id === touched.id
            ? { ...item, usage_count: touched.usage_count ?? item.usage_count, last_used_at: touched.last_used_at ?? item.last_used_at }
            : item;
          setCards((items) => items.map(patch));
          setDetailCard((item) => item?.id === touched.id ? patch(item) : item);
          void invalidateKnowledgeQueries();
        })
        .catch(() => { /* 使用计数失败不打扰用户 */ });
    }
  };

  const openCard = (card: KnowledgeCard) => {
    const open = async () => {
      if (dirty) {
        if (selectedId) {
          try {
            if (!(await saveDirtyDraft())) return;
          } catch (e) {
            const message = api.getErrorMessage(e);
            setSaveState("error");
            showNotice(message, "bad");
            return;
          }
        } else if (hasDraftInput(draft)) {
          const leave = await confirm({
            title: "离开新卡片",
            message: "当前新卡片还没有创建，确定放弃这份草稿吗？",
            confirmText: "放弃草稿",
            danger: true,
          });
          if (!leave) return;
        }
      }
      if (selectedId !== card.id) selectCard(card);
      if (isMobile) setMobileView("detail");
      onOpenCard?.(card.id);
    };
    void open();
  };

  // 从搜索跳转打开指定卡片；详情深链接不依赖先拉完整卡片集合。
  const initialCardHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!initialCardId || initialCardHandled.current === initialCardId) return;
    const target = cards.find((card) => card.id === initialCardId);
    if (target) {
      initialCardHandled.current = initialCardId;
      setActiveStatus(target.status);
      onSearchParamsChange?.({ status: target.status });
      selectCard(target);
      return;
    }
    let cancelled = false;
    queryClient.fetchQuery({
      queryKey: api.knowledgeQueryKeys.card(initialCardId),
      queryFn: ({ signal }) => api.getKnowledgeCard(initialCardId, { signal }),
      staleTime: knowledgeQueryStaleTime,
    })
      .then((card) => {
        if (cancelled || initialCardHandled.current === initialCardId) return;
        initialCardHandled.current = initialCardId;
        setActiveStatus(card.status);
        onSearchParamsChange?.({ status: card.status });
        selectCard(card);
      })
      .catch(() => { /* 深链接目标不存在时保持列表空态 */ });
    return () => { cancelled = true; };
  }, [cards, initialCardId, initialNonce, onSearchParamsChange, queryClient]);

  // 单卡复习历史（间隔趋势折线）
  useEffect(() => {
    setReviewHistory([]);
    if (!selectedId) return;
    let cancelled = false;
    api.getReviewHistory(selectedId)
      .then((history) => { if (!cancelled) setReviewHistory(history); })
      .catch(() => { if (!cancelled) setReviewHistory([]); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const incomingRelatedIds = useMemo(() => {
    if (!selectedCard) return [];
    const declaredIds = declaredRelatedIds(selectedCard);
    return (selectedCard.related_ids || []).filter((id) => !declaredIds.includes(id));
  }, [selectedCard]);

  const relatedDisplayIds = useMemo(
    () => [...new Set([...draftRelatedIds, ...incomingRelatedIds])],
    [draftRelatedIds, incomingRelatedIds],
  );

  const relatedChips = useMemo(
    () => relatedDisplayIds
      .map((id) => cards.find((card) => card.id === id) || relatedCards.find((card) => card.id === id))
      .filter((card): card is KnowledgeCard => !!card),
    [cards, relatedDisplayIds, relatedCards]
  );

  const relatedCandidates = useMemo(() => {
    return relatedSearchCards
      .filter((card) => card.id !== selectedId && !relatedDisplayIds.includes(card.id))
      .slice(0, 8);
  }, [relatedDisplayIds, relatedSearchCards, selectedId]);

  useEffect(() => {
    const ids = relatedDisplayIds.filter((id) => !cards.some((card) => card.id === id));
    if (!ids.length) {
      setRelatedCards([]);
      return;
    }
    let cancelled = false;
    Promise.all(ids.map((id) => queryClient.fetchQuery({
      queryKey: api.knowledgeQueryKeys.card(id),
      queryFn: ({ signal }) => api.getKnowledgeCard(id, { signal }),
      staleTime: knowledgeQueryStaleTime,
    }).catch(() => null)))
      .then((items) => {
        if (!cancelled) setRelatedCards(items.filter((card): card is KnowledgeCard => !!card));
      });
    return () => { cancelled = true; };
  }, [cards, queryClient, relatedDisplayIds]);

  useEffect(() => {
    const search = relatedQuery.trim();
    const requestId = ++relatedSearchRequestRef.current;
    if (!search) {
      setRelatedSearchCards([]);
      return;
    }
    setRelatedSearchCards([]);
    const timer = setTimeout(() => {
      void queryClient.fetchQuery({
        queryKey: api.knowledgeQueryKeys.cards({ q: search, sort: "updated", page: "1", pageSize: "8" }),
        queryFn: ({ signal }) => api.queryKnowledgeCards({ q: search, sort: "updated", page: 1, page_size: 8 }, { signal }),
        staleTime: knowledgeQueryStaleTime,
      })
        .then((result) => {
          if (requestId === relatedSearchRequestRef.current) setRelatedSearchCards(result.cards);
        })
        .catch(() => {
          if (requestId === relatedSearchRequestRef.current) setRelatedSearchCards([]);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [queryClient, relatedQuery]);

  useEffect(() => {
    const search = draft.title.trim();
    const requestId = ++duplicateSearchRequestRef.current;
    setDuplicateCards([]);
    if (search.length < 3) return;
    const timer = setTimeout(() => {
      void queryClient.fetchQuery({
        queryKey: api.knowledgeQueryKeys.cards({ q: search, sort: "updated", page: "1", pageSize: "8" }),
        queryFn: ({ signal }) => api.queryKnowledgeCards({ q: search, sort: "updated", page: 1, page_size: 8 }, { signal }),
        staleTime: knowledgeQueryStaleTime,
      })
        .then((result) => {
          if (requestId === duplicateSearchRequestRef.current) setDuplicateCards(result.cards);
        })
        .catch(() => {
          if (requestId === duplicateSearchRequestRef.current) setDuplicateCards([]);
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [draft.title, queryClient]);

  const startNew = () => {
    const open = async () => {
      if (dirty) {
        if (selectedId) {
          try {
            if (!(await saveDirtyDraft())) return;
          } catch (e) {
            const message = api.getErrorMessage(e);
            setSaveState("error");
            showNotice(message, "bad");
            return;
          }
        } else if (hasDraftInput(draft)) {
          const leave = await confirm({
            title: "离开新卡片",
            message: "当前新卡片还没有创建，确定放弃这份草稿吗？",
            confirmText: "放弃草稿",
            danger: true,
          });
          if (!leave) return;
        }
      }
      editorGenerationRef.current += 1;
      setSelectedId(null);
      setDraft({ ...emptyDraft, status: "draft" });
      setOrganizeOpen(false);
      setSourceDetailOpen(false);
      setSourceArticle(null);
      setSourceReview(null);
      setSourceError("");
      setDraftRelatedIds([]);
      setFieldErrors({});
      setRelatedQuery("");
      setDirty(false);
      setNotice("");
      setSaveState("idle");
      if (isMobile) setMobileView("detail");
      onNewCard?.();
    };
    void open();
  };

  const closeMobileDetail = async () => {
    if (dirty && selectedId) {
      try {
        if (!(await saveDirtyDraft())) {
          showNotice("保存期间内容发生变化，请先重试保存。", "bad");
          return;
        }
      } catch (e) {
        showNotice(api.getErrorMessage(e), "bad");
        return;
      }
    } else if (dirty && hasDraftInput(draft)) {
      const leave = await confirm({
        title: "离开编辑",
        message: "当前新卡片还没有创建，确定放弃这份草稿吗？",
        confirmText: "放弃草稿",
        danger: true,
      });
      if (!leave) return;
    }
    setMobileView("list");
    if (onBackToList) onBackToList();
    else onNavigate("knowledge");
  };

  const saveNewCard = async () => {
    const payload = payloadFromDraft(draft);
    const validationErrors: KnowledgeValidationErrors = {};
    if (!payload.title) validationErrors.title = "请输入标题，用一句话说明这条知识。";
    if (!payload.content) validationErrors.content = "请输入正文，先写清可复习的结论。";
    if (Object.keys(validationErrors).length > 0) {
      reportValidation(validationErrors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const creating = !selectedId;
      const saved = selectedId
        ? await api.updateKnowledgeCard(selectedId, { ...payload, related_ids: draftRelatedIds })
        : await api.createKnowledgeCard({ ...payload, related_ids: draftRelatedIds });
      await invalidateKnowledgeQueries();
      await refreshMetadata().catch(() => undefined);
      setDirty(false);
      await loadCards(true, false);
      setSelectedId(saved.id);
      setDraft(toDraft(saved));
      setDraftRelatedIds(declaredRelatedIds(saved));
      setDetailCard(saved);
      setDirty(false);
      setFieldErrors({});
      setSaveState("saved");
      lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(saved), declaredRelatedIds(saved)));
      const message = selectedId ? "已保存知识卡片。" : "已创建知识卡片。";
      showNotice(message, "good");
      toast.success(message);
      if (creating) onOpenCard?.(saved.id);
    } catch (e) {
      const message = api.getErrorMessage(e);
      showNotice(message, "bad");
      toast.error(message);
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (status: KnowledgeCardStatus, ids = selectedId ? [selectedId] : []) => {
    if (!ids.length) return;
    if (status === "confirmed") {
      const missingSource = ids.filter((id) => {
        if (id === selectedId) return !hasKnowledgeSource(draft);
        const card = cards.find((item) => item.id === id);
        return !card || !hasKnowledgeSource(card);
      });
      if (missingSource.length > 0) {
        const message = missingSource.length === 1
          ? "确认沉淀前请补充来源日期、来源 ID 或原文片段。"
          : `有 ${missingSource.length} 张卡片缺少来源，请补齐后再批量确认。`;
        if (missingSource.length === 1 && missingSource[0] === selectedId) reportValidation({ source: message });
        else showNotice(message, "bad");
        toast.error(message);
        return;
      }
    }
    setFieldErrors({});
    setSaving(true);
    try {
      if (!(await saveDirtyDraft())) {
        throw new Error("保存期间内容发生变化，请重试后再执行状态变更。");
      }
      await api.batchKnowledgeCards({
        ids,
        action: status === "confirmed" ? "confirm" : "set_status",
        values: status === "confirmed" ? [] : [status],
      });
      await invalidateKnowledgeQueries();
      setSelectedIds([]);
      await loadCards(false, false);
      setFieldErrors({});
      const message = status === "confirmed" ? `已确认 ${ids.length} 张卡片。` : "状态已更新。";
      showNotice(message, "good");
      toast.success(message);
    } catch (e) {
      const message = api.getErrorMessage(e);
      showNotice(message, "bad");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const restoreCards = async (ids: string[]) => {
    if (!ids.length) return;
    setSaving(true);
    try {
      const result = await api.restoreKnowledgeCards(ids);
      await invalidateKnowledgeQueries();
      await refreshMetadata().catch(() => undefined);
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      await loadCards(false, false);
      const message = `已恢复 ${result.updated} 张卡片。`;
      showNotice(message, "good");
      toast.success(message);
    } catch (e) {
      const message = api.getErrorMessage(e);
      showNotice(message, "bad");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const deleteCards = async (ids = selectedId ? [selectedId] : []) => {
    if (!ids.length) return;
    const ok = await confirm({
      title: "删除知识卡片",
      message: ids.length === 1 ? "将当前知识卡片移入回收站？正文、空间关系和复习记录都可以恢复。" : `将选中的 ${ids.length} 张卡片移入回收站？正文、空间关系和复习记录都可以恢复。`,
      confirmText: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      if (!(await saveDirtyDraft())) {
        throw new Error("保存期间内容发生变化，请重试后再移入回收站。");
      }
      await api.batchKnowledgeCards({ ids, action: "delete" });
      await invalidateKnowledgeQueries();
      await refreshMetadata().catch(() => undefined);
      setSelectedIds([]);
      editorGenerationRef.current += 1;
      setSelectedId(null);
      setDraft(emptyDraft);
      await loadCards(false, false);
      const message = `已删除 ${ids.length} 张卡片。`;
      showNotice(message, "good");
      toast.success(message, {
        action: {
          label: "撤销",
          onClick: () => { void restoreCards(ids); },
        },
      });
    } catch (e) {
      const message = api.getErrorMessage(e);
      showNotice(message, "bad");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };
  const visibleCardIds = useMemo(() => sortedCards.map((card) => card.id), [sortedCards]);
  const selectedDraftCount = useMemo(
    () => selectedIds.filter((id) => cards.some((card) => card.id === id && card.status === "draft")).length,
    [cards, selectedIds],
  );
  const allVisibleSelected = visibleCardIds.length > 0 && visibleCardIds.every((id) => selectedIds.includes(id));
  const someVisibleSelected = visibleCardIds.some((id) => selectedIds.includes(id));
  const visibleSelectedCount = visibleCardIds.filter((id) => selectedIds.includes(id)).length;
  const hiddenSelectedCount = selectedIds.length - visibleSelectedCount;
  const selectAllVisible = () => {
    const visible = new Set(visibleCardIds);
    setSelectedIds((ids) => allVisibleSelected
      ? ids.filter((id) => !visible.has(id))
      : [...ids, ...visibleCardIds.filter((id) => !ids.includes(id))]);
  };
  const invertVisibleSelection = () => {
    const visible = new Set(visibleCardIds);
    setSelectedIds((ids) => [
      ...ids.filter((id) => !visible.has(id)),
      ...visibleCardIds.filter((id) => !ids.includes(id)),
    ]);
  };
  const clearSelection = () => setSelectedIds([]);
  const clearHiddenSelection = () => {
    const visible = new Set(visibleCardIds);
    setSelectedIds((ids) => ids.filter((id) => visible.has(id)));
  };

  const applyBatch = async () => {
    const values = batchMode === "tag" || batchMode === "remove_tag"
      ? batchValue.split(",").map((value) => value.trim()).filter(Boolean)
      : [batchValue.trim()].filter(Boolean);
    if (!values.length || !selectedIds.length || !batchMode) return;
    setSaving(true);
    try {
      if (!(await saveDirtyDraft())) {
        throw new Error("保存期间内容发生变化，请重试后再执行批量操作。");
      }
      const action = batchMode === "tag" || batchMode === "remove_tag"
        ? batchMode === "tag" ? "add_tags" : "remove_tags"
        : batchMode === "move_project"
          ? "set_projects"
          : batchMode === "remove_project"
            ? "remove_projects"
            : "add_projects";
      await api.batchKnowledgeCards({ ids: selectedIds, action, values });
      await invalidateKnowledgeQueries();
      await refreshMetadata().catch(() => undefined);
      const ids = selectedIds.length;
      setSelectedIds([]);
      setBatchMode("");
      setBatchValue("");
      setMobileBatchOpen(false);
      await loadCards(false, false);
      const message = batchMode === "tag"
        ? `已为 ${ids} 张卡片添加标签。`
        : batchMode === "remove_tag"
          ? `已从 ${ids} 张卡片移除标签。`
        : batchMode === "move_project"
          ? `已将 ${ids} 张卡片移动到「${values[0]}」。`
          : batchMode === "remove_project"
            ? `已将 ${ids} 张卡片移出空间「${values[0]}」。`
            : `已为 ${ids} 张卡片加入空间。`;
      showNotice(message, "good");
      toast.success(message);
    } catch (e) {
      const message = api.getErrorMessage(e);
      showNotice(message, "bad");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const openSource = () => {
    const open = async () => {
      if (dirty && selectedId) {
        try {
          if (!(await saveDirtyDraft())) return;
        } catch (e) {
          setSaveState("error");
          showNotice(api.getErrorMessage(e), "bad");
          return;
        }
      } else if (dirty && hasDraftInput(draft)) {
        const leave = await confirm({
          title: "离开新卡片",
          message: "当前新卡片还没有创建，确定先离开去查看来源吗？",
          confirmText: "离开并查看来源",
          danger: true,
        });
        if (!leave) return;
      }
      if (sourceArticle || sourceReview) {
        setSourceDetailOpen(true);
        return;
      }
      if (await loadSourceDetail()) setSourceDetailOpen(true);
    };
    void open();
  };
  const editSourceArticle = (date: string) => {
    const open = async () => {
      if (dirty && selectedId) {
        try {
          if (!(await saveDirtyDraft())) return;
        } catch (e) {
          setSaveState("error");
          showNotice(api.getErrorMessage(e), "bad");
          return;
        }
      }
      setSourceDetailOpen(false);
      onEditDate(date);
    };
    void open();
  };
  const openConnectionSettings = () => {
    const open = async () => {
      if (dirty && selectedId) {
        try {
          if (!(await saveDirtyDraft())) return;
        } catch (e) {
          setSaveState("error");
          showNotice(api.getErrorMessage(e), "bad");
          return;
        }
      } else if (dirty && hasDraftInput(draft)) {
        const leave = await confirm({
          title: "离开编辑",
          message: "当前内容尚未创建，确定先去连接设置吗？",
          confirmText: "离开并打开设置",
          danger: true,
        });
        if (!leave) return;
      }
      if (typeof window !== "undefined") {
        writeSessionStorage("daily-summary-settings-tab", "connect");
        writeSessionStorage(connectionReturnStorageKey, `${window.location.pathname}${window.location.search}`);
      }
      onNavigate("settings");
    };
    void open();
  };
  const currentSourceType = draft.source_review_id || selectedCard?.source_review_id ? "AI 复盘" : "每日记录";
  const verificationStage = draft.status === "confirmed"
    ? "confirmed"
    : hasKnowledgeSource(draft)
      ? "source"
      : "draft";
  const verificationStageIndex = verificationStage === "confirmed" ? 3 : verificationStage === "source" ? 2 : 1;

  const toggleBatchMode = (mode: Exclude<KnowledgeBatchMode, "">) => {
    setBatchMode((current) => current === mode ? "" : mode);
    setBatchValue("");
  };

  const pageCount = Math.max(1, Math.ceil(totalCards / knowledgePageSize));
  const changePage = (nextPage: number) => {
    const next = Math.max(1, Math.min(pageCount, Math.trunc(nextPage)));
    if (next === page) return;
    setSelectedIds([]);
    setPage(next);
    if (isMobile) setMobileView("list");
    onSearchParamsChange?.({ page: next > 1 ? next : undefined, view: "list" });
  };

  const activeQuery = routeQueryRef.current.trim();
  const activeFilterCount = [activeQuery, typeFilter, usageFilter, qualityFilter, tagFilter, projectFilter, activeStatus !== "all" ? activeStatus : "", sort !== "updated" ? sort : ""].filter(Boolean).length;
  const activeStatusLabel = activeStatus === "all" ? "全部状态" : statusLabels[activeStatus];
  const emptyStatusLabel = activeStatus === "all" ? "卡片" : `${statusLabels[activeStatus]}卡片`;
  const qualityScopeLabel = projectFilter ? "空间「" + projectFilter + "」" : "全库";
  const authError = /令牌|token|授权|认证/i.test(error);
  const sourceAuthError = /令牌|token|授权|认证/i.test(sourceError);
  const sourceArticleId = (draft.source_article_id || selectedCard?.source_article_id || "").trim();
  const sourceReviewId = (draft.source_review_id || selectedCard?.source_review_id || "").trim();
  const hasSourceReference = Boolean(
    sourceArticleId
    || sourceReviewId
    || draft.source_date
    || selectedCard?.source_date
    || sourceArticle?.date,
  );
  const sourceActionLabel = sourceArticle
    ? "查看原文"
    : sourceReview ? "查看复盘" : sourceReviewId ? "查看复盘" : "定位原文";
  const organizeSummary = selectedId
    ? [
        typeLabels[draft.card_type],
        statusLabels[draft.status],
        parsedTags.length ? `${parsedTags.length} 个标签` : "无标签",
        parsedProjects.length ? `${parsedProjects.length} 个空间` : "未归入空间",
        hasKnowledgeSource(draft) ? "有来源" : "缺来源",
      ].join(" · ")
    : "类型、标签、空间和关联可稍后补充";
  const hasSearchFilters = Boolean(activeQuery || typeFilter || usageFilter || qualityFilter || tagFilter || projectFilter);
  const emptyStateTitle = totalCards > 0
    ? `第 ${page} 页没有卡片`
    : hasSearchFilters ? "没有符合当前条件的卡片" : `没有${emptyStatusLabel}`;
  const emptyStateDescription = totalCards > 0
    ? "当前页已经超出结果范围，请返回上一页。"
    : hasSearchFilters
      ? "换个关键词或清除筛选条件，原有卡片不会被删除。"
      : activeStatus === "draft"
        ? "从每日记录或周/月复盘提取草稿后，在这里逐条确认。"
        : activeStatus === "all"
          ? "先创建一张卡片，标题和正文写好后再补充来源。"
          : "当前状态还没有卡片，可以回到全部卡片继续整理。";
  const emptyStateAction = totalCards > 0 && page > 1
    ? { label: "回到上一页", onClick: () => changePage(page - 1) }
    : hasSearchFilters
      ? { label: "清除筛选", onClick: resetFilters }
      : activeStatus === "draft"
        ? { label: "导入卡片", onClick: () => setImportOpen(true) }
        : activeStatus === "all"
          ? { label: "新建卡片", onClick: startNew }
          : { label: "查看全部卡片", onClick: () => changeStatus("all") };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-surface page-surface-knowledge min-w-0 min-h-full overflow-x-hidden px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden"
    >
      <PageHeader
        className="knowledge-page-header"
        icon={BookMarked}
        title="知识工作台"
        description={
          <>
            <span className="hidden xl:inline">把真实记录、Markdown 或 AI 整理的内容，沉淀成可追溯、可确认的知识卡片</span>
            <span className="xl:hidden">把记录、Markdown 或 AI 内容，沉淀成可追溯的知识卡片</span>
          </>
        }
        navigation={
          <Tabs value={activeStatus} onValueChange={(v) => changeStatus(v as KnowledgeStatusFilter)} className="hidden min-w-0 md:block md:w-full md:max-w-[500px]">
            <TabsList className="grid w-full grid-cols-4">
              {statusFilterOptions.map(([status, label]) => (
                <TabsTrigger key={status} value={status}>
                  {label} <span className="font-mono text-[11px] opacity-70">{status === "all" ? counts.total : counts[status]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            </Tabs>
        }
        actions={
          <PageHeaderActions
            primary={
              <button type="button" onClick={startNew} className="ui-button-primary hidden h-9 px-3 text-xs xl:inline-flex">
                <Plus size={14} /> 新建卡片
              </button>
            }
            secondary={
              <button type="button" onClick={() => setImportOpen(true)} className="ui-button-secondary h-9 px-3 text-xs">
                <Upload size={14} /> 导入卡片
              </button>
            }
          />
        }
      />

      {error && (
        <div className="ui-alert-bad mb-4 flex flex-wrap items-center justify-between gap-3" role="alert">
          <span className="min-w-0 flex-1">{error}</span>
          <div className="flex shrink-0 items-center gap-2">
            {authError && (
              <button
                type="button"
                onClick={openConnectionSettings}
                className="ui-button-primary h-8 px-2.5 text-xs"
              >
                前往连接设置
              </button>
            )}
            <button type="button" onClick={() => void loadCards(false, false)} disabled={loading} className="ui-button-ghost h-8 shrink-0 px-2.5 text-xs">
              {loading ? "重试中..." : "重试"}
            </button>
          </div>
        </div>
      )}

      {mobileView === "list" && (
        <div className="knowledge-mobile-toolbar mb-4 grid gap-2 xl:hidden">
          <button type="button" onClick={startNew} className="ui-button-primary h-11 min-h-11 w-full px-3">
            <Plus size={15} /> <span>新建卡片</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            className="ui-mobile-control flex h-11 min-h-11 w-full min-w-0 items-center gap-2 text-left shadow-xs"
          >
            <Search size={16} className="shrink-0 text-[var(--ui-accent-text)]" />
            <span className="min-w-0 flex-1 truncate">{query || "搜索标题、内容或来源"}</span>
            {activeFilterCount > 0 && <span className="ui-status-accent inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold">{activeFilterCount}</span>}
            <SlidersHorizontal size={15} className="shrink-0 text-[var(--ui-text-subtle)]" />
          </button>
        </div>
      )}

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="px-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <SheetHeader>
            <div className="flex items-center justify-between gap-3">
              <SheetTitle>搜索与筛选</SheetTitle>
              {activeFilterCount > 0 && (
                <button type="button" onClick={resetFilters} className="ui-button-ghost h-8 min-h-8 shrink-0 px-2 text-xs">
                  重置全部
                </button>
              )}
            </div>
            <SheetDescription>筛选结果会同步到地址栏，刷新后仍可恢复。</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-text-subtle)]" size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchCards(); setMobileFiltersOpen(false); } }}
                placeholder="搜索标题、内容或来源"
                aria-label="搜索标题、内容或来源"
                className="ui-field h-11 pl-10"
                autoFocus
              />
            </div>
            <div className="mt-5 space-y-5 pb-2">
              <div>
                <div className="ui-section-kicker mb-2">状态</div>
                <div className="grid grid-cols-3 gap-2">
                  {statusFilterOptions.map(([status, label]) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => changeStatus(status)}
                      className={[
                        "ui-filter-button w-full min-h-12 flex-col items-center justify-center",
                        activeStatus === status ? "ui-filter-button-active" : "",
                      ].join(" ")}
                    >
                      <div className="text-xs font-medium">{label}</div>
                      <div className="mt-0.5 font-mono text-sm font-bold">{status === "all" ? counts.total : counts[status]}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="ui-section-kicker">空间</div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileFiltersOpen(false);
                      openSpaceManager();
                    }}
                    className="ui-button-ghost h-7 min-h-7 gap-1 px-1.5 text-[11px]"
                  >
                    <FolderCog size={13} /> 空间管理
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <FilterButton active={!projectFilter} onClick={() => changeProject("")}>全部空间</FilterButton>
                  {projectCounts.map(({ name, count, article_count = 0 }) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => changeProject(projectFilter === name ? "" : name)}
                      className={[
                        "ui-filter-button min-h-8 gap-1 px-2.5",
                        projectFilter === name ? "ui-filter-button-active" : "",
                      ].join(" ")}
                    >
                      <Folder size={12} /> {name} <span className="opacity-60">{count} 卡{article_count > 0 ? ` · ${article_count} 记` : ""}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="ui-section-kicker mb-2">类型</div>
                <div className="grid grid-cols-2 gap-2">
                  <FilterButton active={!typeFilter} onClick={() => changeType("")}>全部类型</FilterButton>
                  {typeOptions.map(([value, label]) => <FilterButton key={value} active={typeFilter === value} onClick={() => changeType(value)}>{label}</FilterButton>)}
                </div>
              </div>
              <div>
                <div className="ui-section-kicker mb-2">使用情况</div>
                <div className="grid grid-cols-2 gap-2">
                  <FilterButton active={!usageFilter} onClick={() => changeUsage("")}>全部卡片</FilterButton>
                  <FilterButton active={usageFilter === "never_used"} onClick={() => changeUsage(usageFilter === "never_used" ? "" : "never_used")}>从未使用</FilterButton>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="ui-section-kicker">数据质量</div>
                  {qualityFilter && <button type="button" onClick={() => changeQuality("")} className="ui-button-ghost h-7 px-1 text-[11px]">清除</button>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <FilterButton active={!qualityFilter} onClick={() => changeQuality("")}>全部质量</FilterButton>
                  {qualityOptions.map(([value, label]) => (
                    <FilterButton key={value} active={qualityFilter === value} onClick={() => changeQuality(qualityFilter === value ? "" : value)}>
                      <span className="flex items-center justify-between gap-1.5">
                        <span className="truncate">{label}</span>
                        <span className="shrink-0 font-mono text-[11px] opacity-60">{counts[value]}</span>
                      </span>
                    </FilterButton>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">数量为{qualityScopeLabel}活跃卡片，可继续叠加状态、标签或质量筛选。</p>
                {qualityFilter && <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">{qualityOptions.find(([value]) => value === qualityFilter)?.[2]}</p>}
              </div>
              <div>
                <div className="ui-section-kicker mb-2">排序</div>
                <div className="grid grid-cols-2 gap-2">
                  {sortOptions.map(([value, label]) => (
                    <FilterButton key={value} active={sort === value} onClick={() => changeSort(value)}>{label}</FilterButton>
                  ))}
                </div>
              </div>
              <div>
                <div className="ui-section-kicker mb-2 flex items-center justify-between">
                  <span>标签</span>
                  {tagFilter && <button type="button" onClick={() => changeTag("")} className="ui-button-ghost h-7 px-1 text-[11px]">清除</button>}
                </div>
                <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                  {tagCounts.map(({ tag, count }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => changeTag(tagFilter === tag ? "" : tag)}
                      className={[
                        "ui-filter-button min-h-8 gap-1 px-2.5",
                        tagFilter === tag ? "ui-filter-button-active" : "",
                      ].join(" ")}
                    >
                      #{tag} <span className="opacity-60">{count}</span>
                    </button>
                  ))}
                  {tagCounts.length === 0 && <span className="text-xs text-[var(--ui-text-subtle)]">暂无标签</span>}
                </div>
              </div>
            </div>
          </div>
          <div className="ui-soft-divider border-t px-4 pt-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--ui-text)]">卡片回收站</div>
                <p className="mt-0.5 text-[11px] text-[var(--ui-text-subtle)]">已删除卡片可恢复，关系和复习进度会保留。</p>
              </div>
              <Link
                to="/knowledge/trash"
                search={{} as never}
                onClick={() => setMobileFiltersOpen(false)}
                className="ui-button-secondary h-9 shrink-0 px-2.5 text-xs"
              >
                <Trash2 size={14} /> 查看回收站
              </Link>
            </div>
            <button type="button" onClick={() => { searchCards(); setMobileFiltersOpen(false); }} className="ui-button-primary h-11 w-full text-sm">
              应用筛选{activeFilterCount > 0 ? ` · ${activeFilterCount} 项条件` : ""}
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={mobileBatchOpen}
        onOpenChange={(open) => {
          setMobileBatchOpen(open);
          if (!open) {
            setBatchMode("");
            setBatchValue("");
          }
        }}
      >
        <SheetContent side="bottom" className="px-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] xl:hidden">
          <SheetHeader>
            <SheetTitle>批量处理 · {selectedIds.length} 张卡片</SheetTitle>
            <SheetDescription>选择一个动作，目标输入会在这里完成；删除仍可撤销。</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            <div className="grid gap-2 pb-2">
              <button
                type="button"
                onClick={() => toggleBatchMode("tag")}
                className={[
                  "ui-bulk-action",
                  batchMode === "tag" ? "ui-bulk-action-active" : "",
                ].join(" ")}
              >
                <Tags size={17} className="shrink-0 text-[var(--ui-accent-text)]" />
                <span><span className="block text-sm font-semibold">添加标签</span><span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">给选中卡片增加一个或多个标签</span></span>
              </button>
              <button
                type="button"
                onClick={() => toggleBatchMode("remove_tag")}
                className={[
                  "ui-bulk-action",
                  batchMode === "remove_tag" ? "ui-bulk-action-active" : "",
                ].join(" ")}
              >
                <Tags size={17} className="shrink-0 text-[var(--ui-text-muted)]" />
                <span><span className="block text-sm font-semibold">移除标签</span><span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">从选中卡片中移除指定标签</span></span>
              </button>
              <button
                type="button"
                onClick={() => toggleBatchMode("add_project")}
                className={[
                  "ui-bulk-action",
                  batchMode === "add_project" ? "ui-bulk-action-active" : "",
                ].join(" ")}
              >
                <Folder size={17} className="shrink-0 text-[var(--ui-accent-text)]" />
                <span><span className="block text-sm font-semibold">加入空间</span><span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">保留已有空间，再添加一个空间</span></span>
              </button>
              <button
                type="button"
                onClick={() => toggleBatchMode("move_project")}
                className={[
                  "ui-bulk-action",
                  batchMode === "move_project" ? "ui-bulk-action-active" : "",
                ].join(" ")}
              >
                <Folder size={17} className="shrink-0 text-[var(--ui-accent-text)]" />
                <span><span className="block text-sm font-semibold">移动到空间</span><span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">用目标空间替换卡片已有空间</span></span>
              </button>
              <button
                type="button"
                onClick={() => toggleBatchMode("remove_project")}
                className={[
                  "ui-bulk-action",
                  batchMode === "remove_project" ? "ui-bulk-action-active" : "",
                ].join(" ")}
              >
                <Folder size={17} className="shrink-0 text-[var(--ui-text-muted)]" />
                <span><span className="block text-sm font-semibold">移出空间</span><span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">从指定空间中移除这些卡片</span></span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileBatchOpen(false);
                  void deleteCards(selectedIds);
                }}
                className="ui-button-danger min-h-12 justify-start px-3"
              >
                <Trash2 size={17} className="shrink-0" />
                <span><span className="block text-sm font-semibold">移入回收站</span><span className="mt-0.5 block text-xs opacity-75">可从回收站恢复，不会立即永久删除</span></span>
              </button>
            </div>

            {batchMode && (
              <div className="ui-status-accent mb-2 rounded-xl p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--ui-accent-text)]">
                    {batchMode === "tag" ? "添加标签" : batchMode === "remove_tag" ? "移除标签" : batchMode === "add_project" ? "加入空间" : batchMode === "move_project" ? "移动到空间" : "移出空间"}
                  </span>
                  <button type="button" onClick={() => { setBatchMode(""); setBatchValue(""); }} className="ui-icon-button h-8 w-8" aria-label="关闭批量编辑">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {batchMode === "tag" || batchMode === "remove_tag" ? (
                    <input
                      value={batchValue}
                      onChange={(e) => setBatchValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyBatch(); } }}
                      placeholder="标签，逗号分隔多个"
                      aria-label={batchMode === "tag" ? "要添加的标签" : "要移除的标签"}
                      className="ui-field h-11 min-w-0 flex-1"
                      autoFocus
                    />
                  ) : (
                    <SpaceAutocomplete
                      spaces={projectCounts}
                      value={batchValue}
                      onChange={setBatchValue}
                      onEnter={() => void applyBatch()}
                      placeholder={batchMode === "move_project" ? "选择目标空间" : "选择空间"}
                      ariaLabel={batchMode === "move_project" ? "批量移动的目标空间" : "批量操作的空间"}
                      inputClassName="ui-field h-11 pl-9 text-sm"
                      containerClassName="min-w-0 flex-1"
                      autoFocus
                    />
                  )}
                  <button type="button" onClick={() => void applyBatch()} disabled={saving || !batchValue.trim()} className="ui-button-primary h-11 shrink-0 px-3 text-xs">
                    应用
                  </button>
                </div>
                <div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                  {(batchMode === "tag" || batchMode === "remove_tag" ? tagCounts.map(({ tag }) => tag) : projectCounts.map(({ name }) => name)).slice(0, 10).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBatchValue((current) => batchMode === "tag" || batchMode === "remove_tag" ? current ? `${current}, ${value}` : value : value)}
                      className="ui-chip h-7 border-[var(--ui-selected-border)] bg-[var(--ui-surface-raised)] text-[var(--ui-accent-text)] hover:bg-[var(--ui-surface-hover)]"
                    >
                      {batchMode === "tag" || batchMode === "remove_tag" ? `#${value}` : value}
                    </button>
                  ))}
                </div>
                {batchMode === "move_project" && <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">目标空间不存在时会自动创建。</p>}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <div className="knowledge-workspace grid min-w-0 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(320px,430px)_minmax(0,1fr)] 2xl:grid-cols-[244px_minmax(360px,430px)_minmax(0,1fr)] xl:items-stretch xl:overflow-hidden">
        <aside className="knowledge-project-index ui-panel hidden flex-col p-3 2xl:flex 2xl:h-full 2xl:min-h-0 2xl:overflow-hidden">
          <div className="flex shrink-0 gap-2">
            <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-text-subtle)]" size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") searchCards(); }}
              placeholder="搜索卡片"
              aria-label="搜索知识卡片"
              className="ui-field h-10 pl-9"
            />
            </div>
            <button type="button" onClick={searchCards} className="ui-button-secondary h-10 shrink-0 px-3">
              搜索
            </button>
          </div>

          <div className="mt-4 min-h-0 2xl:flex-1 2xl:overflow-y-auto 2xl:overscroll-contain 2xl:pr-1">
          {/* 空间导航（一级，突出） */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="ui-section-kicker">空间</div>
              {projectFilter && (
                <button type="button" onClick={() => changeProject("")} className="text-[11px] font-medium text-[var(--ui-accent-text)] hover:underline">显示全部</button>
              )}
            </div>
            <div className="mb-2">
              <button type="button" onClick={openSpaceManager} className="ui-button-secondary h-8 min-h-8 w-full gap-1 px-2 text-[11px]">
                <FolderCog size={13} /> 空间管理
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => changeProject("")}
                className={[
                  "ui-filter-button w-full justify-between gap-2 px-2.5 py-2 text-left text-[13px]",
                  !projectFilter ? "ui-filter-button-active" : "",
                ].join(" ")}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="ui-status-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-md"><Folder size={14} /></span>
                  <span className="truncate font-medium">全部卡片</span>
                </span>
                <span className={`shrink-0 rounded-full px-1.5 py-1 text-[11px] font-semibold leading-none ${!projectFilter ? "ui-status-accent" : "ui-status-muted"}`}>{projectFilter ? "全库" : String(summary.total) + " 卡"}</span>
              </button>
              {projectCounts.map(({ name, count, article_count = 0, kind }) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => changeProject(projectFilter === name ? "" : name)}
                  className={[
                    "ui-filter-button w-full justify-between gap-2 px-2.5 py-2 text-left text-[13px]",
                    projectFilter === name ? "ui-filter-button-active" : "",
                  ].join(" ")}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${projectFilter === name ? "ui-status-accent" : "ui-status-muted"}`}>
                      <Folder size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{name}</span>
                      {kind && <span className="mt-0.5 block text-[10px] leading-3 text-[var(--ui-text-subtle)]">{kind === "topic" ? "长期主题" : "项目空间"}</span>}
                    </span>
                  </span>
                  <span className={`flex shrink-0 flex-col items-end gap-0.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold leading-none ${projectFilter === name ? "ui-status-accent" : "ui-status-muted"}`} title={`${count} 张知识卡片 · ${article_count} 篇每日记录`}>
                    <span>{count} 张卡片</span>
                    {article_count > 0 && <span className="text-[10px] font-normal opacity-70">{article_count} 篇记录</span>}
                  </span>
                </button>
              ))}
              {projectCounts.length === 0 && (
                <p className="px-2 py-1 text-xs text-[var(--ui-text-subtle)]">暂无空间，创建一个</p>
              )}
            </div>
          </div>

          {/* 筛选与状态（折叠） */}
          <div className="ui-soft-divider mt-4 border-t pt-2">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              aria-expanded={showFilters}
              aria-controls="knowledge-filters"
              className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-[11px] font-semibold tracking-[0.06em] text-[var(--ui-text-subtle)] transition-colors hover:text-[var(--ui-text)]"
            >
              <span className="flex items-center gap-2">
                <span>筛选与状态</span>
                {activeFilterCount > 0 && <span className="ui-status-accent inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px]">{activeFilterCount}</span>}
              </span>
              <ChevronDown size={14} className={`transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
            {showFilters && (
              <div id="knowledge-filters" className="mt-2 space-y-4">
                <div className="grid grid-cols-3 gap-1.5">
                  {statusFilterOptions.map(([status, label]) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => changeStatus(status)}
                      className={[
                        "ui-filter-button w-full min-h-12 flex-col items-center justify-center",
                        activeStatus === status ? "ui-filter-button-active" : "",
                      ].join(" ")}
                    >
                      <div className="text-[10px] leading-none">{label}</div>
                      <div className="mt-1 font-mono text-sm font-bold">{status === "all" ? counts.total : counts[status]}</div>
                    </button>
                  ))}
                </div>
                <div>
                  <div className="ui-section-kicker mb-2">类型</div>
                  <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-1">
                    <FilterButton active={!typeFilter} onClick={() => changeType("")}>全部类型</FilterButton>
                    {typeOptions.map(([value, label]) => (
                      <FilterButton key={value} active={typeFilter === value} onClick={() => changeType(value)}>{label}</FilterButton>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="ui-section-kicker mb-2">使用</div>
                  <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-1">
                    <FilterButton active={!usageFilter} onClick={() => changeUsage("")}>全部卡片</FilterButton>
                    <FilterButton active={usageFilter === "never_used"} onClick={() => changeUsage(usageFilter === "never_used" ? "" : "never_used")}>从未使用</FilterButton>
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="ui-section-kicker">数据质量</div>
                    {qualityFilter && <button type="button" onClick={() => changeQuality("")} className="ui-button-ghost h-6 px-1 text-[11px]">清除</button>}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-1">
                    <FilterButton active={!qualityFilter} onClick={() => changeQuality("")}>全部质量</FilterButton>
                    {qualityOptions.map(([value, label]) => (
                      <FilterButton key={value} active={qualityFilter === value} onClick={() => changeQuality(qualityFilter === value ? "" : value)}>
                        <span className="flex items-center justify-between gap-1.5">
                          <span className="truncate">{label}</span>
                          <span className="shrink-0 font-mono text-[11px] opacity-60">{counts[value]}</span>
                        </span>
                      </FilterButton>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">数量为{qualityScopeLabel}活跃卡片，可继续叠加其他筛选。</p>
                  {qualityFilter && <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">{qualityOptions.find(([value]) => value === qualityFilter)?.[2]}</p>}
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="ui-section-kicker">标签</div>
                    {tagFilter && (
                      <button type="button" onClick={() => changeTag("")} className="ui-button-ghost h-6 px-1 text-[11px]">清除</button>
                    )}
                  </div>
                  {tagCounts.length === 0 ? (
                    <p className="text-xs text-[var(--ui-text-subtle)]">暂无标签</p>
                  ) : (
                    <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                      {tagCounts.map(({ tag, count }) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => changeTag(tagFilter === tag ? "" : tag)}
                          className={[
                            "ui-filter-button min-h-8 gap-1 px-2 py-1",
                            tagFilter === tag ? "ui-filter-button-active" : "",
                          ].join(" ")}
                        >
                          #{tag} <span className="opacity-60">{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {workflowHelpOpen ? (
            <div id="knowledge-workflow-help" className="ui-panel-muted mt-4 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ui-text)]">
                  <CheckCircle2 size={14} className="text-[var(--ui-accent-text)]" /> 工作流
                </div>
                <button type="button" onClick={dismissWorkflowHelp} className="ui-icon-button h-7 w-7" title="不再显示工作流提示" aria-label="不再显示工作流提示">
                  <X size={14} />
                </button>
              </div>
              <div className="mt-2.5 space-y-2 text-xs leading-5 text-[var(--ui-text-muted)]">
                <div className="flex items-start gap-2"><span className="ui-status-muted flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px]">1</span><span>从记录、复盘或文档生成草稿</span></div>
                <div className="flex items-start gap-2"><span className="ui-status-muted flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px]">2</span><span>对照来源片段确认</span></div>
                <div className="flex items-start gap-2"><span className="ui-status-muted flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px]">3</span><span>沉淀后用于复习检索</span></div>
              </div>
              <div className="ui-soft-divider mt-3 border-t pt-3 text-[11px] leading-5 text-[var(--ui-text-muted)]">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--ui-accent-text)]"><ShieldCheck size={13} /> 来源约束</div>
                <p className="mt-1">没有来源片段的内容，不建议确认沉淀。</p>
              </div>
            </div>
          ) : (
            <button type="button" onClick={showWorkflowHelp} className="ui-button-ghost mt-3 h-8 w-full justify-start px-2 text-xs" aria-expanded={false} aria-controls="knowledge-workflow-help">
              <CheckCircle2 size={13} /> 显示工作流提示
            </button>
          )}
          </div>
          <div className="ui-soft-divider mt-3 shrink-0 border-t pt-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <button type="button" onClick={startNew} className="ui-button-primary">
                <Plus size={14} /> 新建卡片
              </button>
              <Link
                to="/knowledge/trash"
                search={{} as never}
                className="ui-button-secondary inline-flex h-9 items-center gap-1.5 px-2.5 text-xs"
              >
                <Trash2 size={14} />
                <span>回收站</span>
              </Link>
            </div>
            <p className="mt-2 px-1 text-[11px] leading-4 text-[var(--ui-text-subtle)]">
              新卡默认保存为草稿，可在右侧补充来源、标签和空间。
            </p>
          </div>
        </aside>

        <section className={["knowledge-card-index ui-panel flex min-w-0 flex-col overflow-visible p-2 xl:h-full xl:min-h-0 xl:overflow-hidden", mobileView === "list" ? "" : "hidden", "xl:flex"].join(" ")}>
          <div className="shrink-0 px-2 pt-1">
            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--ui-border)] pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="ui-status-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                  <SlidersHorizontal size={14} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-[var(--ui-text)]">{activeStatusLabel}</div>
                  <div className="mt-0.5 truncate text-[10px] leading-3 text-[var(--ui-text-subtle)]">{projectFilter ? "当前空间 · " + projectFilter : "当前筛选结果"}</div>
                </div>
              </div>
              <span className="ui-status-accent inline-flex h-7 min-w-8 shrink-0 items-center justify-center rounded-lg px-2 font-mono text-xs font-bold" aria-label={activeStatusLabel + " " + totalCards + " 张"}>
                {totalCards}
              </span>
            </div>
            <div className="hidden min-h-9 items-center justify-end gap-2 pt-1 xl:flex">
              {cards.length > 0 && (
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <div className="hidden 2xl:hidden xl:block">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="ui-button-ghost h-8 min-h-8 max-w-[8.5rem] gap-1 px-2 text-xs"
                          aria-label="选择空间"
                          title={projectFilter ? `当前空间：${projectFilter}` : "选择空间"}
                        >
                          <Folder size={13} className="shrink-0" />
                          <span className="truncate">{projectFilter || "全部空间"}</span>
                          <ChevronDown size={12} className="shrink-0 opacity-70" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        <DropdownMenuLabel>空间</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => changeProject("")}>
                          <Folder size={14} />
                          <span className="flex-1">全部空间</span>
                          {!projectFilter && <span className="text-[var(--ui-accent-text)]">当前</span>}
                        </DropdownMenuItem>
                        {projectCounts.map((space) => (
                          <DropdownMenuItem key={space.name} onSelect={() => changeProject(space.name)}>
                            <Folder size={14} />
                            <span className="min-w-0 flex-1 truncate">{space.name}</span>
                            {projectFilter === space.name && <span className="text-[var(--ui-accent-text)]">当前</span>}
                          </DropdownMenuItem>
                        ))}
                        {projectCounts.length === 0 && <DropdownMenuLabel className="font-normal text-[var(--ui-text-subtle)]">暂无空间</DropdownMenuLabel>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={openSpaceManager}>
                          <FolderCog size={14} /> 空间管理
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="ui-segment min-h-8 gap-0.5 p-0.5" role="group" aria-label="列表密度">
                    <button
                      type="button"
                      onClick={() => changeDensity("comfortable")}
                      aria-pressed={density === "comfortable"}
                      title="舒适视图"
                      className={density === "comfortable" ? "ui-segment-item ui-segment-item-active h-7 w-7 px-0" : "ui-segment-item h-7 w-7 px-0"}
                    >
                      <Rows3 size={14} />
                      <span className="sr-only">舒适视图</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => changeDensity("compact")}
                      aria-pressed={density === "compact"}
                      title="紧凑视图"
                      className={density === "compact" ? "ui-segment-item ui-segment-item-active h-7 w-7 px-0" : "ui-segment-item h-7 w-7 px-0"}
                    >
                      <LayoutList size={14} />
                      <span className="sr-only">紧凑视图</span>
                    </button>
                  </div>
                  <Select value={sort} onValueChange={changeSort}>
                    <SelectTrigger className="h-8 w-auto min-w-[100px] justify-between gap-1 rounded-lg px-2 py-0 text-left text-xs font-medium" aria-label="卡片排序">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end" className="min-w-[124px]">
                      {sortOptions.map(([value, label]) => <SelectItem key={value} value={value} className="justify-start px-2 pr-8 text-xs">{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <label className="ui-button-ghost h-8 min-h-8 gap-1.5 px-2 text-xs">
                    <TriStateCheckbox
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected && !allVisibleSelected}
                      onChange={selectAllVisible}
                      aria-label={allVisibleSelected ? "取消选择当前列表" : "选择当前列表"}
                      className="h-4 w-4 rounded border-[var(--ui-border-strong)] accent-[var(--ui-accent-solid)] focus:ring-2 focus:ring-[var(--ui-focus)]/30"
                    />
                    <span>{allVisibleSelected ? "取消全选" : someVisibleSelected ? "部分选中" : "全选当前列表"}</span>
                  </label>
                  <button type="button" onClick={invertVisibleSelection} className="ui-button-ghost h-8 min-h-8 px-2 text-xs">
                    反选
                  </button>
                </div>
              )}
            </div>
            {cards.length > 0 && (
              <div className="mt-2 grid gap-2 xl:hidden">
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Select value={sort} onValueChange={changeSort}>
                    <SelectTrigger className="h-11 min-h-11 w-full min-w-0 justify-between gap-2 rounded-xl px-3 py-0 text-left text-xs font-medium" aria-label="卡片排序">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" className="min-w-[160px]">
                      {sortOptions.map(([value, label]) => <SelectItem key={value} value={value} className="justify-start px-2 pr-8 text-xs">{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <label className="ui-button-ghost h-11 min-h-11 min-w-0 max-w-[8.5rem] gap-1.5 px-3 text-xs">
                    <TriStateCheckbox
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected && !allVisibleSelected}
                      onChange={selectAllVisible}
                      aria-label={allVisibleSelected ? "取消选择当前列表" : "选择当前列表"}
                      className="h-5 w-5 shrink-0 rounded border-[var(--ui-border-strong)] accent-[var(--ui-accent-solid)] focus:ring-2 focus:ring-[var(--ui-focus)]/30"
                    />
                    <span className="truncate">{allVisibleSelected ? "取消全选" : someVisibleSelected ? "部分选中" : "全选当前"}</span>
                  </label>
                </div>
                <div className="flex min-h-7 items-center justify-between gap-2 px-1">
                  <span className="min-w-0 truncate text-[11px] leading-4 text-[var(--ui-text-subtle)]">
                    {visibleSelectedCount > 0 ? `已选 ${visibleSelectedCount} 张` : "点击卡片打开详情 · 勾选可批量处理"}
                  </span>
                  <button type="button" onClick={invertVisibleSelection} className="ui-button-ghost h-8 min-h-8 shrink-0 px-2 text-xs">
                    反选
                  </button>
                </div>
              </div>
            )}
            {selectedIds.length > 0 && (
              <div role="toolbar" aria-label="知识卡片批量操作" className="ui-status-accent ui-mobile-fixed-toolbar mt-1 flex flex-col gap-2 rounded-xl px-2.5 py-2 shadow-md max-xl:fixed max-xl:inset-x-3 max-xl:z-30 max-xl:mx-auto max-xl:max-w-xl xl:shadow-none">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                  <span className="text-xs font-semibold text-[var(--ui-accent-text)]">
                    已选 {selectedIds.length} 张
                    {hiddenSelectedCount > 0 ? ` · 当前列表可见 ${visibleSelectedCount} 张` : " · 当前列表"}
                  </span>
                  <div className="grid grid-cols-2 gap-1.5 xl:flex xl:flex-wrap xl:items-center xl:justify-end xl:gap-1">
                    <button
                      type="button"
                      onClick={() => updateStatus("confirmed", selectedIds.filter((id) => cards.some((card) => card.id === id && card.status === "draft")))}
                      disabled={saving || selectedDraftCount === 0}
                      title={selectedDraftCount > 0 ? "确认选中的草稿并沉淀入库" : "当前选择中没有待沉淀草稿"}
                      className="ui-button-success h-10 min-h-10 min-w-0 gap-1 whitespace-nowrap px-2 text-xs xl:h-8 xl:min-h-8"
                    >
                      <CheckCircle2 size={13} className="shrink-0" /> <span className="truncate">一键沉淀{selectedDraftCount > 0 ? " " + selectedDraftCount : ""}</span>
                    </button>
                    <button type="button" onClick={() => setMobileBatchOpen(true)} disabled={saving} className="ui-button-ghost h-10 min-h-10 min-w-0 gap-1 px-2 text-xs font-semibold xl:hidden">
                      批量操作 <MoreHorizontal size={14} />
                    </button>
                    <div className="hidden xl:block">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" disabled={saving} className="ui-button-ghost h-8 min-h-8 gap-1 px-2 text-xs font-semibold">
                            批量操作 <ChevronDown size={13} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel>修改选中卡片</DropdownMenuLabel>
                          <DropdownMenuItem onSelect={() => toggleBatchMode("tag")}>添加标签</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => toggleBatchMode("remove_tag")}>移除标签</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => toggleBatchMode("add_project")}>加入空间</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => toggleBatchMode("move_project")}>移动到空间</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => toggleBatchMode("remove_project")}>移出空间</DropdownMenuItem>
                          <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void deleteCards(selectedIds)} className="text-[var(--ui-danger-text)] focus:bg-[var(--ui-danger-surface)] focus:text-[var(--ui-danger-text)]">
                            批量删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <button type="button" onClick={clearSelection} className="ui-button-ghost h-10 min-h-10 min-w-0 px-2 text-xs xl:h-8 xl:min-h-8">
                      清空
                    </button>
                    {hiddenSelectedCount > 0 && (
                      <button type="button" onClick={clearHiddenSelection} className="ui-button-ghost col-span-2 h-10 min-h-10 min-w-0 px-2 text-xs xl:col-span-1 xl:h-8 xl:min-h-8">
                        清除不可见项
                      </button>
                    )}
                  </div>
                </div>
                {batchMode && (
                  <div className="ui-panel-muted hidden rounded-lg p-2 xl:block">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[var(--ui-accent-text)]">
                        {batchMode === "tag" ? "添加标签" : batchMode === "remove_tag" ? "移除标签" : batchMode === "add_project" ? "加入空间" : batchMode === "move_project" ? "移动到空间" : "移出空间"}
                      </span>
                      <button type="button" onClick={() => { setBatchMode(""); setBatchValue(""); }} className="ui-icon-button h-7 w-7" aria-label="关闭批量编辑">
                        <X size={13} />
                      </button>
                    </div>
                    <div className="flex w-full items-center gap-1.5">
                      {batchMode === "tag" || batchMode === "remove_tag" ? (
                        <input
                          value={batchValue}
                          onChange={(e) => setBatchValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyBatch(); } }}
                          placeholder="标签，逗号分隔多个"
                          aria-label={batchMode === "tag" ? "要添加的标签" : "要移除的标签"}
                          className="ui-field h-9 min-w-0 flex-1 rounded-lg px-2.5 text-xs"
                          autoFocus
                        />
                      ) : (
                        <SpaceAutocomplete
                          spaces={projectCounts}
                          value={batchValue}
                          onChange={setBatchValue}
                          onEnter={() => void applyBatch()}
                          placeholder={batchMode === "move_project" ? "选择目标空间" : "选择空间"}
                          ariaLabel={batchMode === "move_project" ? "批量移动的目标空间" : "批量操作的空间"}
                          inputClassName="ui-field h-9 pl-8 text-xs"
                          containerClassName="min-w-0 flex-1"
                          autoFocus
                        />
                      )}
                      <button type="button" onClick={() => void applyBatch()} disabled={saving || !batchValue.trim()} className="ui-button-primary h-9 shrink-0 px-3 text-xs">
                        应用
                      </button>
                    </div>
                    {batchMode === "move_project" && <p className="mt-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">移动会替换卡片已有空间；目标空间不存在时会自动创建。</p>}
                  </div>
                )}
              </div>
            )}
          </div>
          {loading && cards.length === 0 ? (
            <KnowledgeListSkeleton />
          ) : cards.length === 0 ? (
            <div className="p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
              <div className="ui-panel-muted rounded-xl border-dashed p-4 text-center">
                <span className="ui-status-muted mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
                  <FileText size={22} />
                </span>
                <p className="mt-3 text-sm font-medium text-[var(--ui-text)]">{emptyStateTitle}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">{emptyStateDescription}</p>
                {emptyStateAction && (
                  <button type="button" onClick={emptyStateAction.onClick} className="ui-button-primary mt-4 h-9 px-3 text-xs">
                    {emptyStateAction.label}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div
              ref={listParent}
              aria-busy={loading}
              className={["relative min-w-0 pr-1 pb-[calc(var(--ui-mobile-nav-total-height)+1rem)] xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pb-0", density === "comfortable" ? "space-y-1.5" : "space-y-1", loading ? "opacity-60 transition-opacity" : ""].join(" ")}
            >
              {loading && (
                <div className="ui-status-accent sticky top-0 z-10 mb-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium shadow-xs backdrop-blur" role="status" aria-live="polite">
                  <LoaderCircle size={12} className="animate-spin" /> 更新列表中...
                </div>
              )}
              {sortedCards.map((card) => (
                <div
                  key={card.id}
                  data-state={selectedIds.includes(card.id) ? "selected" : selectedId === card.id ? "active" : "idle"}
                  data-active={selectedId === card.id ? "true" : undefined}
                  className={[
                    "knowledge-card-row group relative flex w-full min-w-0 items-start gap-1.5",
                    density === "comfortable" ? "rounded-xl p-1.5" : "rounded-lg p-1",
                  ].join(" ")}
                >
                  <label
                    className={[
                      "relative z-[1] mt-0.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors xl:h-8 xl:w-8 xl:rounded-md",
                      selectedIds.includes(card.id) ? "ui-status-accent" : "hover:bg-[var(--ui-surface-hover)]",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(card.id)}
                      onChange={() => toggleSelected(card.id)}
                      aria-label={`${selectedIds.includes(card.id) ? "取消选择" : "选择"}：${card.title}`}
                      className="h-5 w-5 cursor-pointer rounded border-[var(--ui-border-strong)] accent-[var(--ui-accent-solid)] focus:ring-2 focus:ring-[var(--ui-focus)]/40 xl:h-4 xl:w-4"
                    />
                  </label>
                  <Link
                    to="/knowledge/$cardId"
                    params={{ cardId: card.id }}
                    search={{
                      q: query || undefined,
                      project: projectFilter || undefined,
                      tag: tagFilter || undefined,
                      status: activeStatus,
                      type: typeFilter || undefined,
                      sort: sort === "updated" ? undefined : sort,
                      usage: usageFilter || undefined,
                      quality: qualityFilter || undefined,
                      page: page > 1 ? page : undefined,
                      view: "detail",
                    }}
                    onClick={(event) => {
                      if (!onOpenCard || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      openCard(card);
                    }}
                    className={[
                      "min-w-0 flex-1 rounded-lg text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-focus)]/30",
                      density === "comfortable" ? "px-2 py-2" : "px-1.5 py-1.5",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 line-clamp-2 break-words text-sm font-semibold leading-5 text-[var(--ui-text)] xl:truncate">{card.title}</span>
                      <ChevronRight size={16} className="mt-0.5 shrink-0 text-[var(--ui-text-disabled)] group-hover:text-[var(--ui-text-subtle)]" />
                    </div>
                    <div className={[
                      "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-5 text-[var(--ui-text-subtle)]",
                      density === "comfortable" ? "mt-1.5" : "mt-1",
                    ].join(" ")}>
                      <span>{typeLabels[card.card_type]}</span>
                      {card.source_date && <span className="knowledge-source-line">{card.source_date} · {card.source_review_id ? "AI 复盘" : "每日记录"}</span>}
                      {card.usage_count ? `· 用过 ${card.usage_count} 次` : ""}
                      {card.tags.slice(0, density === "comfortable" ? 4 : 2).map((tag) => <span key={tag}>#{tag}</span>)}
                    </div>
                    {density === "comfortable" && card.content.trim() && (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ui-text-muted)] xl:line-clamp-1">{card.content}</p>
                    )}
                  </Link>
                  {selectedIds.length === 0 && (
                    <div className="flex shrink-0 items-center self-stretch opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="ui-icon-button h-10 w-10 xl:h-8 xl:w-8"
                            aria-label={`卡片操作：${card.title}`}
                            title="卡片操作"
                          >
                            <MoreHorizontal size={15} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuLabel>卡片操作</DropdownMenuLabel>
                          <DropdownMenuItem onSelect={() => void updateStatus(card.status === "draft" ? "confirmed" : "outdated", [card.id])}>
                            {card.status === "draft" ? "确认沉淀" : card.status === "outdated" ? "恢复卡片" : "标记为过时"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void deleteCards([card.id])} className="text-[var(--ui-danger-text)] focus:bg-[var(--ui-danger-surface)] focus:text-[var(--ui-danger-text)]">
                            移入回收站
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {totalCards > 0 && (
            <div className="ui-soft-divider mt-2 flex shrink-0 items-center justify-between gap-2 border-t px-2 pt-2">
              <div className="min-w-0 truncate text-[11px] text-[var(--ui-text-subtle)]">
                共 {totalCards} 张 · 第 {page}/{pageCount} 页
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => changePage(page - 1)}
                  disabled={page <= 1 || loading}
                  className="ui-icon-button h-8 w-8 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="上一页"
                  title="上一页"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => changePage(page + 1)}
                  disabled={!hasMore || page >= pageCount || loading}
                  className="ui-icon-button h-8 w-8 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="下一页"
                  title="下一页"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </section>

        <section aria-label="知识卡片编辑" className={["knowledge-inspector ui-panel flex scroll-pb-[calc(var(--ui-mobile-nav-total-height)+5rem)] flex-col overflow-visible p-4 max-xl:pb-[calc(var(--ui-mobile-nav-total-height)+5rem)] xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pb-4", mobileView === "detail" ? "" : "hidden", "xl:flex"].join(" ")}>
          <div className="mb-3 flex items-center gap-2 xl:hidden">
            <button type="button" onClick={() => void closeMobileDetail()} className="ui-button-ghost h-10 px-2.5 text-sm">
              <ArrowLeft size={16} /> 知识卡片
            </button>
            <span className="text-xs text-[var(--ui-text-subtle)]">详情与编辑</span>
          </div>
          {projectFilter && (
            <SpaceOverview
              name={projectFilter}
              space={selectedSpace}
              articles={spaceArticles}
              loading={spaceArticlesLoading}
              error={spaceArticlesError}
              onEditDate={onEditDate}
            />
          )}
          <div className="knowledge-inspector-header mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-base font-bold tracking-[-0.02em] text-[var(--ui-text)]">{selectedId ? "核验知识卡片" : "新建知识卡片"}</h3>
                {saveState === "saving" && <span className="inline-flex items-center gap-1 text-xs text-[var(--ui-accent-text)]" role="status" aria-live="polite"><LoaderCircle size={12} className="animate-spin" /> 正在保存</span>}
                {saveState === "saved" && <span className="text-xs text-[var(--ui-success-text)]" role="status" aria-live="polite">已保存</span>}
                {saveState === "error" && (
                  <button
                    type="button"
                    onClick={() => void retrySaveDraft()}
                    disabled={saving || !dirty || !selectedId}
                    className="text-xs font-semibold text-[var(--ui-danger-text)] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    保存失败 · 重试
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-[var(--ui-text-subtle)]">
                {selectedCard?.source_date || draft.source_date ? `${selectedCard?.source_date || draft.source_date} · ${currentSourceType}` : "来源用于回溯依据"}
                {selectedCard?.usage_count ? ` · 用过 ${selectedCard.usage_count} 次` : ""}
                {selectedCard?.last_used_at ? ` · 最近使用 ${selectedCard.last_used_at}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 max-xl:hidden">
              {selectedId && draft.status === "draft" && (
                <button type="button" onClick={() => updateStatus("confirmed")} disabled={saving} className="ui-button-primary">
                  <CheckCircle2 size={14} /> 确认沉淀
                </button>
              )}
              {selectedId && (
                <>
                  <button type="button" onClick={() => updateStatus(draft.status === "outdated" ? "confirmed" : "outdated")} disabled={saving} className="ui-button-secondary">
                    <MoreHorizontal size={14} /> {draft.status === "outdated" ? "恢复" : "过时"}
                  </button>
                  <button type="button" onClick={() => deleteCards()} disabled={saving} className="ui-button-danger">
                    <Trash2 size={14} /> 删除
                  </button>
                </>
              )}
              {!selectedId && (
                <button type="button" onClick={saveNewCard} disabled={saving} className="ui-button-primary">
                  <Plus size={14} /> 创建
                </button>
              )}
            </div>
          </div>

          <div className="knowledge-verification-rail mb-5" data-stage={verificationStage} aria-label="知识沉淀流程">
            <div className="knowledge-verification-step" data-complete={verificationStageIndex > 1 ? "true" : undefined} data-active={verificationStage === "draft" ? "true" : undefined}>
              <span className="knowledge-verification-icon"><BookMarked size={14} /></span>
              <span className="knowledge-verification-copy"><strong>起草</strong><small>写清结论</small></span>
            </div>
            <span className="knowledge-verification-connector" aria-hidden="true" />
            <div className="knowledge-verification-step" data-complete={verificationStageIndex > 2 ? "true" : undefined} data-active={verificationStage === "source" ? "true" : undefined}>
              <span className="knowledge-verification-icon"><ShieldCheck size={14} /></span>
              <span className="knowledge-verification-copy"><strong>核验</strong><small>对照来源</small></span>
            </div>
            <span className="knowledge-verification-connector" aria-hidden="true" />
            <div className="knowledge-verification-step" data-complete={verificationStageIndex > 3 ? "true" : undefined} data-active={verificationStage === "confirmed" ? "true" : undefined}>
              <span className="knowledge-verification-icon"><CheckCircle2 size={14} /></span>
              <span className="knowledge-verification-copy"><strong>沉淀</strong><small>进入复习</small></span>
            </div>
            <span className="knowledge-verification-caption">
              {verificationStage === "confirmed" ? "已确认，可用于复习" : verificationStage === "source" ? "已有来源，确认前再看一眼" : "先写内容，再补证据"}
            </span>
          </div>

          {validationEntries.length > 0 && (
            <div
              ref={validationSummaryRef}
              id="knowledge-validation-summary"
              tabIndex={-1}
              role="alert"
              aria-labelledby="knowledge-validation-summary-title"
              className="ui-alert-bad mb-4 outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/50"
            >
              <div id="knowledge-validation-summary-title" className="font-semibold">
                提交前需要处理 {validationEntries.length} 项
              </div>
              <ul className="mt-1.5 space-y-1 text-xs">
                {validationEntries.map(([field, message]) => (
                  <li key={field}>
                    <a
                      href={`#${validationFieldIds[field]}`}
                      onClick={(event) => {
                        event.preventDefault();
                        focusValidationField(field);
                      }}
                      className="underline decoration-[var(--ui-danger-border)] underline-offset-2 hover:decoration-current"
                    >
                      {validationFieldLabels[field]}：{message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="knowledge-editor-fields grid gap-4">
            <div>
              <label htmlFor="knowledge-card-title" className="knowledge-field-label mb-1.5 block">知识标题</label>
              <input
                id="knowledge-card-title"
                value={draft.title}
                onChange={(e) => updateDraft({ title: e.target.value })}
                placeholder="用一句话回答：这条知识是什么？"
                aria-required="true"
                aria-invalid={!!fieldErrors.title}
                aria-describedby={["knowledge-card-title-help", fieldErrors.title ? validationErrorIds.title : ""].filter(Boolean).join(" ")}
                className="knowledge-title-field ui-field h-11"
              />
              <p id="knowledge-card-title-help" className="mt-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">一句话说清这条知识解决什么问题。</p>
              {fieldErrors.title && <p id={validationErrorIds.title} className="mt-1.5 text-xs font-medium text-[var(--ui-danger-text)]" role="alert">{fieldErrors.title}</p>}
            </div>
            <div>
              <div id="knowledge-card-content-label" className="knowledge-field-label mb-1.5">可复习正文</div>
              <div id="knowledge-card-content" className="knowledge-body-editor ui-editor-surface overflow-hidden" role="group" tabIndex={-1} aria-labelledby="knowledge-card-content-label">
                <CodeMirror
                  value={draft.content}
                  onChange={(value) => updateDraft({ content: value })}
                  extensions={[markdown(), EditorView.lineWrapping]}
                  placeholder="先写清可复习的结论，再补充判断依据或方法..."
                  onCreateEditor={(view) => {
                    knowledgeEditorRef.current = view;
                    syncEditorAccessibility();
                  }}
                  theme={dark ? "dark" : "light"}
                  height="220px"
                  basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                />
              </div>
              <p id="knowledge-card-content-help" className="mt-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">先写可复习的结论，再补充判断依据或方法。</p>
              {fieldErrors.content && <p id={validationErrorIds.content} className="mt-1.5 text-xs font-medium text-[var(--ui-danger-text)]" role="alert">{fieldErrors.content}</p>}
            </div>

            <div className="ui-panel-muted rounded-xl p-3">
              <button
                type="button"
                onClick={() => setOrganizeOpen((open) => !open)}
                aria-expanded={organizeOpen}
                aria-controls="knowledge-card-organization"
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-[var(--ui-text)]">整理卡片</span>
                    <span className="mt-1 block truncate text-[11px] text-[var(--ui-text-subtle)]">
                    {organizeSummary}
                    </span>
                </span>
                <ChevronDown size={15} className={`shrink-0 transition-transform ${organizeOpen ? "rotate-180" : ""}`} />
              </button>
              {organizeOpen && (
                <div id="knowledge-card-organization" className="mt-3 grid gap-4 border-t border-[var(--ui-border)] pt-3">
                  <div className="grid gap-3 2xl:grid-cols-[1fr_auto]">
                    <Picker
                      label="类型"
                      value={draft.card_type}
                      options={typeOptions}
                      primaryValues={["fact", "method", "concept", "principle"]}
                      onChange={(value) => updateDraft({ card_type: value as KnowledgeCardType })}
                    />
                    {selectedId ? (
                      <Picker label="状态" value={draft.status} options={statusOptions} onChange={(value) => updateDraft({ status: value as KnowledgeCardStatus })} />
                    ) : (
                      <div className="min-w-0">
                        <div className="ui-section-kicker mb-1.5">状态</div>
                        <div className="ui-status-accent inline-flex min-h-8 items-center rounded-lg px-3 text-xs font-semibold">待确认</div>
                        <p className="mt-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">新卡会先保存为草稿，补充来源后再确认沉淀。</p>
                      </div>
                    )}
                  </div>
              <div>
              <label htmlFor="knowledge-card-tags" className="ui-section-kicker mb-1.5 block">标签</label>
              <div className="ui-token-input">
                {parsedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="ui-chip border-[var(--ui-selected-border)] bg-[var(--ui-surface-selected)] text-[var(--ui-accent-text)] hover:bg-[var(--ui-surface-hover)]"
                    title="点击移除标签"
                    aria-label={`移除标签：${tag}`}
                  >
                    #{tag} <X size={12} />
                  </button>
                ))}
                <input
                  id="knowledge-card-tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    }
                    if (e.key === "Backspace" && !tagInput && parsedTags.length) {
                      removeTag(parsedTags[parsedTags.length - 1]);
                    }
                  }}
                  onBlur={() => addTag()}
                  placeholder={parsedTags.length ? "添加标签" : "添加标签"}
                  className="h-8 min-w-[120px] flex-1 border-0 bg-transparent px-1 text-sm text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-subtle)]"
                />
              </div>
              {tagSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--ui-text-subtle)]">建议</span>
                  {tagSuggestions.map(({ tag }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addTag(tag)}
                      className="ui-chip h-7 px-2 py-0.5 text-[11px]"
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
                  </div>
              <div>
              <div className="ui-section-kicker mb-1.5">空间（主题或项目）</div>
              <div className="ui-token-input">
                {parsedProjects.map((project) => (
                  <button
                    key={project}
                    type="button"
                    onClick={() => removeProject(project)}
                    className="ui-chip border-[var(--ui-selected-border)] bg-[var(--ui-surface-selected)] text-[var(--ui-accent-text)] hover:bg-[var(--ui-surface-hover)]"
                    title="点击移除空间"
                    aria-label={`移除空间：${project}`}
                  >
                    <Folder size={12} /> {project} <X size={12} />
                  </button>
                ))}
                <SpaceAutocomplete
                  spaces={projectCounts}
                  value={projectInput}
                  onChange={setProjectInput}
                  onSelect={(name) => addProject(name)}
                  onEnter={addProject}
                  onComma={addProject}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && !projectInput && parsedProjects.length) {
                      removeProject(parsedProjects[parsedProjects.length - 1]);
                    }
                  }}
                  onBlurCommit={addProject}
                  placeholder="选择或输入空间"
                  ariaLabel="卡片所属空间"
                  inputClassName="h-8 min-w-[120px] flex-1 border-0 bg-transparent px-1 pr-7 text-sm text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-subtle)]"
                  containerClassName="min-w-[140px] flex-1"
                  showIcon={false}
                />
              </div>
                  </div>
                  <div>
                    <div className="ui-section-kicker mb-1.5">关联卡片</div>
                    <Command shouldFilter={false} className="relative">
              <Command.Input
                value={relatedQuery}
                onValueChange={setRelatedQuery}
                placeholder="搜索并添加关联卡片…"
                aria-label="关联卡片"
                className="ui-field h-10 w-full"
              />
              {relatedQuery.trim() && (
                <Command.List className="ui-floating-surface absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-xl p-1">
                  <Command.Empty className="px-3 py-2 text-sm text-[var(--ui-text-subtle)]">无匹配卡片</Command.Empty>
                  {relatedCandidates.map((card) => (
                    <Command.Item
                      key={card.id}
                      value={card.title}
                      onSelect={() => {
                        editorGenerationRef.current += 1;
                        setDraftRelatedIds((ids) => (ids.includes(card.id) ? ids : [...ids, card.id]));
                        setRelatedQuery("");
                        setDirty(true);
                        setSaveState("idle");
                      }}
                      className="ui-command-item flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm"
                    >
                      <span className="truncate">{card.title}</span>
                    </Command.Item>
                  ))}
                </Command.List>
              )}
                    </Command>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="knowledge-reading-grid mt-5 grid items-stretch gap-4 xl:flex-1 2xl:grid-cols-[minmax(0,1fr)_minmax(360px,400px)]">
            <div className="flex min-w-0 flex-col">
              <div className="knowledge-field-label mb-2">复习预览</div>
              <div className="knowledge-preview-panel ui-panel-muted min-h-[280px] flex-1 p-5">
                {draft.content ? (
                  <MarkdownContent content={draft.content} onWikiLink={onWikiLink} />
                ) : (
                  <KnowledgeEmptyPreview />
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-col">
              <div className="knowledge-source-heading mb-2 flex items-center justify-between gap-2">
                <div className="knowledge-field-label flex items-center gap-1.5">
                  <ShieldCheck size={14} /> 核验来源
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="knowledge-source-state" data-state={sourceError ? "error" : hasKnowledgeSource(draft) ? "linked" : "empty"}>
                    {sourceError ? "加载失败" : hasKnowledgeSource(draft) ? "已有证据" : "未核验"}
                  </span>
                  {hasSourceReference && (
                    <button type="button" onClick={openSource} disabled={sourceLoading} className="ui-button-ghost h-7 min-h-7 gap-1 px-2 text-xs font-semibold text-[var(--ui-accent-text)] disabled:cursor-wait disabled:opacity-60">
                      <ExternalLink size={12} /> {sourceActionLabel}
                    </button>
                  )}
                </div>
              </div>
              <div className="knowledge-source-panel ui-editor-surface flex min-h-[280px] flex-1 flex-col overflow-hidden" data-source-state={sourceError ? "error" : hasKnowledgeSource(draft) ? "linked" : "empty"} aria-busy={sourceLoading}>
                <div className="knowledge-source-titlebar ui-soft-divider flex items-center gap-2 border-b px-4 py-3" role="status" aria-live="polite">
                  <FileText size={13} className="shrink-0 text-[var(--ui-text-subtle)]" />
                  <div className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--ui-text-muted)]">
                    {sourceLoading ? "加载来源..." : sourceError ? "来源暂时无法加载" : sourceArticle?.title || sourceReview?.title || (draft.source_date ? `${draft.source_date} · ${currentSourceType}` : "暂无来源")}
                  </div>
                </div>
                {sourceError && (
                  <div className="ui-alert-warn m-3 mb-0 flex items-start justify-between gap-3 text-xs leading-5" role="alert">
                    <span className="min-w-0">{sourceError}。仍可补充来源片段，或稍后重试加载原文。</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {sourceAuthError && (
                        <button
                          type="button"
                          onClick={openConnectionSettings}
                          className="ui-button-ghost h-7 min-h-7 px-2 text-[11px]"
                        >
                          连接设置
                        </button>
                      )}
                      <button type="button" onClick={retrySourceLoad} disabled={sourceLoading} className="ui-button-ghost h-7 min-h-7 px-2 text-[11px]">
                        {sourceLoading ? "重试中..." : "重试加载"}
                      </button>
                    </span>
                  </div>
                )}
                {fieldErrors.source && (
                  <p id={validationErrorIds.source} className="ui-alert-bad m-3 mb-0 text-xs leading-5" role="alert">
                    {fieldErrors.source}
                  </p>
                )}
                <div className="knowledge-source-excerpt px-4 pt-4">
                  <label htmlFor="knowledge-source-excerpt" className="knowledge-field-label mb-1.5 block">证据片段</label>
                  <p id="knowledge-source-excerpt-help" className="mb-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">粘贴能直接支撑正文的连续片段，方便以后复核。</p>
                  <textarea
                    id="knowledge-source-excerpt"
                    aria-label="支撑知识卡片的来源片段"
                    aria-invalid={!!fieldErrors.source}
                    aria-describedby={["knowledge-source-excerpt-help", fieldErrors.source ? validationErrorIds.source : ""].filter(Boolean).join(" ")}
                    value={draft.source_excerpt}
                    onChange={(e) => updateDraft({ source_excerpt: e.target.value })}
                    placeholder="粘贴来源片段"
                    className="min-h-[120px] w-full resize-none border-0 bg-transparent px-0 py-1 text-xs leading-5 text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-subtle)]"
                  />
                </div>
                <div className="ui-soft-divider grid gap-2 border-t p-3 pt-2">
                  <label className="ui-section-kicker" htmlFor="knowledge-source-date">来源日期</label>
                  <input
                    id="knowledge-source-date"
                    type="date"
                    value={draft.source_date}
                    onChange={(e) => updateDraft({ source_date: e.target.value })}
                    aria-invalid={!!fieldErrors.source}
                    aria-describedby={["knowledge-source-date-help", fieldErrors.source ? validationErrorIds.source : ""].filter(Boolean).join(" ")}
                    className="ui-field h-9 text-xs"
                  />
                  <p id="knowledge-source-date-help" className="text-[11px] leading-4 text-[var(--ui-text-subtle)]">可填写原文日期，格式为 YYYY-MM-DD。</p>
                  <label className="ui-section-kicker" htmlFor="knowledge-source-id">来源 ID（只读）</label>
                  <p id="knowledge-source-id-help" className="text-[11px] leading-4 text-[var(--ui-text-subtle)]">由来源记录自动带入，不能手动编辑。</p>
                  <input
                    id="knowledge-source-id"
                    value={draft.source_article_id || draft.source_review_id}
                    readOnly
                    placeholder="保存后自动关联"
                    aria-describedby="knowledge-source-id-help"
                    className="ui-field h-9 text-xs text-[var(--ui-text-muted)]"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="knowledge-review-stack">
            {selectedCard && (
              <ReviewItemsPanel
                cardId={selectedCard.id}
                cardStatus={draft.status}
                contentVersion={selectedCard.content_version}
              />
            )}

          {selectedCard && (relatedChips.length > 0 || reviewHistory.length > 1) && (
            <div className="mt-4 grid gap-3">
              {relatedChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="ui-section-kicker">关联</span>
                  {relatedChips.map((chip) => (
                    <span
                      key={chip.id}
                      className="ui-status-accent inline-flex max-w-[220px] items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
                    >
                      <button type="button" onClick={() => openCard(chip)} className="truncate transition-colors hover:underline">
                        {chip.title}
                      </button>
                      {draftRelatedIds.includes(chip.id) ? (
                        <button
                          type="button"
                          onClick={() => {
                            editorGenerationRef.current += 1;
                            setDraftRelatedIds((ids) => ids.filter((id) => id !== chip.id));
                            setDirty(true);
                            setSaveState("idle");
                          }}
                          className="text-[var(--ui-accent-text)] opacity-50 transition-opacity hover:opacity-100"
                          title="移除关联"
                          aria-label={`移除关联：${chip.title}`}
                        >
                          <X size={11} />
                        </button>
                      ) : (
                        <span
                          className="shrink-0 text-[var(--ui-accent-text)] opacity-60"
                          title="这是来自另一张卡片的关联，请打开对方卡片后移除"
                          aria-label="来自另一张卡片的关联"
                        >
                          ↔
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {reviewHistory.length > 1 && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="ui-section-kicker">复习间隔趋势</span>
                    <span className="text-[11px] text-[var(--ui-text-subtle)]">最近 {reviewHistory[reviewHistory.length - 1].interval_days.toFixed(0)} 天</span>
                  </div>
                  <IntervalChart history={reviewHistory} />
                </div>
              )}
            </div>
          )}

          {duplicateHint && (
            <div className="mt-3 ui-alert-warn" role="status" aria-live="polite">
              {duplicateHint}
            </div>
          )}
            {notice && validationEntries.length === 0 && (
              <div
                className={["mt-3", noticeTone === "good" ? "ui-alert-good" : noticeTone === "bad" ? "ui-alert-bad" : "ui-alert-warn"].join(" ")}
                role={noticeTone === "bad" ? "alert" : "status"}
                aria-live="polite"
              >
                {notice}
              </div>
            )}
          </div>

          <div className="ui-mobile-editor-actions relative z-20 mt-5 flex flex-wrap gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)]/95 p-2 shadow-md backdrop-blur-xl max-xl:fixed max-xl:inset-x-3 max-xl:bottom-[calc(var(--ui-mobile-nav-total-height)+0.5rem)] max-xl:mx-auto max-xl:max-w-xl xl:hidden">
            {!selectedId ? (
              <button type="button" onClick={saveNewCard} disabled={saving} className="ui-button-primary min-h-11 flex-1 px-3">
                <Plus size={14} /> 创建草稿
              </button>
            ) : (
              <>
                {draft.status === "draft" && (
                  <button type="button" onClick={() => updateStatus("confirmed")} disabled={saving} className="ui-button-primary min-h-11 flex-1 px-3">
                    <CheckCircle2 size={14} /> 确认沉淀
                  </button>
                )}
                <button type="button" onClick={() => void deleteCards()} disabled={saving} className="ui-button-danger min-h-11 px-3">
                  <Trash2 size={14} /> 删除
                </button>
              </>
            )}
          </div>
        </section>
      </div>
      {sourceDetailOpen && sourceArticle && (
        <ArticleDetail
          article={sourceArticle}
          highlight={draft.source_excerpt || selectedCard?.source_excerpt || ""}
          onClose={() => setSourceDetailOpen(false)}
          onEdit={editSourceArticle}
        />
      )}
      {sourceDetailOpen && sourceReview && (
        <ReviewSourceDetail
          review={sourceReview}
          highlight={draft.source_excerpt || selectedCard?.source_excerpt || ""}
          onClose={() => setSourceDetailOpen(false)}
          onOpenReview={() => {
            setSourceDetailOpen(false);
            onNavigate("reviews");
          }}
        />
      )}
      <SpaceManagerDialog
        open={spaceManagerOpen}
        onOpenChange={setSpaceManagerOpen}
        onSpacesChanged={handleSpacesChanged}
      />
      <KnowledgeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        spaces={projectCounts}
        onImported={handleImported}
        onOpenSettings={() => {
          if (typeof window !== "undefined") writeSessionStorage("daily-summary-settings-tab", "ai");
          onNavigate("settings");
        }}
      />
      {dialog}
    </motion.div>
  );
}

function SpaceOverview({
  name,
  space,
  articles,
  loading,
  error,
  onEditDate,
}: {
  name: string;
  space?: api.KnowledgeProject;
  articles: api.ArticleSummary[];
  loading: boolean;
  error: string;
  onEditDate: (date: string) => void;
}) {
  const kindLabel = space?.kind === "project" ? "项目" : "主题";
  const articleCount = space?.article_count ?? articles.length;
  const cardCount = space?.count ?? 0;
  const totalCount = space?.total_count ?? cardCount + articleCount;

  return (
    <section className="ui-panel-muted mb-4 rounded-xl p-3" aria-label={`${name} 空间概览`}>
      <div className="flex items-start gap-2">
        <span className="ui-status-accent mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <Folder size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--ui-text)]">{name}</h3>
            <span className="ui-chip h-auto px-1.5 py-0.5 text-[10px]">{kindLabel}</span>
            <span className="text-[11px] text-[var(--ui-text-subtle)]">共 {totalCount} 项</span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-[var(--ui-text-subtle)]">
            {space?.description || "每日记录负责捕捉过程，知识卡片负责沉淀可复用结论。"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-[var(--ui-text-subtle)]">
        <span className="ui-chip h-auto px-2 py-0.5">{cardCount} 张知识卡片</span>
        <span className="ui-chip h-auto px-2 py-0.5"><CalendarDays size={11} /> {articleCount} 篇每日记录</span>
      </div>
      <div className="ui-soft-divider mt-3 border-t pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="ui-section-kicker">最近每日记录</span>
          {articles.length > 0 && <span className="text-[10px] text-[var(--ui-text-subtle)]">点击日期编辑</span>}
        </div>
        {loading ? (
          <div className="text-xs text-[var(--ui-text-subtle)]">加载空间记录...</div>
        ) : error ? (
          <div className="text-xs text-[var(--ui-danger-text)]">{error}</div>
        ) : articles.length === 0 ? (
          <div className="text-xs leading-5 text-[var(--ui-text-subtle)]">还没有归入这个空间的每日记录。</div>
        ) : (
          <div className="grid gap-1">
            {articles.map((article) => (
              <button
                key={article.id}
                type="button"
                onClick={() => onEditDate(article.date)}
                className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--ui-surface-hover)]"
              >
                <span className="shrink-0 font-mono text-[10px] text-[var(--ui-accent-text)]">{article.date}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--ui-text)]">{article.title || "（无标题）"}</span>
                <span className="hidden max-w-[38%] truncate text-[10px] text-[var(--ui-text-subtle)] sm:block">{article.preview}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function KnowledgeListSkeleton() {
  return (
    <div className="space-y-2 p-2" aria-label="正在加载知识卡片" role="status">
      {["w-4/5", "w-3/5", "w-11/12", "w-2/3"].map((width, index) => (
        <div key={index} className="ui-panel-muted rounded-lg p-2.5">
          <div className="flex items-center gap-2">
            <div className="ui-skeleton h-4 w-4 rounded" />
            <div className={`ui-skeleton h-3 ${width}`} />
          </div>
          <div className="ui-skeleton mt-2 h-2.5 w-2/5" />
        </div>
      ))}
    </div>
  );
}

function TriStateCheckbox({
  indeterminate = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return <input ref={ref} type="checkbox" {...props} />;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={active ? "ui-filter-button ui-filter-button-active" : "ui-filter-button"}
    >
      {children}
    </button>
  );
}

function KnowledgeEmptyPreview() {
  return (
    <div className="grid gap-3 text-xs leading-5 text-[var(--ui-text-muted)]">
      <p className="flex items-start gap-2">
        <FileText size={14} className="mt-0.5 shrink-0 text-[var(--ui-accent-text)]" />
        <span>用一两段写清楚可复习的结论，避免只写“以后注意”。</span>
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li><span className="font-semibold text-[var(--ui-text)]">事实</span>：记录可由来源片段支撑的内容。</li>
        <li><span className="font-semibold text-[var(--ui-text)]">方法</span>：沉淀步骤、判断顺序或排查清单。</li>
        <li><span className="font-semibold text-[var(--ui-text)]">原则</span>：从多次记录中确认的稳定做法。</li>
      </ul>
    </div>
  );
}

function Picker<T extends string>({
  label,
  value,
  options,
  primaryValues,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[T, string]>;
  primaryValues?: T[];
  onChange: (value: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const primaryOptions = primaryValues
    ? options.filter(([itemValue]) => primaryValues.includes(itemValue))
    : options;
  const selectedOption = options.find(([itemValue]) => itemValue === value);
  const visibleOptions = primaryValues && !showAll
    ? selectedOption && !primaryOptions.some(([itemValue]) => itemValue === value)
      ? [selectedOption, ...primaryOptions]
      : primaryOptions
    : options;
  const hasMoreOptions = !!primaryValues && options.length > primaryOptions.length;

  return (
    <div className="min-w-0" role="group" aria-labelledby={`knowledge-picker-${label}`}>
      <div id={`knowledge-picker-${label}`} className="ui-section-kicker mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {visibleOptions.map(([itemValue, itemLabel]) => (
          <button
            key={itemValue}
            type="button"
            onClick={() => onChange(itemValue)}
            aria-pressed={value === itemValue}
            className={value === itemValue ? "ui-filter-button ui-filter-button-active" : "ui-filter-button"}
          >
            {itemLabel}
          </button>
        ))}
        {hasMoreOptions && (
          <button
            type="button"
            onClick={() => setShowAll((open) => !open)}
            aria-expanded={showAll}
            className="ui-filter-button text-[var(--ui-accent-text)]"
          >
            {showAll ? "收起其他类型" : `更多类型（${options.length - primaryOptions.length}）`}
          </button>
        )}
      </div>
    </div>
  );
}

function IntervalChart({ history }: { history: api.ReviewHistoryEntry[] }) {
  if (history.length < 2) return null;
  const data = history.map((entry, index) => ({
    index: index + 1,
    days: entry.interval_days,
  }));
  return (
    <div className="h-16">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid rgba(0,0,0,0.08)", fontSize: 12 }}
            formatter={(value) => [`${Number(value).toFixed(0)} 天`, "间隔"]}
            labelFormatter={(label) => `第 ${label} 次复习`}
          />
          <Line type="monotone" dataKey="days" stroke="var(--ui-accent-solid)" strokeWidth={1.5} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
