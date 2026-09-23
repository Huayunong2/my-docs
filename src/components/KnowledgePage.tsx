import { useEffect, useMemo, useRef, useState } from "react";
import KnowledgeLibrary, { type LibraryFilter } from "./knowledge/KnowledgeLibrary";
import KnowledgeReader from "./knowledge/KnowledgeReader";
import "./knowledge/knowledge.css";
import { Link } from "@tanstack/react-router";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { Command } from "cmdk";
import {
  ArrowLeft,
  BookOpen,
  Maximize2,
  Minimize2,
  PencilLine,
  Save,
  BookMarked,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  Folder,
  FolderCog,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { connectionReturnStorageKey, readLocalStorage, writeLocalStorage, writeSessionStorage } from "../lib/storage";
import { readKnowledgeDraft, removeKnowledgeDraft, writeKnowledgeDraft, type KnowledgeDraftSnapshot } from "../lib/knowledgeDraft";
import { nextKnowledgeCardStatus } from "../lib/knowledgeStatus";
import { normalizeReviewContent } from "../lib/reviewContent";

const typeOptions = Object.entries(typeLabels) as Array<[KnowledgeCardType, string]>;
const statusOptions = Object.entries(statusLabels) as Array<[KnowledgeCardStatus, string]>;
const statusFilterOptions: Array<[KnowledgeStatusFilter, string]> = [["all", "全部"], ...statusOptions];
const knowledgeQueryStaleTime = 30_000;
const knowledgePageSize = 24;
const sortOptions: Array<[KnowledgeSort, string]> = [
  ["updated", "最近更新"],
  ["created", "最近创建"],
  ["usage", "使用最多"],
  ["review", "优先复习"],
];
const qualityOptions: Array<[api.KnowledgeCardQuality, string, string]> = [
  ["missing_source", "未关联来源记录", "筛选没有记录或复盘定位的知识条目；手动来源片段和空来源都可以保留"],
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
type StoredKnowledgeDraft = KnowledgeDraftSnapshot<DraftState>;
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
type KnowledgeSourceState = "empty" | "manual" | "incomplete" | "locator" | "loading" | "ready" | "verified" | "mismatch" | "error";

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

function hasKnowledgeLocator(value: { source_article_id?: string; source_review_id?: string; source_date?: string }) {
  return [value.source_article_id, value.source_review_id, value.source_date]
    .some((item) => !!item?.trim());
}

function hasKnowledgeSourceData(value: { source_article_id?: string; source_review_id?: string; source_date?: string; source_excerpt?: string }) {
  return [value.source_article_id, value.source_review_id, value.source_date, value.source_excerpt]
    .some((item) => !!item?.trim());
}

function hasKnowledgeExcerpt(value: { source_excerpt?: string }) {
  return !!value.source_excerpt?.trim();
}

function hasManualKnowledgeSource(value: { source_article_id?: string; source_review_id?: string; source_date?: string; source_excerpt?: string }) {
  return !hasKnowledgeLocator(value) && hasKnowledgeExcerpt(value);
}

function hasKnowledgeEvidence(value: { source_article_id?: string; source_review_id?: string; source_date?: string; source_excerpt?: string }) {
  return hasKnowledgeLocator(value) && !!value.source_excerpt?.trim();
}

function sourceContent(article: Article | null, review: api.Review | null) {
  if (article) return article.content;
  if (review) return normalizeReviewContent(review.kind, review.title, review.content);
  return "";
}

function sourceExcerptMatches(excerpt: string, article: Article | null, review: api.Review | null) {
  const needle = compact(excerpt);
  const haystack = compact(sourceContent(article, review));
  return !!needle && !!haystack && haystack.includes(needle);
}

function getKnowledgeSourceState({
  value,
  article,
  review,
  loading,
  error,
}: {
  value: { source_article_id?: string; source_review_id?: string; source_date?: string; source_excerpt?: string };
  article: Article | null;
  review: api.Review | null;
  loading: boolean;
  error: string;
}): KnowledgeSourceState {
  if (!hasKnowledgeLocator(value)) return hasKnowledgeExcerpt(value) ? "manual" : "empty";
  if (loading) return "loading";
  if (error) return "error";
  if (!article && !review) return "locator";
  if (!value.source_excerpt?.trim()) return "ready";
  return sourceExcerptMatches(value.source_excerpt, article, review) ? "verified" : "mismatch";
}

function sourceVerificationMessage(state: KnowledgeSourceState) {
  switch (state) {
    case "empty":
      return "这条知识条目没有来源，可以直接确认；如需关联来源，请填写定位并粘贴连续原文片段。";
    case "manual":
      return "已填写手动来源片段；不关联记录也可以直接确认，片段会随知识条目保留。";
    case "incomplete":
      return "关联来源还不完整；请补齐定位和连续原文片段，或清空关联字段。手动来源只保留片段即可。";
    case "locator":
      return "来源已定位，但尚未成功加载。请点击“定位原文”并确认来源可读取后再沉淀。";
    case "loading":
      return "来源正在加载，请稍候再确认沉淀。";
    case "ready":
      return "来源已加载，请粘贴能直接支撑正文的连续原文片段后再确认。";
    case "mismatch":
      return "来源片段未在当前原文中找到，请核对引用内容后再确认。";
    case "error":
      return "来源暂时无法读取，请修复连接或稍后重试加载后再确认。";
    case "verified":
      return "";
  }
}

function canConfirmKnowledgeSource(value: { source_article_id?: string; source_review_id?: string; source_date?: string; source_excerpt?: string }, state?: KnowledgeSourceState | null) {
  if (!hasKnowledgeSourceData(value) || hasManualKnowledgeSource(value)) return true;
  return state === "verified" || (hasKnowledgeEvidence(value) && state === undefined);
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
  const [spaceFilterQuery, setSpaceFilterQuery] = useState("");
  const [spacesExpanded, setSpacesExpanded] = useState(false);
  const [spaceArticles, setSpaceArticles] = useState<api.ArticleSummary[]>([]);
  const [spaceArticlesLoading, setSpaceArticlesLoading] = useState(false);
  const [spaceArticlesError, setSpaceArticlesError] = useState("");
  const [projectInput, setProjectInput] = useState("");
  const [spaceManagerOpen, setSpaceManagerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [batchMode, setBatchMode] = useState<KnowledgeBatchMode>("");
  const [batchValue, setBatchValue] = useState("");
  const [readerTab, setReaderTab] = useState<"read" | "edit" | "review">(initialView === "detail" && !initialCardId ? "edit" : "read");
  const [focused, setFocused] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailReload, setDetailReload] = useState(0);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const sheetReturnFocusRef = useRef<HTMLElement | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileBatchOpen, setMobileBatchOpen] = useState(false);
  const [density, setDensity] = useState<KnowledgeDensity>(() => {
    if (typeof window === "undefined") return "comfortable";
    return readLocalStorage("knowledge-density") === "compact" ? "compact" : "comfortable";
  });
  const [query, setQuery] = useState(initialQuery || "");
  const [mobileView, setMobileView] = useState<KnowledgeView>(initialView || (initialCardId ? "detail" : "list"));
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
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
  const [recoverableDraft, setRecoverableDraft] = useState<StoredKnowledgeDraft | null>(null);
  const [draftRelatedIds, setDraftRelatedIds] = useState<string[]>([]);
  const [relatedQuery, setRelatedQuery] = useState("");
  const [reviewHistory, setReviewHistory] = useState<api.ReviewHistoryEntry[]>([]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const draftStorageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validationSummaryRef = useRef<HTMLDivElement>(null);
  const knowledgeEditorRef = useRef<EditorView | null>(null);
  const editorGenerationRef = useRef(0);
  const lastSavedSignature = useRef("");
  const touchedCardIds = useRef<Set<string>>(new Set());
  const routeQueryRef = useRef(initialQuery || "");
  const cardListRequestRef = useRef(0);
  const sourceRequestRef = useRef(0);
  const sourceTriggerRef = useRef<HTMLButtonElement>(null);
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

  const persistCurrentDraft = () => {
    if (!hasDraftInput(draft)) return false;
    return writeKnowledgeDraft(selectedId, {
      draft,
      relatedIds: draftRelatedIds,
      baseUpdatedAt: selectedCard?.updated_at || detailCard?.updated_at,
    });
  };

  const restoreLocalDraft = (snapshot: StoredKnowledgeDraft) => {
    editorGenerationRef.current += 1;
    setDraft({ ...emptyDraft, ...snapshot.draft, status: snapshot.draft.status || "draft" });
    setDraftRelatedIds(snapshot.relatedIds);
    setDirty(true);
    setSaveState("idle");
    setFieldErrors({});
    setRecoverableDraft(null);
    setNotice("已恢复本地草稿，请保存后继续。");
    setNoticeTone("neutral");
    lastSavedSignature.current = "";
  };

  const discardStoredDraft = (cardId?: string | null) => {
    removeKnowledgeDraft(cardId);
    setRecoverableDraft(null);
  };

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
    setReaderTab("edit");
    if (field === "source") setSourceExpanded(true);
    window.setTimeout(() => {
    const target = document.getElementById(validationFieldIds[field]);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    if (field === "content") {
      const editorContent = target.querySelector<HTMLElement>(".cm-content");
      editorContent?.focus();
      return;
    }
    (target as HTMLElement).focus();
    }, 0);
  };

  const reportValidation = (errors: KnowledgeValidationErrors) => {
    setReaderTab("edit");
    if (errors.source) setSourceExpanded(true);
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
    editorContent.setAttribute("aria-label", "知识条目正文");
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
    const media = window.matchMedia("(max-width: 767px)");
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
  const normalizedSpaceFilterQuery = spaceFilterQuery.trim().toLocaleLowerCase();
  const filteredProjectCounts = useMemo(() => {
    const matching = projectCounts.filter((space) => !normalizedSpaceFilterQuery || space.name.toLocaleLowerCase().includes(normalizedSpaceFilterQuery));
    if (!projectFilter) return matching;
    const selected = projectCounts.find((space) => space.name.toLocaleLowerCase() === projectFilter.toLocaleLowerCase());
    if (!selected || matching.some((space) => space.name.toLocaleLowerCase() === selected.name.toLocaleLowerCase())) return matching;
    return [selected, ...matching];
  }, [normalizedSpaceFilterQuery, projectCounts, projectFilter]);
  const visibleProjectCounts = spacesExpanded || normalizedSpaceFilterQuery ? filteredProjectCounts : filteredProjectCounts.slice(0, 6);
  const counts = summary;

  // 本地临时副本是路由离开、切后台和自动保存竞态下的恢复网；服务端仍是唯一权威数据源。
  useEffect(() => {
    if (draftStorageTimer.current) {
      clearTimeout(draftStorageTimer.current);
      draftStorageTimer.current = null;
    }
    if (!dirty || !hasDraftInput(draft)) return undefined;
    draftStorageTimer.current = setTimeout(() => {
      writeKnowledgeDraft(selectedId, {
        draft,
        relatedIds: draftRelatedIds,
        baseUpdatedAt: selectedCard?.updated_at || detailCard?.updated_at,
      });
      draftStorageTimer.current = null;
    }, 250);
    return () => {
      if (!draftStorageTimer.current) return;
      clearTimeout(draftStorageTimer.current);
      draftStorageTimer.current = null;
    };
  }, [detailCard?.updated_at, draft, draftRelatedIds, dirty, selectedCard?.updated_at, selectedId]);

  useEffect(() => {
    if (!dirty || !hasDraftInput(draft)) return;
    const snapshot = () => {
      writeKnowledgeDraft(selectedId, {
        draft,
        relatedIds: draftRelatedIds,
        baseUpdatedAt: selectedCard?.updated_at || detailCard?.updated_at,
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") snapshot();
    };
    const onPageHide = () => snapshot();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      snapshot();
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [detailCard?.updated_at, draft, draftRelatedIds, dirty, selectedCard?.updated_at, selectedId]);

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
    throw new Error("请先补全当前知识条目的标题和内容。");
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
    removeKnowledgeDraft(selectedId);
    setRecoverableDraft(null);
    return true;
  };

  const retrySaveDraft = async () => {
    if (!dirty || !selectedId) return;
    setSaveState("saving");
    try {
      if (await saveDirtyDraft()) {
        setSaveState("saved");
        showNotice("已保存当前知识条目。", "good");
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
    // related_ids 随编辑草稿一起保存，避免只调整关联知识条目时刷新后丢失。
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
    if (!selectedId) {
      const storedNew = readKnowledgeDraft<DraftState>(null);
      if (storedNew && hasDraftInput(storedNew.draft)) {
        if (isNewRoute) {
          setDraft((current) => hasDraftInput(current) ? current : { ...emptyDraft, ...storedNew.draft, status: storedNew.draft.status || "draft" });
          setDraftRelatedIds((current) => current.length ? current : storedNew.relatedIds);
          setDirty(true);
          setSaveState("idle");
          setNotice("已恢复离开前的本地草稿，请保存后继续。");
          setNoticeTone("neutral");
        } else {
          setRecoverableDraft(storedNew);
        }
      }
    }
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
        // 筛选/列表刷新不应清掉尚未创建的新知识条目草稿（包括空间、来源和关联条目）。
        // 如果页面曾被路由卸载，优先恢复本地临时副本。
        const stored = readKnowledgeDraft<DraftState>(null);
        if (stored && hasDraftInput(stored.draft)) {
          setDraft((current) => hasDraftInput(current) ? current : { ...emptyDraft, ...stored.draft, status: stored.draft.status || "draft" });
          setDraftRelatedIds((current) => current.length ? current : stored.relatedIds);
          if (!hasDraftInput(draft)) {
            setDirty(true);
            setSaveState("idle");
            setNotice("已恢复离开前的本地草稿，请保存后继续。");
            setNoticeTone("neutral");
          }
        } else {
          setDraft((current) => hasDraftInput(current) ? current : { ...emptyDraft, status: "draft" });
        }
        lastSavedSignature.current = "";
        return;
      }
      // Browsing must not implicitly open a card or replace a deep-linked document.
      if (initialCardId || (selectedId && (keepSelection || mobileView === "detail"))) return;
      editorGenerationRef.current += 1;
      setSelectedId(null);
      setDraft(emptyDraft);
      setDraftRelatedIds([]);
      setDetailCard(null);
      setDirty(false);
      lastSavedSignature.current = "";
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

  const loadSourceDetail = async (): Promise<{ article: Article | null; review: api.Review | null } | null> => {
    // 草稿是当前编辑态的唯一来源；不能在用户清空/替换定位后回退到旧知识条目字段。
    const sourceArticleId = draft.source_article_id.trim();
    const sourceReviewId = draft.source_review_id.trim();
    const sourceDate = draft.source_date.trim();
    const requestId = ++sourceRequestRef.current;
    setSourceLoading(true);
    setSourceError("");
    setSourceArticle(null);
    setSourceReview(null);
    try {
      if (sourceArticleId) {
        const article = await api.getArticle(sourceArticleId);
        if (requestId !== sourceRequestRef.current) return null;
        setSourceArticle(article);
        return { article, review: null };
      }
      if (sourceReviewId) {
        const review = await api.getReview(sourceReviewId);
        if (requestId !== sourceRequestRef.current) return null;
        setSourceReview(review);
        return { article: null, review };
      }
      if (sourceDate) {
        const article = await api.getTodayArticle(sourceDate);
        if (!article) throw new Error(`找不到 ${sourceDate} 的每日记录`);
        if (requestId !== sourceRequestRef.current) return null;
        setSourceArticle(article);
        return { article, review: null };
      }
      throw new Error("当前知识条目没有可定位的来源");
    } catch (loadError) {
      if (requestId !== sourceRequestRef.current) return null;
      setSourceArticle(null);
      setSourceReview(null);
      setSourceError(api.getErrorMessage(loadError));
      return null;
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
    const sourceArticleId = draft.source_article_id.trim();
    const sourceReviewId = draft.source_review_id.trim();
    const sourceDate = draft.source_date.trim();
    if (!sourceArticleId && !sourceReviewId && !sourceDate) {
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
    const request = sourceArticleId
      ? api.getArticle(sourceArticleId)
      : sourceReviewId
        ? api.getReview(sourceReviewId)
        : api.getTodayArticle(sourceDate);
    request
      .then((source) => {
        if (cancelled || requestId !== sourceRequestRef.current) return;
        if (!source) throw new Error(`找不到 ${sourceDate} 的每日记录`);
        if ("kind" in source) setSourceReview(source);
        else setSourceArticle(source);
      })
      .catch((error) => { if (!cancelled && requestId === sourceRequestRef.current) { setSourceArticle(null); setSourceReview(null); setSourceError(api.getErrorMessage(error)); } })
      .finally(() => { if (!cancelled && requestId === sourceRequestRef.current) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [draft.source_article_id, draft.source_date, draft.source_review_id]);

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
        removeKnowledgeDraft(saveId);
        setRecoverableDraft(null);
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
    if (["source_date", "source_article_id", "source_review_id"].some((field) => field in patch)) {
      // 防止用户替换来源定位后，旧来源仍被误显示为“已核验”。
      setSourceArticle(null);
      setSourceReview(null);
      setSourceError("");
    }
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
    setReaderTab("read");
    setDetailError("");
    setSourceExpanded(false);
    editorGenerationRef.current += 1;
    setSelectedId(card.id);
    setDetailCard(card);
    const serverDraft = toDraft(card);
    const stored = readKnowledgeDraft<DraftState>(card.id);
    const canRestoreDirectly = !!stored
      && hasDraftInput(stored.draft)
      && (!stored.baseUpdatedAt || stored.baseUpdatedAt === card.updated_at);
    setDraft(canRestoreDirectly ? { ...emptyDraft, ...stored.draft } : serverDraft);
    setDraftRelatedIds(canRestoreDirectly ? stored?.relatedIds || [] : declaredRelatedIds(card));
    setDirty(canRestoreDirectly);
    setFieldErrors({});
    setNotice("");
    setSaveState("idle");
    setOrganizeOpen(false);
    setSourceDetailOpen(false);
    setSourceReview(null);
    if (stored && !canRestoreDirectly && hasDraftInput(stored.draft)) {
      setRecoverableDraft(stored);
      setNotice("发现一份较旧的本地草稿，未覆盖服务器内容。请确认是否恢复。");
      setNoticeTone("neutral");
    } else {
      setRecoverableDraft(null);
    }
    lastSavedSignature.current = canRestoreDirectly
      ? ""
      : JSON.stringify(payloadFromDraft(serverDraft, declaredRelatedIds(card)));
    // 复用追踪：每个知识条目在页面会话内只记一次打开
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
            title: "离开新知识条目",
            message: "当前新知识条目还没有创建，确定放弃这份草稿吗？",
            confirmText: "放弃草稿",
            danger: true,
          });
          if (!leave) return;
          discardStoredDraft(null);
        }
      }
      if (selectedId !== card.id) selectCard(card);
      setMobileView("detail");
      onOpenCard?.(card.id);
    };
    void open();
  };

  // 从搜索跳转打开指定知识条目；详情深链接不依赖先拉完整集合。
  const initialCardHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!initialCardId || initialCardHandled.current === initialCardId) return;
    const target = cards.find((card) => card.id === initialCardId);
    if (target) {
      initialCardHandled.current = initialCardId;
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
        selectCard(card);
      })
      .catch((error) => { if (!cancelled) setDetailError(api.getErrorMessage(error)); });
    return () => { cancelled = true; };
  }, [cards, detailReload, initialCardId, initialNonce, onSearchParamsChange, queryClient]);

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
            title: "离开新知识条目",
            message: "当前新知识条目还没有创建，确定放弃这份草稿吗？",
            confirmText: "放弃草稿",
            danger: true,
          });
          if (!leave) return;
          discardStoredDraft(null);
        }
      }
      editorGenerationRef.current += 1;
      removeKnowledgeDraft(null);
      setRecoverableDraft(null);
      setSelectedId(null);
      setReaderTab("edit");
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
      setMobileView("detail");
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
        message: "当前新知识条目还没有创建，确定放弃这份草稿吗？",
        confirmText: "放弃草稿",
        danger: true,
      });
      if (!leave) return;
      discardStoredDraft(null);
    }
    setMobileView("list");
    setFocused(false);
    const returnId = selectedId;
    window.setTimeout(() => {
      const link = returnId ? document.querySelector<HTMLAnchorElement>(`[data-card-id="${CSS.escape(returnId)}"]`) : null;
      (link || document.querySelector<HTMLInputElement>('.kl-search input'))?.focus();
    }, 80);
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
      removeKnowledgeDraft(creating ? null : selectedId);
      setRecoverableDraft(null);
      const message = selectedId ? "已保存知识条目。" : "已创建知识条目。";
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
    const selectedStatusBeforeChange = draft.status;
    const shouldLeaveStatusFilter = Boolean(
      selectedId
      && ids.includes(selectedId)
      && activeStatus === selectedStatusBeforeChange
      && status !== selectedStatusBeforeChange,
    );
    if (status === "confirmed") {
      let selectedSourceState: KnowledgeSourceState | null = null;
      if (selectedId && ids.includes(selectedId)) {
        let loadedSource = sourceArticle || sourceReview
          ? { article: sourceArticle, review: sourceReview }
          : null;
        selectedSourceState = getKnowledgeSourceState({
          value: draft,
          article: loadedSource?.article || null,
          review: loadedSource?.review || null,
          loading: sourceLoading,
          error: sourceError,
        });
        if (selectedSourceState !== "verified" && hasKnowledgeEvidence(draft) && !loadedSource) {
          loadedSource = await loadSourceDetail();
          selectedSourceState = getKnowledgeSourceState({
            value: draft,
            article: loadedSource?.article || null,
            review: loadedSource?.review || null,
            loading: false,
            error: loadedSource ? "" : "来源加载失败",
          });
        }
        if (!canConfirmKnowledgeSource(draft, selectedSourceState)) {
          const message = sourceVerificationMessage(selectedSourceState);
          reportValidation({ source: message });
          toast.error(message);
          return;
        }
      }
      const missingSource = ids.filter((id) => {
        if (id === selectedId) return !canConfirmKnowledgeSource(draft, selectedSourceState);
        const card = cards.find((item) => item.id === id);
        return !card || !canConfirmKnowledgeSource(card);
      });
      if (missingSource.length > 0) {
        const message = missingSource.length === 1
          ? "关联来源还不完整；请补齐定位和连续原文片段，或清空关联字段后确认。手动来源只保留片段即可。"
          : `有 ${missingSource.length} 个知识条目的关联来源还不完整，请补齐或清空关联字段后再确认。`;
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
      if (shouldLeaveStatusFilter) {
        setActiveStatus("all");
        setPage(1);
        onSearchParamsChange?.({ status: "all", page: undefined });
      }
      await loadCards(false, false, undefined, shouldLeaveStatusFilter ? { status: "all" } : undefined, shouldLeaveStatusFilter ? 1 : undefined);
      if (selectedId && ids.includes(selectedId)) {
        const nextDraft = { ...draft, status };
        setDraft(nextDraft);
        setDetailCard((current) => current?.id === selectedId ? { ...current, status } : current);
        setDirty(false);
        setSaveState("saved");
        lastSavedSignature.current = JSON.stringify(payloadFromDraft(nextDraft, draftRelatedIds));
        removeKnowledgeDraft(selectedId);
        setRecoverableDraft(null);
      }
      setFieldErrors({});
      const message = status === "confirmed" ? `已确认 ${ids.length} 个知识条目。` : "状态已更新。";
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

  const restoreCards = async (ids: string[], reopenId?: string) => {
    if (!ids.length) return;
    setSaving(true);
    try {
      const result = await api.restoreKnowledgeCards(ids);
      await invalidateKnowledgeQueries();
      await refreshMetadata().catch(() => undefined);
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      await loadCards(false, false);
      if (reopenId) onOpenCard?.(reopenId);
      const message = `已恢复 ${result.updated} 个知识条目。`;
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
      title: "删除知识条目",
      message: ids.length === 1 ? "将当前知识条目移入回收站？正文、空间关系和复习记录都可以恢复。" : `将选中的 ${ids.length} 个知识条目移入回收站？正文、空间关系和复习记录都可以恢复。`,
      confirmText: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    const deletedCurrentId = selectedId && ids.includes(selectedId) ? selectedId : undefined;
    setSaving(true);
    try {
      if (!(await saveDirtyDraft())) {
        throw new Error("保存期间内容发生变化，请重试后再移入回收站。");
      }
      await api.batchKnowledgeCards({ ids, action: "delete" });
      await invalidateKnowledgeQueries();
      await refreshMetadata().catch(() => undefined);
      setSelectedIds([]);
      await loadCards(false, false);
      if (deletedCurrentId) {
        editorGenerationRef.current += 1;
        setSelectedId(null);
        setDetailCard(null);
        setDraft(emptyDraft);
        setDraftRelatedIds([]);
        setDirty(false);
        setMobileView("list");
        setFocused(false);
        if (onBackToList) onBackToList(); else onNavigate("knowledge");
      }
      const message = `已删除 ${ids.length} 个知识条目。`;
      showNotice(message, "good");
      toast.success(message, {
        action: {
          label: "撤销",
          onClick: () => { void restoreCards(ids, deletedCurrentId); },
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
        ? `已为 ${ids} 个知识条目添加标签。`
        : batchMode === "remove_tag"
          ? `已从 ${ids} 个知识条目移除标签。`
        : batchMode === "move_project"
          ? `已将 ${ids} 个知识条目移动到「${values[0]}」。`
          : batchMode === "remove_project"
            ? `已将 ${ids} 个知识条目移出空间「${values[0]}」。`
            : `已为 ${ids} 个知识条目加入空间。`;
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
        // 来源查看在当前工作台内完成，不应把未创建的新知识条目当成已丢弃。
        // 先把内容停到本地恢复网，再打开只读来源详情。
        persistCurrentDraft();
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
          if (!(await saveDirtyDraft())) {
            persistCurrentDraft();
            showNotice("当前修改尚未同步，已保存本地副本；你仍可以继续修复连接。", "neutral");
          }
        } catch (e) {
          setSaveState("error");
          persistCurrentDraft();
          showNotice(`${api.getErrorMessage(e)} 当前修改已保存为本地副本，可以继续打开连接设置。`, "bad");
        }
      } else if (dirty && hasDraftInput(draft)) {
        persistCurrentDraft();
      }
      if (typeof window !== "undefined") {
        writeSessionStorage("daily-summary-settings-tab", "connect");
        writeSessionStorage(connectionReturnStorageKey, `${window.location.pathname}${window.location.search}`);
      }
      onNavigate("settings");
    };
    void open();
  };
  const resumeStoredNewDraft = () => {
    setMobileView("detail");
    onNewCard?.();
  };
  const sourceArticleId = draft.source_article_id.trim();
  const sourceReviewId = draft.source_review_id.trim();
  const currentSourceType = sourceArticleId ? "每日记录" : sourceReviewId ? "AI 复盘" : "每日记录";
  const sourceState = useMemo(() => getKnowledgeSourceState({
    value: {
      source_article_id: draft.source_article_id,
      source_date: draft.source_date,
      source_excerpt: draft.source_excerpt,
      source_review_id: draft.source_review_id,
    },
    article: sourceArticle,
    review: sourceReview,
    loading: sourceLoading,
    error: sourceError,
  }), [
    draft.source_article_id,
    draft.source_date,
    draft.source_excerpt,
    draft.source_review_id,
    sourceArticle,
    sourceError,
    sourceLoading,
    sourceReview,
  ]);
  const sourceStateLabel: Record<KnowledgeSourceState, string> = {
    empty: "未填写（可选）",
    manual: "已填写片段",
    incomplete: "来源待完善",
    locator: "已定位来源",
    loading: "正在加载",
    ready: "待补证据片段",
    verified: "已核验",
    mismatch: "片段未匹配",
    error: "加载失败",
  };

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
  const emptyStatusLabel = activeStatus === "all" ? "知识条目" : `${statusLabels[activeStatus]}知识条目`;
  const qualityScopeLabel = projectFilter ? "空间「" + projectFilter + "」" : "全库";
  const connectionError = /令牌|token|授权|认证|无法连接服务器|服务器地址|网络|服务状态/i.test(error);
  const sourceConnectionError = /令牌|token|授权|认证|无法连接服务器|服务器地址|网络|服务状态/i.test(sourceError);
  const hasSourceReference = Boolean(
    sourceArticleId
    || sourceReviewId
    || draft.source_date.trim(),
  );
  const sourceActionLabel = sourceArticle
    ? "查看原文"
    : sourceReview ? "查看复盘" : sourceReviewId ? "查看复盘" : "定位原文";
  const sourceReferenceLabel = sourceArticle?.title
    || sourceReview?.title
    || (draft.source_date ? `${draft.source_date} · ${currentSourceType}` : currentSourceType);
  const mobileSaveLabel = saving
    ? "保存中"
    : saveState === "error"
      ? "保存失败"
      : dirty
        ? "未同步"
        : "已同步";
  const organizeSummary = selectedId
    ? [
        typeLabels[draft.card_type],
        statusLabels[draft.status],
        parsedTags.length ? `${parsedTags.length} 个标签` : "无标签",
        parsedProjects.length ? `${parsedProjects.length} 个空间` : "未归入空间",
        sourceState === "verified"
          ? "已核验来源"
          : sourceState === "manual"
            ? "已填写来源片段"
            : hasKnowledgeSourceData(draft)
              ? sourceState === "incomplete" ? "来源待完善" : "已定位来源"
              : "无来源（可选）",
      ].join(" · ")
    : "类型、标签、空间和关联可稍后补充";
  const hasSearchFilters = Boolean(activeQuery || typeFilter || usageFilter || qualityFilter || tagFilter || projectFilter);
  const emptyStateTitle = totalCards > 0
    ? `第 ${page} 页没有知识条目`
    : hasSearchFilters ? "没有符合当前条件的知识条目" : `没有${emptyStatusLabel}`;
  const emptyStateDescription = totalCards > 0
    ? "当前页已经超出结果范围，请返回上一页。"
    : hasSearchFilters
      ? "换个关键词或清除筛选条件，原有知识条目不会被删除。"
      : activeStatus === "draft"
        ? "从每日记录或周/月复盘提取草稿后，在这里逐条确认。"
        : activeStatus === "all"
          ? "先创建一个知识条目，标题和正文写好后即可确认；如需回溯依据，再补充来源。"
          : "当前状态还没有知识条目，可以回到全部知识条目继续整理。";
  const emptyStateAction = totalCards > 0 && page > 1
    ? { label: "回到上一页", onClick: () => changePage(page - 1) }
    : hasSearchFilters
      ? { label: "清除筛选", onClick: resetFilters }
      : activeStatus === "draft"
        ? { label: "导入知识条目", onClick: () => setImportOpen(true) }
        : activeStatus === "all"
          ? { label: "新建知识条目", onClick: startNew }
          : { label: "查看全部知识条目", onClick: () => changeStatus("all") };

  const detailVisible = mobileView === "detail" || !!initialCardId || isNewRoute;
  const awaitingDetail = Boolean(initialCardId && selectedId !== initialCardId);
  const clearSearch = () => {
    setQuery("");
    routeQueryRef.current = "";
    setPage(1);
    onSearchParamsChange?.({ q: undefined, page: undefined });
    void loadCards(false, true, "", undefined, 1);
  };
  const libraryFilters: LibraryFilter[] = [];
  if (activeQuery) libraryFilters.push({ label: `搜索：${activeQuery}`, onRemove: clearSearch });
  if (projectFilter) libraryFilters.push({ label: `空间：${projectFilter}`, onRemove: () => changeProject("") });
  if (tagFilter) libraryFilters.push({ label: `标签：${tagFilter}`, onRemove: () => changeTag("") });
  if (typeFilter) libraryFilters.push({ label: `类型：${typeLabels[typeFilter as KnowledgeCardType]}`, onRemove: () => changeType("") });
  if (usageFilter) libraryFilters.push({ label: "从未使用", onRemove: () => changeUsage("") });
  if (qualityFilter) libraryFilters.push({ label: qualityOptions.find(([value]) => value === qualityFilter)?.[1] || qualityFilter, onRemove: () => changeQuality("") });
  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0 });
    if (window.matchMedia("(max-width: 1023px)").matches) {
      document.getElementById("main-content")?.scrollTo({ top: 0 });
    }
    if (!detailVisible || awaitingDetail) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(readerTab === "read" ? "knowledge-reading-title" : readerTab === "edit" ? "knowledge-card-title" : "knowledge-review-panel")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, readerTab, detailVisible, awaitingDetail]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!detailVisible || event.isComposing || event.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      if (event.key === "Escape") { event.preventDefault(); void closeMobileDetail(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && readerTab === "edit") {
        event.preventDefault();
        if (!saving && saveState !== "saving") void (selectedId ? retrySaveDraft() : saveNewCard());
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [detailVisible, readerTab, saving, saveState, selectedId, draft, dirty]);
  return (
    <div className="knowledge-hub">
      <header className="kl-page-header">
        <div className="kl-page-title">
          <span className="kl-brand-mark">
            <BookMarked size={23} strokeWidth={1.6} />
          </span>
          <div>
            <h1>知识</h1>
          </div>
        </div>
        <div className="kl-page-actions">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            aria-label="导入知识"
            className="ui-button-secondary"
          >
            <Upload size={16} />
            <span>导入知识</span>
          </button>
          <button
            type="button"
            onClick={startNew}
            className="ui-button-primary"
          >
            <Plus size={17} />
            <span>新建条目</span>
          </button>
        </div>
      </header>
      {error && (
        <div
          className="ui-alert-bad mb-4 flex flex-wrap items-center justify-between gap-3"
          role="alert"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <div className="flex shrink-0 items-center gap-2">
            {connectionError && (
              <button
                type="button"
                onClick={openConnectionSettings}
                className="ui-button-primary h-11 min-h-11 px-2.5 text-xs md:h-8 md:min-h-8"
              >
                前往连接设置
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadCards(false, false)}
              disabled={loading}
              className="ui-button-ghost h-11 min-h-11 shrink-0 px-2.5 text-xs md:h-8 md:min-h-8"
            >
              {loading ? "重试中..." : "重试"}
            </button>
          </div>
        </div>
      )}

      {recoverableDraft?.cardId === null && !isNewRoute && !selectedId && (
        <div
          className="ui-alert-warn mb-4 flex flex-wrap items-center justify-between gap-3"
          role="status"
        >
          <span className="min-w-0 flex-1 text-xs leading-5">
            发现一份尚未创建的新知识草稿（
            {new Date(recoverableDraft.savedAt).toLocaleString()}）。
          </span>
          <button
            type="button"
            onClick={resumeStoredNewDraft}
            className="ui-button-primary h-11 min-h-11 px-2.5 text-xs md:h-8 md:min-h-8"
          >
            继续编辑
          </button>
        </div>
      )}

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            sheetReturnFocusRef.current?.focus();
          }}
          className="kl-filter-sheet px-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
        >
          <SheetHeader>
            <div className="flex items-center justify-between gap-3">
              <SheetTitle>搜索与筛选</SheetTitle>
              <button
                type="button"
                className="ui-icon-button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="关闭筛选"
              >
                <X size={18} />
              </button>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="ui-button-ghost h-11 min-h-11 shrink-0 px-2 text-xs md:h-8 md:min-h-8"
                >
                  重置全部
                </button>
              )}
            </div>
            <SheetDescription>
              筛选结果会同步到地址栏，刷新后仍可恢复。
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-text-subtle)]"
                size={16}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    searchCards();
                    setMobileFiltersOpen(false);
                  }
                }}
                placeholder="搜索标题、内容或来源"
                aria-label="搜索标题、内容或来源"
                className="ui-field h-11 pl-10"
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
                        activeStatus === status
                          ? "ui-filter-button-active"
                          : "",
                      ].join(" ")}
                    >
                      <div className="text-xs font-medium">{label}</div>
                      <div className="mt-0.5 font-mono text-sm font-bold">
                        {status === "all" ? counts.total : counts[status]}
                      </div>
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
                    className="ui-button-ghost h-11 min-h-11 gap-1 px-1.5 text-[11px] md:h-8 md:min-h-8"
                  >
                    <FolderCog size={13} /> 空间管理
                  </button>
                </div>
                {projectCounts.length > 6 && (
                  <label className="relative mb-2 block">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-text-subtle)]"
                      size={15}
                    />
                    <input
                      value={spaceFilterQuery}
                      onChange={(event) =>
                        setSpaceFilterQuery(event.target.value)
                      }
                      placeholder="筛选空间"
                      aria-label="筛选空间"
                      className="ui-field h-11 min-h-11 pl-9 text-xs"
                    />
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <FilterButton
                    active={!projectFilter}
                    onClick={() => changeProject("")}
                  >
                    全部空间
                  </FilterButton>
                  {visibleProjectCounts.map(
                    ({ name, count, article_count = 0 }) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() =>
                          changeProject(projectFilter === name ? "" : name)
                        }
                        className={[
                          "ui-filter-button min-h-11 gap-1 px-2.5 md:min-h-8",
                          projectFilter === name
                            ? "ui-filter-button-active"
                            : "",
                        ].join(" ")}
                      >
                        <Folder size={12} /> {name}{" "}
                        <span className="opacity-60">
                          {count} 个条目
                          {article_count > 0
                            ? ` · ${article_count} 篇记录`
                            : ""}
                        </span>
                      </button>
                    ),
                  )}
                  {projectCounts.length > 6 && !normalizedSpaceFilterQuery && (
                    <button
                      type="button"
                      onClick={() => setSpacesExpanded((expanded) => !expanded)}
                      aria-expanded={spacesExpanded}
                      className="ui-button-ghost h-11 min-h-11 gap-1 px-2 text-[11px] md:h-8 md:min-h-8"
                    >
                      {spacesExpanded
                        ? "收起空间"
                        : `显示全部 ${projectCounts.length} 个空间`}
                      <ChevronDown
                        size={13}
                        className={spacesExpanded ? "rotate-180" : ""}
                      />
                    </button>
                  )}
                  {projectCounts.length > 6 &&
                    normalizedSpaceFilterQuery &&
                    visibleProjectCounts.length === 0 && (
                      <span className="w-full px-1 text-xs text-[var(--ui-text-subtle)]">
                        没有匹配的空间
                      </span>
                    )}
                </div>
              </div>
              <div>
                <div className="ui-section-kicker mb-2">类型</div>
                <TypeFilterSelect value={typeFilter} onChange={changeType} />
              </div>
              <div>
                <div className="ui-section-kicker mb-2">使用情况</div>
                <div className="grid grid-cols-2 gap-2">
                  <FilterButton
                    active={!usageFilter}
                    onClick={() => changeUsage("")}
                  >
                    全部条目
                  </FilterButton>
                  <FilterButton
                    active={usageFilter === "never_used"}
                    onClick={() =>
                      changeUsage(
                        usageFilter === "never_used" ? "" : "never_used",
                      )
                    }
                  >
                    从未使用
                  </FilterButton>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="ui-section-kicker">数据质量</div>
                  {qualityFilter && (
                    <button
                      type="button"
                      onClick={() => changeQuality("")}
                      className="ui-button-ghost h-11 min-h-11 px-1 text-[11px] md:h-8 md:min-h-8"
                    >
                      清除
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <FilterButton
                    active={!qualityFilter}
                    onClick={() => changeQuality("")}
                  >
                    全部质量
                  </FilterButton>
                  {qualityOptions.map(([value, label]) => (
                    <FilterButton
                      key={value}
                      active={qualityFilter === value}
                      onClick={() =>
                        changeQuality(qualityFilter === value ? "" : value)
                      }
                    >
                      <span className="flex items-center justify-between gap-1.5">
                        <span className="truncate">{label}</span>
                        <span className="shrink-0 font-mono text-[11px] opacity-60">
                          {counts[value]}
                        </span>
                      </span>
                    </FilterButton>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">
                  数量为{qualityScopeLabel}
                  活跃知识条目，可继续叠加状态、标签或质量筛选。
                </p>
                {qualityFilter && (
                  <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">
                    {
                      qualityOptions.find(
                        ([value]) => value === qualityFilter,
                      )?.[2]
                    }
                  </p>
                )}
              </div>
              <div>
                <div className="ui-section-kicker mb-2">排序</div>
                <div className="grid grid-cols-2 gap-2">
                  {sortOptions.map(([value, label]) => (
                    <FilterButton
                      key={value}
                      active={sort === value}
                      onClick={() => changeSort(value)}
                    >
                      {label}
                    </FilterButton>
                  ))}
                </div>
              </div>
              <div>
                <div className="ui-section-kicker mb-2 flex items-center justify-between">
                  <span>标签</span>
                  {tagFilter && (
                    <button
                      type="button"
                      onClick={() => changeTag("")}
                      className="ui-button-ghost h-11 min-h-11 px-1 text-[11px] md:h-8 md:min-h-8"
                    >
                      清除
                    </button>
                  )}
                </div>
                <TagFilterPicker
                  tags={tagCounts}
                  selectedTag={tagFilter}
                  onChange={changeTag}
                  inputId="knowledge-mobile-tag-filter"
                  compact
                />
              </div>
            </div>
          </div>
          <div className="ui-soft-divider border-t px-4 pt-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--ui-text)]">
                  知识条目回收站
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--ui-text-subtle)]">
                  已删除知识条目可恢复，关系和复习进度会保留。
                </p>
              </div>
              <Link
                to="/knowledge/trash"
                search={{} as never}
                onClick={() => setMobileFiltersOpen(false)}
                className="ui-button-secondary h-11 min-h-11 shrink-0 px-2.5 text-xs md:h-9 md:min-h-9"
              >
                <Trash2 size={14} /> 查看回收站
              </Link>
            </div>
            <button
              type="button"
              onClick={() => {
                searchCards();
                setMobileFiltersOpen(false);
              }}
              className="ui-button-primary h-11 w-full text-sm"
            >
              应用筛选
              {activeFilterCount > 0 ? ` · ${activeFilterCount} 项条件` : ""}
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
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            sheetReturnFocusRef.current?.focus();
          }}
          className="kl-filter-sheet px-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
        >
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>
                批量处理 · {selectedIds.length} 个知识条目
              </SheetTitle>
              <button
                type="button"
                className="ui-icon-button"
                onClick={() => setMobileBatchOpen(false)}
                aria-label="关闭批量处理"
              >
                <X size={18} />
              </button>
            </div>
            <SheetDescription>
              选择一个动作，目标输入会在这里完成；删除仍可撤销。
            </SheetDescription>
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
                <Tags
                  size={17}
                  className="shrink-0 text-[var(--ui-accent-text)]"
                />
                <span>
                  <span className="block text-sm font-semibold">添加标签</span>
                  <span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">
                    给选中的知识条目增加一个或多个标签
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleBatchMode("remove_tag")}
                className={[
                  "ui-bulk-action",
                  batchMode === "remove_tag" ? "ui-bulk-action-active" : "",
                ].join(" ")}
              >
                <Tags
                  size={17}
                  className="shrink-0 text-[var(--ui-text-muted)]"
                />
                <span>
                  <span className="block text-sm font-semibold">移除标签</span>
                  <span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">
                    从选中的知识条目中移除指定标签
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleBatchMode("add_project")}
                className={[
                  "ui-bulk-action",
                  batchMode === "add_project" ? "ui-bulk-action-active" : "",
                ].join(" ")}
              >
                <Folder
                  size={17}
                  className="shrink-0 text-[var(--ui-accent-text)]"
                />
                <span>
                  <span className="block text-sm font-semibold">加入空间</span>
                  <span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">
                    保留已有空间，再添加一个空间
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleBatchMode("move_project")}
                className={[
                  "ui-bulk-action",
                  batchMode === "move_project" ? "ui-bulk-action-active" : "",
                ].join(" ")}
              >
                <Folder
                  size={17}
                  className="shrink-0 text-[var(--ui-accent-text)]"
                />
                <span>
                  <span className="block text-sm font-semibold">
                    移动到空间
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">
                    用目标空间替换知识条目已有空间
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleBatchMode("remove_project")}
                className={[
                  "ui-bulk-action",
                  batchMode === "remove_project" ? "ui-bulk-action-active" : "",
                ].join(" ")}
              >
                <Folder
                  size={17}
                  className="shrink-0 text-[var(--ui-text-muted)]"
                />
                <span>
                  <span className="block text-sm font-semibold">移出空间</span>
                  <span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">
                    从指定空间中移除这些知识条目
                  </span>
                </span>
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
                <span>
                  <span className="block text-sm font-semibold">
                    移入回收站
                  </span>
                  <span className="mt-0.5 block text-xs opacity-75">
                    可从回收站恢复，不会立即永久删除
                  </span>
                </span>
              </button>
            </div>

            {batchMode && (
              <div className="ui-status-accent mb-2 rounded-xl p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--ui-accent-text)]">
                    {batchMode === "tag"
                      ? "添加标签"
                      : batchMode === "remove_tag"
                        ? "移除标签"
                        : batchMode === "add_project"
                          ? "加入空间"
                          : batchMode === "move_project"
                            ? "移动到空间"
                            : "移出空间"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setBatchMode("");
                      setBatchValue("");
                    }}
                    className="ui-icon-button h-11 w-11 md:h-9 md:w-9"
                    aria-label="关闭批量编辑"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {batchMode === "tag" || batchMode === "remove_tag" ? (
                    <input
                      value={batchValue}
                      onChange={(e) => setBatchValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.nativeEvent.isComposing &&
                          e.keyCode !== 229
                        ) {
                          e.preventDefault();
                          void applyBatch();
                        }
                      }}
                      placeholder="标签，逗号分隔多个"
                      aria-label={
                        batchMode === "tag" ? "要添加的标签" : "要移除的标签"
                      }
                      className="ui-field h-11 min-w-0 flex-1"
                    />
                  ) : (
                    <SpaceAutocomplete
                      spaces={projectCounts}
                      value={batchValue}
                      onChange={setBatchValue}
                      onEnter={() => void applyBatch()}
                      placeholder={
                        batchMode === "move_project"
                          ? "选择目标空间"
                          : "选择空间"
                      }
                      ariaLabel={
                        batchMode === "move_project"
                          ? "批量移动的目标空间"
                          : "批量操作的空间"
                      }
                      inputClassName="ui-field h-11 pl-9 text-sm"
                      containerClassName="min-w-0 flex-1"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => void applyBatch()}
                    disabled={saving || !batchValue.trim()}
                    className="ui-button-primary h-11 shrink-0 px-3 text-xs"
                  >
                    应用
                  </button>
                </div>
                <div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                  {(batchMode === "tag" || batchMode === "remove_tag"
                    ? tagCounts.map(({ tag }) => tag)
                    : projectCounts.map(({ name }) => name)
                  )
                    .slice(0, 10)
                    .map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setBatchValue((current) =>
                            batchMode === "tag" || batchMode === "remove_tag"
                              ? current
                                ? `${current}, ${value}`
                                : value
                              : value,
                          )
                        }
                        className="ui-chip h-7 border-[var(--ui-selected-border)] bg-[var(--ui-surface-raised)] text-[var(--ui-accent-text)] hover:bg-[var(--ui-surface-hover)]"
                      >
                        {batchMode === "tag" || batchMode === "remove_tag"
                          ? `#${value}`
                          : value}
                      </button>
                    ))}
                </div>
                {batchMode === "move_project" && (
                  <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">
                    目标空间不存在时会自动创建。
                  </p>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <KnowledgeLibrary
        cards={sortedCards}
        summary={summary}
        spaces={projectCounts}
        tags={tagCounts}
        total={totalCards}
        loading={loading}
        error={!!error}
        status={activeStatus}
        project={projectFilter}
        tag={tagFilter}
        query={query}
        sort={sort}
        density={density}
        selectedIds={selectedIds}
        activeId={selectedId}
        filters={libraryFilters}
        page={page}
        pageCount={pageCount}
        detailVisible={detailVisible}
        focused={focused}
        onStatus={changeStatus}
        onProject={changeProject}
        onTag={changeTag}
        onQuery={setQuery}
        onSearch={searchCards}
        onClearSearch={clearSearch}
        onFilters={() => {
          sheetReturnFocusRef.current = document.activeElement as HTMLElement;
          setMobileFiltersOpen(true);
        }}
        onReset={resetFilters}
        onSort={changeSort}
        onDensity={changeDensity}
        onSelect={toggleSelected}
        onSelectAll={selectAllVisible}
        onInvert={invertVisibleSelection}
        onOpen={openCard}
        onCardStatus={(card) =>
          void updateStatus(nextKnowledgeCardStatus(card.status), [card.id])
        }
        onDelete={(card) => void deleteCards([card.id])}
        onPage={changePage}
        onNew={startNew}
        onManageSpaces={openSpaceManager}
        emptyTitle={emptyStateTitle}
        emptyDescription={emptyStateDescription}
        emptyAction={emptyStateAction}
        busy={saving}
        cardSearch={{
          q: activeQuery || undefined,
          project: projectFilter || undefined,
          tag: tagFilter || undefined,
          status: activeStatus,
          type: typeFilter || undefined,
          sort: sort === "updated" ? undefined : sort,
          usage: usageFilter || undefined,
          quality: qualityFilter || undefined,
          page: page > 1 ? page : undefined,
        }}
        spaceOverview={
          projectFilter ? (
            <details className="kl-space-overview">
              <summary>
                <Folder size={14} />
                空间概览与最近记录
                <ChevronDown size={14} />
              </summary>
              <SpaceOverview
                name={projectFilter}
                space={selectedSpace}
                articles={spaceArticles}
                loading={spaceArticlesLoading}
                error={spaceArticlesError}
                onEditDate={onEditDate}
              />
            </details>
          ) : null
        }
        batchBar={
          selectedIds.length > 0 ? (
            <div
              className="kl-batchbar"
              role="toolbar"
              aria-label="知识条目批量操作"
            >
              <span>
                已选 <strong>{selectedIds.length}</strong> 项
              </span>
              <button
                type="button"
                className="ui-button-success"
                disabled={saving || selectedDraftCount === 0}
                onClick={() =>
                  void updateStatus(
                    "confirmed",
                    selectedIds.filter((id) =>
                      cards.some(
                        (card) => card.id === id && card.status === "draft",
                      ),
                    ),
                  )
                }
              >
                <CheckCircle2 size={14} />
                确认沉淀
              </button>
              <button
                type="button"
                className="ui-button-secondary"
                disabled={saving}
                onClick={() => {
                  sheetReturnFocusRef.current =
                    document.activeElement as HTMLElement;
                  setMobileBatchOpen(true);
                }}
              >
                批量操作
                <MoreHorizontal size={15} />
              </button>
              <button
                className="kl-icon"
                type="button"
                onClick={clearSelection}
                aria-label="清空选择"
              >
                <X size={16} />
              </button>
            </div>
          ) : null
        }
        detail={
          <section className="kl-detail" aria-label="知识条目详情">
            <div className="kl-detail-toolbar">
              <button
                type="button"
                className="kl-back"
                onClick={() => void closeMobileDetail()}
              >
                <ArrowLeft size={16} />
                <span>返回知识库</span>
              </button>
              <div>
                <span
                  className="kl-save-state"
                  data-error={saveState === "error"}
                  role="status"
                >
                  {selectedId ? mobileSaveLabel : "新建草稿"}
                </span>
                <button
                  type="button"
                  className="kl-icon kl-focus-button"
                  onClick={() => setFocused((value) => !value)}
                  aria-label={focused ? "退出专注阅读" : "专注阅读"}
                  title={focused ? "退出专注阅读" : "专注阅读"}
                >
                  {focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              </div>
            </div>
            <div
              className="kl-detail-tabs"
              role="group"
              aria-label="知识条目视图"
            >
              <button
                type="button"
                aria-pressed={readerTab === "read"}
                disabled={!selectedId || awaitingDetail}
                onClick={() => setReaderTab("read")}
              >
                <BookOpen size={15} />
                阅读
              </button>
              <button
                type="button"
                aria-pressed={readerTab === "edit"}
                disabled={awaitingDetail}
                onClick={() => setReaderTab("edit")}
              >
                <PencilLine size={15} />
                编辑
              </button>
              <button
                type="button"
                aria-pressed={readerTab === "review"}
                disabled={!selectedId || awaitingDetail}
                onClick={() => setReaderTab("review")}
              >
                <CheckCircle2 size={15} />
                复习
              </button>
            </div>
            <div className="kl-detail-scroll" ref={detailScrollRef}>
              {validationEntries.length > 0 && (
                <div
                  ref={validationSummaryRef}
                  id="knowledge-validation-summary"
                  tabIndex={-1}
                  role="alert"
                  aria-labelledby="knowledge-validation-summary-title"
                  className="ui-alert-bad mb-4 outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/50"
                >
                  <div
                    id="knowledge-validation-summary-title"
                    className="font-semibold"
                  >
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

              {recoverableDraft && (
                <div
                  className="ui-alert-warn mb-4 flex flex-wrap items-center justify-between gap-3"
                  role="status"
                >
                  <span className="min-w-0 flex-1 text-xs leading-5">
                    发现一份较旧的本地草稿（
                    {new Date(recoverableDraft.savedAt).toLocaleString()}
                    ）。服务器内容可能已经更新。
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => restoreLocalDraft(recoverableDraft)}
                      className="ui-button-primary h-11 min-h-11 px-2.5 text-xs md:h-8 md:min-h-8"
                    >
                      恢复本地草稿
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        discardStoredDraft(recoverableDraft.cardId)
                      }
                      className="ui-button-ghost h-11 min-h-11 px-2.5 text-xs md:h-8 md:min-h-8"
                    >
                      丢弃
                    </button>
                  </span>
                </div>
              )}

              {notice && validationEntries.length === 0 && (
                <div
                  className={[
                    "kl-notice",
                    noticeTone === "good"
                      ? "ui-alert-good"
                      : noticeTone === "bad"
                        ? "ui-alert-bad"
                        : "ui-alert-warn",
                  ].join(" ")}
                  role={noticeTone === "bad" ? "alert" : "status"}
                >
                  {notice}
                </div>
              )}
              {awaitingDetail ? (
                <div
                  className="kl-empty"
                  role={detailError ? "alert" : "status"}
                >
                  <BookOpen size={28} />
                  <h3>
                    {detailError ? "暂时无法打开这条知识" : "正在打开知识条目…"}
                  </h3>
                  {detailError && (
                    <>
                      <p>{detailError}</p>
                      <button
                        className="ui-button-secondary"
                        onClick={() => {
                          setDetailError("");
                          setDetailReload((value) => value + 1);
                        }}
                      >
                        重试
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {readerTab === "read" && selectedCard && (
                    <KnowledgeReader
                      card={{
                        ...selectedCard,
                        ...payloadFromDraft(draft, draftRelatedIds),
                      }}
                      related={relatedChips}
                      sourceLabel={
                        hasManualKnowledgeSource(draft)
                          ? "手动来源片段"
                          : hasSourceReference
                            ? sourceReferenceLabel
                            : "尚未关联来源记录"
                      }
                      sourceState={sourceStateLabel[sourceState]}
                      sourceAvailable={hasSourceReference}
                      sourceLoading={sourceLoading}
                      onSource={() => {
                        sourceTriggerRef.current =
                          document.activeElement as HTMLButtonElement;
                        openSource();
                      }}
                      onEdit={() => setReaderTab("edit")}
                      onOpen={openCard}
                      onWikiLink={onWikiLink}
                    />
                  )}
                  {readerTab === "edit" && (
                    <div className="kl-edit knowledge-inspector">
                      <div className="knowledge-editor-fields grid gap-4">
                        <div>
                          <label
                            htmlFor="knowledge-card-title"
                            className="knowledge-field-label mb-1.5 block"
                          >
                            知识标题
                          </label>
                          <input
                            id="knowledge-card-title"
                            value={draft.title}
                            onChange={(e) =>
                              updateDraft({ title: e.target.value })
                            }
                            placeholder="用一句话回答：这条知识是什么？"
                            aria-required="true"
                            aria-invalid={!!fieldErrors.title}
                            aria-describedby={[
                              "knowledge-card-title-help",
                              fieldErrors.title ? validationErrorIds.title : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            className="knowledge-title-field ui-field h-11"
                          />
                          <p
                            id="knowledge-card-title-help"
                            className="mt-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]"
                          >
                            一句话说清这条知识解决什么问题。
                          </p>
                          {fieldErrors.title && (
                            <p
                              id={validationErrorIds.title}
                              className="mt-1.5 text-xs font-medium text-[var(--ui-danger-text)]"
                              role="alert"
                            >
                              {fieldErrors.title}
                            </p>
                          )}
                        </div>
                        <div>
                          <div
                            id="knowledge-card-content-label"
                            className="knowledge-field-label mb-1.5"
                          >
                            知识正文
                          </div>
                          <div
                            id="knowledge-card-content"
                            className="knowledge-body-editor ui-editor-surface ui-code-editor w-full min-w-0 overflow-hidden"
                            role="group"
                            tabIndex={-1}
                            aria-labelledby="knowledge-card-content-label"
                          >
                            <CodeMirror
                              value={draft.content}
                              onChange={(value) =>
                                updateDraft({ content: value })
                              }
                              extensions={[markdown(), EditorView.lineWrapping]}
                              placeholder="写下结论、方法或值得复用的内容，支持 Markdown…"
                              onCreateEditor={(view) => {
                                knowledgeEditorRef.current = view;
                                syncEditorAccessibility();
                              }}
                              theme={dark ? "dark" : "light"}
                              minHeight="360px"
                              basicSetup={{
                                lineNumbers: false,
                                foldGutter: false,
                                highlightActiveLine: false,
                              }}
                            />
                          </div>
                          <p
                            id="knowledge-card-content-help"
                            className="mt-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]"
                          >
                            支持 Markdown。已有条目的修改会自动保存。
                          </p>
                          {fieldErrors.content && (
                            <p
                              id={validationErrorIds.content}
                              className="mt-1.5 text-xs font-medium text-[var(--ui-danger-text)]"
                              role="alert"
                            >
                              {fieldErrors.content}
                            </p>
                          )}
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
                              <span className="block text-xs font-semibold text-[var(--ui-text)]">
                                整理知识条目
                              </span>
                              <span className="mt-1 block truncate text-[11px] text-[var(--ui-text-subtle)]">
                                {organizeSummary}
                              </span>
                            </span>
                            <ChevronDown
                              size={15}
                              className={`shrink-0 transition-transform ${organizeOpen ? "rotate-180" : ""}`}
                            />
                          </button>
                          {organizeOpen && (
                            <div
                              id="knowledge-card-organization"
                              className="mt-3 grid gap-4 border-t border-[var(--ui-border)] pt-3"
                            >
                              <div className="grid gap-3 2xl:grid-cols-[1fr_auto]">
                                <Picker
                                  label="类型"
                                  value={draft.card_type}
                                  options={typeOptions}
                                  primaryValues={[
                                    "fact",
                                    "method",
                                    "concept",
                                    "principle",
                                  ]}
                                  onChange={(value) =>
                                    updateDraft({
                                      card_type: value as KnowledgeCardType,
                                    })
                                  }
                                />
                                {selectedId ? (
                                  <Picker
                                    label="状态"
                                    value={draft.status}
                                    options={statusOptions}
                                    onChange={(value) => {
                                      // 状态变更统一经过服务端事务；尤其是“已沉淀”，
                                      // 不能在整理区通过普通字段保存绕过来源核验。
                                      void updateStatus(
                                        value as KnowledgeCardStatus,
                                      );
                                    }}
                                  />
                                ) : (
                                  <div className="min-w-0">
                                    <div className="ui-section-kicker mb-1.5">
                                      状态
                                    </div>
                                    <div className="ui-status-accent inline-flex min-h-8 items-center rounded-lg px-3 text-xs font-semibold">
                                      待确认
                                    </div>
                                    <p className="mt-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">
                                      新知识条目会先保存为草稿；来源可选，填写后会在确认时核验。
                                    </p>
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                  <label
                                    htmlFor="knowledge-card-tags"
                                    className="ui-section-kicker"
                                  >
                                    标签
                                  </label>
                                  {parsedTags.length > 0 && (
                                    <span className="text-[11px] text-[var(--ui-text-subtle)]">
                                      已添加 {parsedTags.length} 个
                                    </span>
                                  )}
                                </div>
                                <div className="ui-token-input max-h-32 overflow-y-auto pr-1">
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
                                    onChange={(e) =>
                                      setTagInput(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (
                                        !e.nativeEvent.isComposing &&
                                        e.keyCode !== 229 &&
                                        (e.key === "Enter" || e.key === ",")
                                      ) {
                                        e.preventDefault();
                                        addTag();
                                      }
                                      if (
                                        e.key === "Backspace" &&
                                        !tagInput &&
                                        parsedTags.length
                                      ) {
                                        removeTag(
                                          parsedTags[parsedTags.length - 1],
                                        );
                                      }
                                    }}
                                    onBlur={() => addTag()}
                                    placeholder={
                                      parsedTags.length
                                        ? "添加标签"
                                        : "添加标签"
                                    }
                                    className="h-8 min-w-[120px] flex-1 border-0 bg-transparent px-1 text-sm text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-subtle)]"
                                  />
                                </div>
                                {tagSuggestions.length > 0 && (
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <span className="text-[11px] text-[var(--ui-text-subtle)]">
                                      建议
                                    </span>
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
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                  <div className="ui-section-kicker">
                                    空间（主题或项目）
                                  </div>
                                  {parsedProjects.length > 0 && (
                                    <span className="text-[11px] text-[var(--ui-text-subtle)]">
                                      已添加 {parsedProjects.length} 个
                                    </span>
                                  )}
                                </div>
                                <div className="ui-token-input items-start pr-1">
                                  <div className="flex max-h-24 min-w-0 w-full flex-wrap content-start gap-1.5 overflow-y-auto">
                                    {parsedProjects.map((project) => (
                                      <button
                                        key={project}
                                        type="button"
                                        onClick={() => removeProject(project)}
                                        className="ui-chip border-[var(--ui-selected-border)] bg-[var(--ui-surface-selected)] text-[var(--ui-accent-text)] hover:bg-[var(--ui-surface-hover)]"
                                        title="点击移除空间"
                                        aria-label={`移除空间：${project}`}
                                      >
                                        <Folder size={12} /> {project}{" "}
                                        <X size={12} />
                                      </button>
                                    ))}
                                  </div>
                                  <SpaceAutocomplete
                                    spaces={projectCounts}
                                    value={projectInput}
                                    onChange={setProjectInput}
                                    onSelect={(name) => addProject(name)}
                                    onEnter={addProject}
                                    onComma={addProject}
                                    onKeyDown={(event) => {
                                      if (
                                        event.key === "Backspace" &&
                                        !projectInput &&
                                        parsedProjects.length
                                      ) {
                                        removeProject(
                                          parsedProjects[
                                            parsedProjects.length - 1
                                          ],
                                        );
                                      }
                                    }}
                                    onBlurCommit={addProject}
                                    placeholder="选择或输入空间"
                                    ariaLabel="知识条目所属空间"
                                    inputClassName="h-8 min-w-[120px] flex-1 border-0 bg-transparent px-1 pr-7 text-sm text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-subtle)]"
                                    containerClassName="basis-full min-w-0"
                                    showIcon={false}
                                  />
                                </div>
                              </div>
                              <div>
                                <div className="ui-section-kicker mb-1.5">
                                  关联知识条目
                                </div>
                                <Command
                                  shouldFilter={false}
                                  className="relative"
                                >
                                  <Command.Input
                                    value={relatedQuery}
                                    onValueChange={setRelatedQuery}
                                    placeholder="搜索并添加关联知识条目…"
                                    aria-label="关联知识条目"
                                    className="ui-field h-10 w-full"
                                  />
                                  {relatedQuery.trim() && (
                                    <Command.List className="ui-floating-surface absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-xl p-1">
                                      <Command.Empty className="px-3 py-2 text-sm text-[var(--ui-text-subtle)]">
                                        无匹配知识条目
                                      </Command.Empty>
                                      {relatedCandidates.map((card) => (
                                        <Command.Item
                                          key={card.id}
                                          value={card.title}
                                          onSelect={() => {
                                            editorGenerationRef.current += 1;
                                            setDraftRelatedIds((ids) =>
                                              ids.includes(card.id)
                                                ? ids
                                                : [...ids, card.id],
                                            );
                                            setRelatedQuery("");
                                            setDirty(true);
                                            setSaveState("idle");
                                          }}
                                          className="ui-command-item flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm"
                                        >
                                          <span className="truncate">
                                            {card.title}
                                          </span>
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

                      <details
                        className="kl-source-editor"
                        open={sourceExpanded}
                        onToggle={(event) =>
                          setSourceExpanded(event.currentTarget.open)
                        }
                      >
                        <summary>
                          <ShieldCheck size={16} />
                          来源与依据<span>{sourceStateLabel[sourceState]}</span>
                          <ChevronDown size={14} />
                        </summary>
                        <div className="flex min-w-0 flex-col">
                          <div className="knowledge-source-heading mb-2 flex items-center justify-between gap-2">
                            <div className="knowledge-field-label flex items-center gap-1.5">
                              <ShieldCheck
                                size={14}
                                className="text-[var(--ui-quote-text)]"
                              />{" "}
                              来源（可选）
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span
                                className="knowledge-source-state"
                                data-state={sourceState}
                              >
                                {sourceStateLabel[sourceState]}
                              </span>
                              {hasSourceReference && (
                                <button
                                  type="button"
                                  onClick={openSource}
                                  ref={sourceTriggerRef}
                                  disabled={sourceLoading}
                                  aria-label={`${sourceActionLabel}：${sourceReferenceLabel}`}
                                  className="ui-button-ghost h-11 min-h-11 gap-1 px-2 text-xs font-semibold text-[var(--ui-quote-text)] disabled:cursor-wait disabled:opacity-60 md:h-9 md:min-h-9"
                                >
                                  <ExternalLink size={12} /> {sourceActionLabel}
                                </button>
                              )}
                            </div>
                          </div>
                          <div
                            id="knowledge-source-panel"
                            className="knowledge-source-panel ui-editor-surface flex min-h-[280px] flex-1 scroll-mt-4 flex-col overflow-hidden"
                            data-source-state={sourceState}
                            aria-busy={sourceLoading}
                          >
                            <div
                              className="knowledge-source-titlebar ui-soft-divider flex items-center gap-2 border-b px-4 py-3"
                              role="status"
                              aria-live="polite"
                            >
                              <FileText
                                size={13}
                                className="shrink-0 text-[var(--ui-text-subtle)]"
                              />
                              <div className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--ui-text-muted)]">
                                {sourceLoading
                                  ? "加载来源..."
                                  : sourceError
                                    ? "来源暂时无法加载"
                                    : sourceArticle?.title ||
                                      sourceReview?.title ||
                                      (hasManualKnowledgeSource(draft)
                                        ? "手动来源片段"
                                        : draft.source_date
                                          ? `${draft.source_date} · ${currentSourceType}`
                                          : "暂无来源")}
                              </div>
                            </div>
                            {sourceError && (
                              <div
                                className="ui-alert-warn m-3 mb-0 flex items-start justify-between gap-3 text-xs leading-5"
                                role="alert"
                              >
                                <span className="min-w-0">
                                  {sourceError}
                                  。如果这是一条手动导入且不需要来源，可以清空来源字段后确认。
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {sourceConnectionError && (
                                    <button
                                      type="button"
                                      onClick={openConnectionSettings}
                                      className="ui-button-ghost h-11 min-h-11 px-2 text-[11px] md:h-9 md:min-h-9"
                                    >
                                      连接设置
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={retrySourceLoad}
                                    disabled={sourceLoading}
                                    className="ui-button-ghost h-11 min-h-11 px-2 text-[11px] md:h-9 md:min-h-9"
                                  >
                                    {sourceLoading ? "重试中..." : "重试加载"}
                                  </button>
                                </span>
                              </div>
                            )}
                            {fieldErrors.source && (
                              <p
                                id={validationErrorIds.source}
                                className="ui-alert-bad m-3 mb-0 text-xs leading-5"
                                role="alert"
                              >
                                {fieldErrors.source}
                              </p>
                            )}
                            <div className="knowledge-source-excerpt px-4 pt-4">
                              <label
                                htmlFor="knowledge-source-excerpt"
                                className="knowledge-field-label mb-1.5 block"
                              >
                                证据片段（可选）
                              </label>
                              <p
                                id="knowledge-source-excerpt-help"
                                className="mb-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]"
                              >
                                有来源时，粘贴能直接支撑正文的连续片段，方便以后复核；手动导入可以留空。
                              </p>
                              <p
                                className={[
                                  "mb-2 text-[11px] leading-4",
                                  sourceState === "verified"
                                    ? "text-[var(--ui-success-text)]"
                                    : sourceState === "mismatch" ||
                                        sourceState === "error"
                                      ? "text-[var(--ui-danger-text)]"
                                      : "text-[var(--ui-text-subtle)]",
                                ].join(" ")}
                                role="status"
                                aria-live="polite"
                              >
                                {sourceState === "empty" &&
                                  "未填写来源；手动导入的知识条目可以直接确认。"}
                                {sourceState === "manual" &&
                                  "已填写手动来源片段；不关联记录也可以直接确认。"}
                                {sourceState === "incomplete" &&
                                  "关联来源还不完整；请补齐定位和连续片段，或清空关联字段。"}
                                {sourceState === "locator" &&
                                  "已记录来源定位；打开原文后再粘贴可匹配的连续片段。"}
                                {sourceState === "loading" &&
                                  "正在读取来源，请稍候。"}
                                {sourceState === "ready" &&
                                  "原文已读取；还需要一段能直接支撑正文的连续片段。"}
                                {sourceState === "verified" &&
                                  "片段已在当前原文中找到，可以进入确认沉淀。"}
                                {sourceState === "mismatch" &&
                                  "片段未在当前原文中找到，请从原文重新复制，避免把推断写成证据。"}
                                {sourceState === "error" &&
                                  "来源读取失败；可以修复连接后重试，也可以清空来源字段。"}
                              </p>
                              <textarea
                                id="knowledge-source-excerpt"
                                aria-label="支撑知识条目的来源片段"
                                aria-invalid={!!fieldErrors.source}
                                aria-describedby={[
                                  "knowledge-source-excerpt-help",
                                  fieldErrors.source
                                    ? validationErrorIds.source
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                value={draft.source_excerpt}
                                onChange={(e) =>
                                  updateDraft({
                                    source_excerpt: e.target.value,
                                  })
                                }
                                placeholder="有来源时粘贴连续原文片段"
                                className="min-h-[120px] w-full resize-none rounded-sm border-0 bg-transparent px-0 py-1 text-xs leading-5 text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40"
                              />
                            </div>
                            <div className="grid gap-2 p-3 pt-3">
                              <label
                                className="ui-section-kicker"
                                htmlFor="knowledge-source-date"
                              >
                                来源日期（可选）
                              </label>
                              <input
                                id="knowledge-source-date"
                                type="date"
                                value={draft.source_date}
                                onChange={(e) =>
                                  updateDraft({ source_date: e.target.value })
                                }
                                aria-invalid={!!fieldErrors.source}
                                aria-describedby={[
                                  "knowledge-source-date-help",
                                  fieldErrors.source
                                    ? validationErrorIds.source
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                className="ui-field h-11 min-h-11 text-xs"
                              />
                              <p
                                id="knowledge-source-date-help"
                                className="text-[11px] leading-4 text-[var(--ui-text-subtle)]"
                              >
                                有来源时可填写原文日期，格式为 YYYY-MM-DD。
                              </p>
                              <label
                                className="ui-section-kicker"
                                htmlFor="knowledge-source-id"
                              >
                                关联来源 ID（只读）
                              </label>
                              <p
                                id="knowledge-source-id-help"
                                className="text-[11px] leading-4 text-[var(--ui-text-subtle)]"
                              >
                                有可读取来源时自动带入；手动来源片段可以留空。
                              </p>
                              <input
                                id="knowledge-source-id"
                                value={
                                  draft.source_article_id ||
                                  draft.source_review_id
                                }
                                readOnly
                                placeholder="没有关联记录（可选）"
                                aria-describedby="knowledge-source-id-help"
                                className="ui-field h-11 min-h-11 text-xs text-[var(--ui-text-muted)]"
                              />
                            </div>
                          </div>
                        </div>
                      </details>
                      {duplicateHint && (
                        <div className="ui-alert-warn mt-4" role="status">
                          {duplicateHint}
                        </div>
                      )}
                    </div>
                  )}
                  {readerTab === "review" && (
                    <div
                      className="kl-review"
                      id="knowledge-review-panel"
                      tabIndex={-1}
                    >
                      {selectedCard && (
                        <ReviewItemsPanel
                          cardId={selectedCard.id}
                          cardStatus={draft.status}
                          contentVersion={selectedCard.content_version}
                        />
                      )}

                      {selectedCard &&
                        (relatedChips.length > 0 ||
                          reviewHistory.length > 1) && (
                          <div className="mt-4 grid gap-3">
                            {relatedChips.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="ui-section-kicker">关联</span>
                                {relatedChips.map((chip) => (
                                  <span
                                    key={chip.id}
                                    className="ui-status-accent inline-flex max-w-[220px] items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => openCard(chip)}
                                      className="truncate transition-colors hover:underline"
                                    >
                                      {chip.title}
                                    </button>
                                    {draftRelatedIds.includes(chip.id) ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          editorGenerationRef.current += 1;
                                          setDraftRelatedIds((ids) =>
                                            ids.filter((id) => id !== chip.id),
                                          );
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
                                        title="这是来自另一个知识条目的关联，请打开对方条目后移除"
                                        aria-label="来自另一个知识条目的关联"
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
                                  <span className="ui-section-kicker">
                                    复习间隔趋势
                                  </span>
                                  <span className="text-[11px] text-[var(--ui-text-subtle)]">
                                    最近{" "}
                                    {reviewHistory[
                                      reviewHistory.length - 1
                                    ].interval_days.toFixed(0)}{" "}
                                    天
                                  </span>
                                </div>
                                <IntervalChart history={reviewHistory} />
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  )}
                </>
              )}
            </div>
            {!awaitingDetail && (
              <footer className="kl-detail-footer">
                <span>
                  {readerTab === "edit"
                    ? selectedId
                      ? "修改自动保存 · Ctrl / ⌘ S 立即保存"
                      : "先创建草稿，再确认沉淀"
                    : "知识条目 · 持续积累与复用"}
                </span>
                <div>
                  {selectedId && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="kl-icon"
                          aria-label="当前条目更多操作"
                          disabled={saving}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            void updateStatus(
                              draft.status === "outdated"
                                ? "confirmed"
                                : "outdated",
                            )
                          }
                        >
                          {draft.status === "outdated"
                            ? "恢复为已确认"
                            : "标记为过时"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => void deleteCards()}
                          className="text-[var(--ui-danger-text)]"
                        >
                          <Trash2 size={14} />
                          移入回收站
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {selectedId && draft.status === "draft" && (
                    <button
                      type="button"
                      className="ui-button-primary"
                      disabled={saving}
                      onClick={() => void updateStatus("confirmed")}
                    >
                      <CheckCircle2 size={15} />
                      确认沉淀
                    </button>
                  )}
                  {selectedId && readerTab === "edit" && (
                    <button
                      type="button"
                      className="ui-button-secondary"
                      disabled={saving || saveState === "saving" || !dirty}
                      onClick={() => void retrySaveDraft()}
                    >
                      <Save size={15} />
                      {saveState === "error" ? "重试保存" : "保存"}
                    </button>
                  )}
                  {!selectedId && (
                    <button
                      type="button"
                      className="ui-button-primary"
                      disabled={saving}
                      onClick={() => void saveNewCard()}
                    >
                      <Plus size={15} />
                      {saving ? "创建中…" : "创建草稿"}
                    </button>
                  )}
                </div>
              </footer>
            )}
          </section>
        }
      />
      {sourceDetailOpen && sourceArticle && (
        <ArticleDetail
          article={sourceArticle}
          highlight={draft.source_excerpt}
          onClose={() => setSourceDetailOpen(false)}
          onEdit={editSourceArticle}
          returnFocusRef={sourceTriggerRef}
        />
      )}
      {sourceDetailOpen && sourceReview && (
        <ReviewSourceDetail
          review={sourceReview}
          highlight={draft.source_excerpt}
          onClose={() => setSourceDetailOpen(false)}
          returnFocusRef={sourceTriggerRef}
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
          if (typeof window !== "undefined")
            writeSessionStorage("daily-summary-settings-tab", "ai");
          onNavigate("settings");
        }}
      />
      {dialog}
    </div>
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
            {space?.description || "每日记录负责捕捉过程，知识条目负责沉淀可复用结论。"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-[var(--ui-text-subtle)]">
        <span className="ui-chip h-auto px-2 py-0.5">{cardCount} 个知识条目</span>
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

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={active ? "ui-filter-button min-h-11 md:min-h-9 ui-filter-button-active" : "ui-filter-button min-h-11 md:min-h-9"}
    >
      {children}
    </button>
  );
}

function TypeFilterSelect({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  return (
    <Select value={value || "all"} onValueChange={(nextValue) => onChange(nextValue === "all" ? "" : nextValue)}>
      <SelectTrigger
        className={compact ? "h-9 min-h-9 w-full rounded-lg px-2 text-xs" : "h-11 min-h-11 w-full rounded-xl px-3 text-xs md:h-9 md:min-h-9"}
        aria-label="按类型筛选"
      >
        <SelectValue placeholder="全部类型" />
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[160px]">
        <SelectItem value="all" className="justify-start px-2 pr-8 text-xs">全部类型</SelectItem>
        {typeOptions.map(([type, label]) => (
          <SelectItem key={type} value={type} className="justify-start px-2 pr-8 text-xs">{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TagFilterPicker({
  tags,
  selectedTag,
  onChange,
  inputId,
  compact = false,
}: {
  tags: api.KnowledgeTagCount[];
  selectedTag: string;
  onChange: (tag: string) => void;
  inputId: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const limit = compact ? 10 : 12;
  const matchingTags = useMemo(
    () => tags.filter(({ tag }) => !normalizedQuery || tag.toLocaleLowerCase().includes(normalizedQuery)),
    [normalizedQuery, tags],
  );
  const selectedTagEntry = tags.find(({ tag }) => tag === selectedTag);
  const orderedTags = selectedTagEntry && !matchingTags.some(({ tag }) => tag === selectedTag)
    ? [selectedTagEntry, ...matchingTags]
    : matchingTags;
  const visibleTags = showAll || normalizedQuery ? orderedTags : orderedTags.slice(0, limit);
  const canSearch = tags.length > limit;
  const canExpand = orderedTags.length > visibleTags.length;

  if (tags.length === 0) return <p className="text-xs text-[var(--ui-text-subtle)]">暂无标签</p>;

  return (
    <div className="space-y-2">
      {canSearch && (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ui-text-subtle)]" size={compact ? 14 : 13} />
          <input
            id={inputId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选标签"
            aria-label="筛选标签"
            className={compact ? "ui-field h-11 min-h-11 pl-9 text-xs" : "ui-field h-8 min-h-8 pl-8 text-[11px]"}
          />
        </label>
      )}
      {orderedTags.length === 0 ? (
        <p className="text-xs text-[var(--ui-text-subtle)]">没有匹配的标签</p>
      ) : (
        <div className={compact ? "flex max-h-32 flex-wrap gap-2 overflow-y-auto" : "flex max-h-44 flex-wrap gap-1.5 overflow-y-auto"}>
          {visibleTags.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              onClick={() => onChange(selectedTag === tag ? "" : tag)}
              className={[
                compact ? "ui-filter-button min-h-11 gap-1 px-2.5 md:min-h-8" : "ui-filter-button min-h-9 gap-1 px-2 md:min-h-8",
                selectedTag === tag ? "ui-filter-button-active" : "",
              ].join(" ")}
            >
              #{tag} <span className="opacity-60">{count}</span>
            </button>
          ))}
        </div>
      )}
      {canExpand && (
        <button
          type="button"
          onClick={() => setShowAll((open) => !open)}
          aria-expanded={showAll}
          className={compact ? "ui-button-ghost h-11 min-h-11 w-full justify-between px-1.5 text-[11px]" : "ui-button-ghost h-8 min-h-8 w-full justify-between px-1.5 text-[11px]"}
        >
          <span>{showAll ? "收起标签" : `显示全部 ${orderedTags.length} 个标签`}</span>
          <ChevronDown size={13} className={showAll ? "rotate-180" : ""} />
        </button>
      )}
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
            contentStyle={{ borderRadius: 8, border: "1px solid var(--ui-border)", backgroundColor: "var(--ui-surface-raised)", color: "var(--ui-text)", fontSize: 12 }}
            labelStyle={{ color: "var(--ui-text-muted)" }}
            formatter={(value) => [`${Number(value).toFixed(0)} 天`, "间隔"]}
            labelFormatter={(label) => `第 ${label} 次复习`}
          />
          <Line type="monotone" dataKey="days" stroke="var(--ui-accent-solid)" strokeWidth={1.5} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
