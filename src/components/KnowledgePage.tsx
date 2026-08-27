import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { Command } from "cmdk";
import {
  ArrowLeft,
  Bookmark,
  BookMarked,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  Lightbulb,
  LayoutList,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Save,
  ShieldCheck,
  Rows3,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import type { Page } from "../App";
import type { Article, KnowledgeCard, KnowledgeCardStatus, KnowledgeCardType } from "../lib/api";
import { cardStatusLabels as statusLabels, cardTypeLabels as typeLabels } from "../lib/cardLabels";
import { normalizeTags } from "../lib/tags";
import MarkdownContent from "./MarkdownContent";
import { useConfirmDialog } from "./ui/Feedback";
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
import PageHeader from "./ui/PageHeader";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

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
  ["missing_source", "缺少来源", "需要补回原文日期或证据片段"],
  ["missing_project", "未归入项目", "还没有项目归属"],
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

function payloadFromDraft(draft: DraftState) {
  return {
    card_type: draft.card_type,
    status: draft.status,
    title: draft.title.trim(),
    content: draft.content.trim(),
    tags: normalizeTags(draft.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean)),
    projects: normalizeTags(draft.projectsText.split(",").map((tag) => tag.trim()).filter(Boolean)),
    source_date: draft.source_date.trim(),
    source_article_id: draft.source_article_id.trim(),
    source_review_id: draft.source_review_id.trim(),
    source_excerpt: draft.source_excerpt.trim(),
  };
}

function compact(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
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
  return merged.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
  const [activeStatus, setActiveStatus] = useState<KnowledgeStatusFilter>(initialStatus || "draft");
  const [typeFilter, setTypeFilter] = useState(initialType || "");
  const [usageFilter, setUsageFilter] = useState<KnowledgeUsage>(initialUsage || "");
  const [qualityFilter, setQualityFilter] = useState<KnowledgeQuality>(initialQuality || "");
  const [sort, setSort] = useState<KnowledgeSort>(initialSort || "updated");
  const [tagFilter, setTagFilter] = useState(initialTag || "");
  const [tagCounts, setTagCounts] = useState<api.KnowledgeTagCount[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [projectFilter, setProjectFilter] = useState(initialProject || "");
  const [projectCounts, setProjectCounts] = useState<api.KnowledgeProject[]>([]);
  const [projectInput, setProjectInput] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [savedViews, setSavedViews] = useState<api.KnowledgeSavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState("");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [savingView, setSavingView] = useState(false);
  const [batchMode, setBatchMode] = useState<KnowledgeBatchMode>("");
  const [batchValue, setBatchValue] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileBatchOpen, setMobileBatchOpen] = useState(false);
  const [density, setDensity] = useState<KnowledgeDensity>(() => {
    if (typeof window === "undefined") return "comfortable";
    return localStorage.getItem("knowledge-density") === "compact" ? "compact" : "comfortable";
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
  const [sourceArticle, setSourceArticle] = useState<Article | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [draftRelatedIds, setDraftRelatedIds] = useState<string[]>([]);
  const [relatedQuery, setRelatedQuery] = useState("");
  const [reviewHistory, setReviewHistory] = useState<api.ReviewHistoryEntry[]>([]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedSignature = useRef("");
  const touchedCardIds = useRef<Set<string>>(new Set());
  const routeQueryRef = useRef(initialQuery || "");
  const cardListRequestRef = useRef(0);
  const relatedSearchRequestRef = useRef(0);
  const duplicateSearchRequestRef = useRef(0);
  const { confirm, dialog } = useConfirmDialog();
  const queryClient = useQueryClient();
  const isNewRoute = initialView === "detail" && !initialCardId;
  const invalidateKnowledgeQueries = () => queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.cardsRoot });
  const invalidateKnowledgeMetadata = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.tags }),
    queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.projects }),
  ]);
  const showNotice = (message: string, tone: NoticeTone = "neutral") => {
    setNotice(message);
    setNoticeTone(tone);
  };

  const changeDensity = (next: KnowledgeDensity) => {
    setDensity(next);
    if (typeof window !== "undefined") localStorage.setItem("knowledge-density", next);
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
    const nextStatus = initialStatus || "draft";
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
    if (initialType || initialUsage || initialQuality || initialTag || initialProject || (initialStatus && initialStatus !== "draft")) {
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
    setActiveViewId("");
    setPage(1);
    onSearchParamsChange?.({ status, page: undefined });
  };

  const changeType = (type: string) => {
    setTypeFilter(type);
    setActiveViewId("");
    setPage(1);
    onSearchParamsChange?.({ type: type || undefined, page: undefined });
  };

  const changeProject = (project: string) => {
    setProjectFilter(project);
    setActiveViewId("");
    setPage(1);
    onSearchParamsChange?.({ project: project || undefined, page: undefined });
  };

  const changeTag = (tag: string) => {
    setTagFilter(tag);
    setActiveViewId("");
    setPage(1);
    onSearchParamsChange?.({ tag: tag || undefined, page: undefined });
  };

  const changeSort = (value: string) => {
    const next = sortOptions.some(([option]) => option === value) ? value as KnowledgeSort : "updated";
    setSort(next);
    setActiveViewId("");
    setPage(1);
    onSearchParamsChange?.({ sort: next === "updated" ? undefined : next, page: undefined });
  };

  const changeUsage = (value: KnowledgeUsage) => {
    setUsageFilter(value);
    setActiveViewId("");
    setPage(1);
    onSearchParamsChange?.({ usage: value || undefined, page: undefined });
  };

  const changeQuality = (value: KnowledgeQuality) => {
    setQualityFilter(value);
    setActiveViewId("");
    setPage(1);
    onSearchParamsChange?.({ quality: value || undefined, page: undefined });
  };

  const searchCards = () => {
    const nextQuery = query.trim();
    routeQueryRef.current = nextQuery;
    setActiveViewId("");
    setPage(1);
    onSearchParamsChange?.({ q: nextQuery || undefined, page: undefined });
    void loadCards(false, true, nextQuery, undefined, 1);
  };

  const currentViewFilters = useMemo<api.KnowledgeViewFilters>(() => ({
    q: query.trim() || undefined,
    project: projectFilter || undefined,
    tag: tagFilter || undefined,
    status: activeStatus === "all" ? "all" : activeStatus,
    type: typeFilter ? typeFilter as KnowledgeCardType : undefined,
    usage: usageFilter || undefined,
    sort: sort === "updated" ? undefined : sort,
    quality: qualityFilter || undefined,
  }), [activeStatus, projectFilter, qualityFilter, query, sort, tagFilter, typeFilter, usageFilter]);

  useEffect(() => {
    let cancelled = false;
    queryClient.fetchQuery({
      queryKey: api.knowledgeQueryKeys.savedViews,
      queryFn: ({ signal }) => api.listKnowledgeSavedViews({ signal }),
      staleTime: 60_000,
    })
      .then((views) => { if (!cancelled) setSavedViews(views); })
      .catch((e) => { if (!cancelled) toast.error(api.getErrorMessage(e)); });
    return () => { cancelled = true; };
  }, [queryClient]);

  const applySavedView = (view: api.KnowledgeSavedView) => {
    const filters = view.filters || {};
    setActiveViewId(view.id);
    routeQueryRef.current = filters.q || "";
    setQuery(filters.q || "");
    setProjectFilter(filters.project || "");
    setTagFilter(filters.tag || "");
    setActiveStatus(filters.status || "draft");
    setTypeFilter(filters.type || "");
    setUsageFilter(filters.usage || "");
    setQualityFilter(filters.quality || "");
    setSort(filters.sort || "updated");
    setPage(1);
    setSelectedIds([]);
    if (isMobile) setMobileView("list");
    if (initialCardId) onBackToList?.();
    void loadCards(false, true, filters.q || "", {
      cardType: filters.type || "",
      status: filters.status || "draft",
      usage: filters.usage || "",
      tag: filters.tag || "",
      project: filters.project || "",
      sort: filters.sort || "updated",
      quality: filters.quality || "",
    }, 1);
    onSearchParamsChange?.({
      q: filters.q || undefined,
      project: filters.project || undefined,
      tag: filters.tag || undefined,
      status: filters.status || "draft",
      type: filters.type || undefined,
      usage: filters.usage || undefined,
      sort: filters.sort || undefined,
      quality: filters.quality || undefined,
      view: "list",
      page: undefined,
    });
  };

  const saveCurrentView = async () => {
    const name = viewName.trim();
    if (!name) return;
    setSavingView(true);
    try {
      const view = await api.createKnowledgeSavedView(name, currentViewFilters);
      await queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.savedViews });
      setSavedViews((current) => [view, ...current]);
      setActiveViewId(view.id);
      setViewName("");
      setSaveViewOpen(false);
      toast.success(`视图「${view.name}」已保存。`);
    } catch (e) {
      toast.error(api.getErrorMessage(e));
    } finally {
      setSavingView(false);
    }
  };

  const deleteActiveView = async () => {
    const view = savedViews.find((item) => item.id === activeViewId);
    if (!view) return;
    const ok = await confirm({
      title: "删除保存视图",
      message: `删除视图「${view.name}」？这不会删除任何知识卡片。`,
      confirmText: "删除视图",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteKnowledgeSavedView(view.id);
      await queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.savedViews });
      setSavedViews((current) => current.filter((item) => item.id !== view.id));
      setActiveViewId("");
      toast.success("保存视图已删除。");
    } catch (e) {
      toast.error(api.getErrorMessage(e));
    }
  };

  const saveDirtyDraft = async () => {
    if (!dirty || !selectedId) return;
    const pending = payloadFromDraft(draft);
    if (!pending.title || !pending.content) {
      throw new Error("请先补全当前卡片的标题和内容。");
    }
    const saved = await api.updateKnowledgeCard(selectedId, pending);
    await invalidateKnowledgeQueries();
    lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(saved)));
    setCards((items) => items.map((item) => item.id === saved.id ? saved : item));
    setDetailCard(saved);
    setDirty(false);
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
    // related_ids 不在 payloadFromDraft 内，后端 update 会保留原值，不会误清。
    if (savePending && dirty && selectedId) {
      try {
        await saveDirtyDraft();
      } catch {
        // 保存失败不阻断列表刷新；内容会留待下次 auto-save 重试
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
          queryKey: api.knowledgeQueryKeys.summary,
          queryFn: ({ signal }) => api.getKnowledgeSummary({ signal }),
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
        setDraft((current) => current.title || current.content ? current : { ...emptyDraft, status: status === "all" ? "draft" : status });
        lastSavedSignature.current = "";
        return;
      }
      if ((keepSelection || initialCardId) && selectedId && pageResult.cards.some((card) => card.id === selectedId)) return;
      const next = pageResult.cards[0] || null;
      setSelectedId(next?.id || null);
      setDraft(next ? toDraft(next) : emptyDraft);
      setDetailCard(next);
      setDirty(false);
      lastSavedSignature.current = next ? JSON.stringify(payloadFromDraft(toDraft(next))) : "";
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

  useEffect(() => {
    let cancelled = false;
    queryClient.fetchQuery({
      queryKey: api.knowledgeQueryKeys.projects,
      queryFn: ({ signal }) => api.listKnowledgeProjects({ signal }),
      staleTime: 60_000,
    })
      .then((projects) => { if (!cancelled) setProjectCounts((current) => mergeProjectCounts(current, projects)); })
      .catch(() => { if (!cancelled) setProjectCounts([]); });
    return () => { cancelled = true; };
  }, [queryClient]);

  useEffect(() => {
    if (!selectedCard?.source_article_id) {
      setSourceArticle(null);
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    api.getArticle(selectedCard.source_article_id)
      .then((article) => { if (!cancelled) setSourceArticle(article); })
      .catch(() => { if (!cancelled) setSourceArticle(null); })
      .finally(() => { if (!cancelled) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCard?.source_article_id]);

  useEffect(() => {
    if (!selectedId || !dirty) return;
    const payload = payloadFromDraft(draft);
    if (!payload.title || !payload.content) return;
    const signature = JSON.stringify(payload);
    if (signature === lastSavedSignature.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        const saved = await api.updateKnowledgeCard(selectedId, payload);
        await invalidateKnowledgeQueries();
        lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(saved)));
        setCards((items) => items.map((item) => item.id === saved.id ? saved : item));
        setDetailCard(saved);
        setDirty(false);
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        showNotice(api.getErrorMessage(e), "bad");
      }
    }, 900);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [dirty, draft, selectedId]);

  const updateDraft = (patch: Partial<DraftState>) => {
    setDraft((value) => ({ ...value, ...patch }));
    setDirty(true);
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
    () => normalizeTags(draft.projectsText.split(",").map((project) => project.trim()).filter(Boolean)),
    [draft.projectsText]
  );

  const addProject = (raw?: string) => {
    const input = (raw ?? projectInput).trim();
    const parts = input.split(",").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...parsedProjects];
    for (const part of parts) {
      const project = normalizeTags([part])[0];
      if (project && !next.includes(project)) next.push(project);
    }
    updateDraft({ projectsText: next.join(", ") });
    setProjectInput("");
  };

  const removeProject = (project: string) => {
    updateDraft({ projectsText: parsedProjects.filter((item) => item !== project).join(", ") });
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const project = await api.createKnowledgeProject(name);
      await invalidateKnowledgeMetadata();
      setProjectCounts((prev) => mergeProjectCounts(prev, [project]));
      changeProject(project.name);
      setNewProjectName("");
      const message = `项目「${project.name}」已创建。`;
      showNotice(message, "good");
      toast.success(message);
    } catch (e) {
      const message = api.getErrorMessage(e);
      showNotice(message, "bad");
      toast.error(message);
    }
  };

  const projectSuggestions = useMemo(
    () => projectCounts.filter(({ name }) => !parsedProjects.includes(name)).slice(0, 6),
    [projectCounts, parsedProjects]
  );

  const tagSuggestions = useMemo(
    () => tagCounts.filter(({ tag }) => !parsedTags.includes(tag)).slice(0, 8),
    [tagCounts, parsedTags]
  );

  const selectCard = (card: KnowledgeCard) => {
    setSelectedId(card.id);
    setDetailCard(card);
    setDraft(toDraft(card));
    setDraftRelatedIds(card.declared_related_ids?.length ? card.declared_related_ids : card.related_ids || []);
    setDirty(false);
    setNotice("");
    setSaveState("idle");
    lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(card)));
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
    selectCard(card);
    if (isMobile) {
      setMobileView("detail");
    }
    onOpenCard?.(card.id);
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

  const relatedChips = useMemo(
    () => draftRelatedIds
      .map((id) => cards.find((card) => card.id === id) || relatedCards.find((card) => card.id === id))
      .filter((card): card is KnowledgeCard => !!card),
    [cards, draftRelatedIds, relatedCards]
  );

  const relatedCandidates = useMemo(() => {
    return relatedSearchCards
      .filter((card) => card.id !== selectedId && !draftRelatedIds.includes(card.id))
      .slice(0, 8);
  }, [draftRelatedIds, relatedSearchCards, selectedId]);

  useEffect(() => {
    const ids = draftRelatedIds.filter((id) => !cards.some((card) => card.id === id));
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
  }, [cards, draftRelatedIds, queryClient]);

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
    setSelectedId(null);
    setDraft({ ...emptyDraft, status: activeStatus === "all" ? "draft" : activeStatus });
    setDraftRelatedIds([]);
    setRelatedQuery("");
    setDirty(false);
    setNotice("");
    setSaveState("idle");
    if (isMobile) setMobileView("detail");
    onNewCard?.();
  };

  const closeMobileDetail = async () => {
    if (dirty && selectedId) {
      try {
        await saveDirtyDraft();
      } catch (e) {
        showNotice(api.getErrorMessage(e), "bad");
        return;
      }
    } else if (dirty && (draft.title.trim() || draft.content.trim())) {
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
    if (!payload.title || !payload.content) {
      showNotice("标题和内容都必填。");
      return;
    }
    setSaving(true);
    try {
      const creating = !selectedId;
      const saved = selectedId
        ? await api.updateKnowledgeCard(selectedId, { ...payload, related_ids: draftRelatedIds })
        : await api.createKnowledgeCard({ ...payload, related_ids: draftRelatedIds });
      await invalidateKnowledgeQueries();
      await invalidateKnowledgeMetadata();
      setDirty(false);
      await loadCards(true, false);
      setSelectedId(saved.id);
      setDraft(toDraft(saved));
      setDetailCard(saved);
      setDirty(false);
      setSaveState("saved");
      lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(saved)));
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
    setSaving(true);
    try {
      await saveDirtyDraft();
      await api.batchKnowledgeCards({
        ids,
        action: status === "confirmed" ? "confirm" : "set_status",
        values: status === "confirmed" ? [] : [status],
      });
      await invalidateKnowledgeQueries();
      setSelectedIds([]);
      await loadCards(false, false);
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
      await invalidateKnowledgeMetadata();
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
      message: ids.length === 1 ? "将当前知识卡片移入回收站？正文、项目关系和复习记录都可以恢复。" : `将选中的 ${ids.length} 张卡片移入回收站？正文、项目关系和复习记录都可以恢复。`,
      confirmText: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      if (!(selectedId && ids.includes(selectedId))) await saveDirtyDraft();
      await api.batchKnowledgeCards({ ids, action: "delete" });
      await invalidateKnowledgeQueries();
      await invalidateKnowledgeMetadata();
      setSelectedIds([]);
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
      await saveDirtyDraft();
      const action = batchMode === "tag" || batchMode === "remove_tag"
        ? batchMode === "tag" ? "add_tags" : "remove_tags"
        : batchMode === "move_project"
          ? "set_projects"
          : batchMode === "remove_project"
            ? "remove_projects"
            : "add_projects";
      await api.batchKnowledgeCards({ ids: selectedIds, action, values });
      await invalidateKnowledgeQueries();
      await invalidateKnowledgeMetadata();
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
            ? `已将 ${ids} 张卡片移出项目「${values[0]}」。`
            : `已为 ${ids} 张卡片加入项目。`;
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
    if (draft.source_review_id || selectedCard?.source_review_id) {
      onNavigate("reviews");
      return;
    }
    const sourceDate = sourceArticle?.date || draft.source_date || selectedCard?.source_date;
    if (sourceDate) onEditDate(sourceDate);
  };
  const currentSourceType = draft.source_review_id || selectedCard?.source_review_id ? "AI 复盘" : "每日记录";

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
  const activeFilterCount = [activeQuery, typeFilter, usageFilter, qualityFilter, tagFilter, projectFilter, activeStatus !== "draft" ? activeStatus : "", sort !== "updated" ? sort : ""].filter(Boolean).length;
  const activeStatusLabel = activeStatus === "all" ? "全部状态" : statusLabels[activeStatus];
  const emptyStatusLabel = activeStatus === "all" ? "卡片" : `${statusLabels[activeStatus]}卡片`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-surface page-surface-knowledge min-h-full px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden"
    >
      <PageHeader
        icon={BookMarked}
        title="知识工作台"
        description="把真实记录沉淀成可追溯、可确认的知识卡片"
        navigation={
          <Tabs value={activeStatus} onValueChange={(v) => changeStatus(v as KnowledgeStatusFilter)} className="hidden md:block md:w-[500px]">
            <TabsList className="grid w-full grid-cols-4">
              {statusFilterOptions.map(([status, label]) => (
                <TabsTrigger key={status} value={status}>
                  {label} <span className="font-mono text-[11px] opacity-70">{status === "all" ? counts.total : counts[status]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="ui-panel-muted mb-4 flex flex-wrap items-center gap-2 p-2.5">
        <span className="ui-status-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <Bookmark size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[var(--ui-text)]">保存视图</div>
          <div className="hidden truncate text-[11px] text-[var(--ui-text-subtle)] sm:block">把当前搜索、筛选和排序保存为可复用的工作入口</div>
        </div>
        {savedViews.length > 0 ? (
          <select
            value={activeViewId}
            onChange={(e) => {
              const view = savedViews.find((item) => item.id === e.target.value);
              if (view) applySavedView(view);
              else setActiveViewId("");
            }}
            className="ui-field h-9 min-w-0 max-w-[220px] flex-1 text-xs"
            aria-label="选择保存视图"
          >
            <option value="">选择视图...</option>
            {savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
          </select>
        ) : (
          <span className="hidden text-[11px] text-[var(--ui-text-subtle)] sm:block">还没有保存视图</span>
        )}
        <button
          type="button"
          onClick={() => { setViewName(""); setSaveViewOpen(true); }}
          className="ui-button-secondary h-9 shrink-0 px-2.5 text-xs"
        >
          <Save size={14} /> 保存当前
        </button>
        {activeViewId && (
          <button
            type="button"
            onClick={() => void deleteActiveView()}
            className="ui-icon-button ui-icon-button-danger h-9 w-9 shrink-0"
            aria-label="删除当前保存视图"
            title="删除当前保存视图"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <Dialog.Root open={saveViewOpen} onOpenChange={setSaveViewOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-[70] backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
          <Dialog.Content className="ui-modal-surface fixed left-1/2 top-1/2 z-[71] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-5 outline-hidden">
            <Dialog.Title className="text-base font-semibold text-[var(--ui-text)]">保存当前视图</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
              保存搜索、项目、标签、状态、类型、质量问题和排序，下次可以直接恢复这组工作条件。
            </Dialog.Description>
            <input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveCurrentView(); } }}
              className="ui-field mt-4 h-10"
              placeholder="例如：待确认 · FPGA"
              maxLength={80}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="ui-button-secondary h-9 px-3 text-xs">取消</button>
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void saveCurrentView()}
                disabled={savingView || !viewName.trim()}
                className="ui-button-primary h-9 px-3 text-xs"
              >
                {savingView ? "保存中..." : "保存视图"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {error && (
        <div className="ui-alert-bad mb-4 flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => void loadCards(false, false)} disabled={loading} className="ui-button-danger h-8 shrink-0 px-2.5 text-xs">
            {loading ? "重试中..." : "重试"}
          </button>
        </div>
      )}

      {mobileView === "list" && (
        <div className="mb-3 flex gap-2 xl:hidden">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            className="ui-mobile-control flex h-11 min-w-0 flex-1 items-center gap-2 text-left shadow-xs"
          >
            <Search size={16} className="shrink-0 text-[var(--ui-accent-text)]" />
            <span className="min-w-0 flex-1 truncate">{query || "搜索与筛选卡片"}</span>
            {activeFilterCount > 0 && <span className="ui-status-accent inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold">{activeFilterCount}</span>}
            <SlidersHorizontal size={15} className="shrink-0 text-[var(--ui-text-subtle)]" />
          </button>
          <button type="button" onClick={startNew} className="ui-button-primary h-11 shrink-0 px-3">
            <Plus size={15} /> <span>新建</span>
          </button>
        </div>
      )}

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="px-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <SheetHeader>
            <SheetTitle>搜索与筛选</SheetTitle>
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
                        "ui-filter-button w-full min-h-12 flex-col items-start justify-center",
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
                <div className="ui-section-kicker mb-2">项目</div>
                <div className="flex flex-wrap gap-2">
                  <FilterButton active={!projectFilter} onClick={() => changeProject("")}>全部项目</FilterButton>
                  {projectCounts.map(({ name, count }) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => changeProject(projectFilter === name ? "" : name)}
                      className={[
                        "ui-filter-button min-h-8 gap-1 px-2.5",
                        projectFilter === name ? "ui-filter-button-active" : "",
                      ].join(" ")}
                    >
                      <Folder size={12} /> {name} <span className="opacity-60">{count}</span>
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
                <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">数量为全库活跃卡片，可继续叠加状态、项目或标签。</p>
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
                <span><span className="block text-sm font-semibold">加入项目</span><span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">保留已有项目，再添加一个项目</span></span>
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
                <span><span className="block text-sm font-semibold">移动到项目</span><span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">用目标项目替换卡片已有项目</span></span>
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
                <span><span className="block text-sm font-semibold">移出项目</span><span className="mt-0.5 block text-xs text-[var(--ui-text-subtle)]">从指定项目中移除这些卡片</span></span>
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
                    {batchMode === "tag" ? "添加标签" : batchMode === "remove_tag" ? "移除标签" : batchMode === "add_project" ? "加入项目" : batchMode === "move_project" ? "移动到项目" : "移出项目"}
                  </span>
                  <button type="button" onClick={() => { setBatchMode(""); setBatchValue(""); }} className="ui-icon-button h-8 w-8" aria-label="关闭批量编辑">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={batchValue}
                    onChange={(e) => setBatchValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyBatch(); } }}
                    placeholder={batchMode === "tag" || batchMode === "remove_tag" ? "标签，逗号分隔多个" : batchMode === "move_project" ? "目标项目名" : "项目名"}
                    className="ui-field h-11 min-w-0 flex-1"
                    autoFocus
                  />
                  <button type="button" onClick={() => void applyBatch()} disabled={saving || !batchValue.trim()} className="ui-button-primary h-11 shrink-0 px-3 text-xs">
                    应用
                  </button>
                </div>
                <div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                  {(batchMode === "tag" || batchMode === "remove_tag" ? tagCounts.map(({ tag }) => tag) : projectCounts.map(({ name }) => name)).slice(0, 10).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBatchValue((current) => current ? `${current}, ${value}` : value)}
                      className="ui-chip h-7 border-[var(--ui-selected-border)] bg-[var(--ui-surface-raised)] text-[var(--ui-accent-text)] hover:bg-[var(--ui-surface-hover)]"
                    >
                      {batchMode === "tag" || batchMode === "remove_tag" ? `#${value}` : value}
                    </button>
                  ))}
                </div>
                {batchMode === "move_project" && <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">目标项目不存在时会自动创建。</p>}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <div className="knowledge-workspace grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[244px_minmax(360px,430px)_minmax(0,1fr)] xl:items-stretch xl:overflow-hidden">
        <aside className="knowledge-project-index ui-panel hidden flex-col p-3 xl:flex xl:h-full xl:min-h-0 xl:overflow-hidden">
          <div className="flex shrink-0 gap-2">
            <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-text-subtle)]" size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") searchCards(); }}
              placeholder="搜索卡片"
              className="ui-field h-10 pl-9"
            />
            </div>
            <button type="button" onClick={searchCards} className="ui-button-secondary h-10 shrink-0 px-3">
              搜索
            </button>
          </div>

          <div className="mt-4 min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
          {/* 项目导航（一级，突出） */}
          <div>
            <div className="mb-1.5 flex items-center justify-between px-1">
              <div className="ui-section-kicker">项目</div>
              {projectFilter && (
                <button type="button" onClick={() => changeProject("")} className="text-[11px] font-medium text-[var(--ui-accent-text)] hover:underline">显示全部</button>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => changeProject("")}
                className={[
                  "ui-filter-button w-full justify-between text-[13px]",
                  !projectFilter ? "ui-filter-button-active" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-2"><Folder size={15} /> 全部卡片</span>
              </button>
              {projectCounts.map(({ name, count }) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => changeProject(projectFilter === name ? "" : name)}
                  className={[
                    "ui-filter-button w-full justify-between text-[13px]",
                    projectFilter === name ? "ui-filter-button-active" : "",
                  ].join(" ")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder size={15} className={projectFilter === name ? "opacity-90" : "opacity-70"} />
                    <span className="truncate">{name}</span>
                  </span>
                  <span className={`ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${projectFilter === name ? "ui-status-accent" : "ui-status-muted"}`}>{count}</span>
                </button>
              ))}
              {projectCounts.length === 0 && (
                <p className="px-2 py-1 text-xs text-[var(--ui-text-subtle)]">暂无项目，创建一个</p>
              )}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createProject();
              }}
              className="mt-2 flex items-center gap-1.5 rounded-xl border border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-surface-soft)] p-1"
            >
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="新建项目..."
                className="ui-field h-8 min-w-0 flex-1 rounded-lg border-0 bg-transparent px-2 text-xs shadow-none focus:ring-0"
              />
              <button
                type="submit"
                disabled={!newProjectName.trim()}
                className="ui-icon-button ui-status-accent h-8 w-8 rounded-lg"
                aria-label="创建项目"
                title="创建项目"
              >
                <Plus size={14} strokeWidth={2.25} />
              </button>
            </form>
          </div>

          {/* 筛选与状态（折叠） */}
          <div className="ui-soft-divider mt-4 border-t pt-2">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-[11px] font-semibold tracking-[0.06em] text-[var(--ui-text-subtle)] transition-colors hover:text-[var(--ui-text)]"
            >
              <span className="flex items-center gap-2">
                <span>筛选与状态</span>
                {activeFilterCount > 0 && <span className="ui-status-accent inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px]">{activeFilterCount}</span>}
              </span>
              <ChevronDown size={14} className={`transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
            {showFilters && (
              <div className="mt-2 space-y-4">
                <div className="grid grid-cols-3 gap-1.5">
                  {statusFilterOptions.map(([status, label]) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => changeStatus(status)}
                      className={[
                        "ui-filter-button w-full min-h-12 flex-col items-start justify-center",
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
                  <p className="mt-2 text-[11px] leading-4 text-[var(--ui-text-subtle)]">数量为全库活跃卡片，可继续叠加其他筛选。</p>
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

          <div className="ui-panel-muted mt-4 p-3">
            <div className="text-xs font-semibold text-[var(--ui-text)]">工作流</div>
            <div className="mt-2 space-y-2 text-xs leading-5 text-[var(--ui-text-muted)]">
              <p>1. 从记录或复盘提取草稿</p>
              <p>2. 对照来源片段确认</p>
              <p>3. 沉淀后用于复习检索</p>
            </div>
          </div>
          <div className="ui-status-accent mt-4 p-3 text-xs leading-5 xl:mt-auto">
            知识卡片必须能回到来源。没有来源片段的内容，不建议确认入库。
          </div>
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
                <span className="hidden 2xl:inline">回收站</span>
              </Link>
            </div>
            <p className="mt-2 px-1 text-[11px] leading-4 text-[var(--ui-text-subtle)]">
              新卡默认保存为草稿，可在右侧补充来源、标签和项目。
            </p>
          </div>
        </aside>

        <section className={["knowledge-card-index ui-panel flex flex-col overflow-visible p-2 xl:h-full xl:min-h-0 xl:overflow-hidden", mobileView === "list" ? "" : "hidden", "xl:flex"].join(" ")}>
          <div className="shrink-0 px-2 py-1">
            <div className="flex min-h-9 items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[var(--ui-text-muted)]">
                {activeStatusLabel} · {totalCards}
              </div>
              {cards.length > 0 && (
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <div className="ui-segment h-8 gap-0.5 p-0.5" role="group" aria-label="列表密度">
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
                  <select
                    value={sort}
                    onChange={(e) => changeSort(e.target.value)}
                    className="ui-field h-8 w-auto min-w-24 rounded-lg px-2 py-0 text-xs font-medium"
                    aria-label="卡片排序"
                  >
                    {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
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
            {selectedIds.length > 0 && (
              <div role="toolbar" aria-label="知识卡片批量操作" className="ui-status-accent ui-mobile-fixed-toolbar mt-1 flex flex-col gap-2 rounded-xl px-2.5 py-2 shadow-md max-xl:fixed max-xl:inset-x-3 max-xl:z-30 max-xl:mx-auto max-xl:max-w-xl xl:shadow-none">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--ui-accent-text)]">
                    已选 {selectedIds.length} 张
                    {hiddenSelectedCount > 0 ? ` · 当前列表可见 ${visibleSelectedCount} 张` : " · 当前列表"}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {selectedDraftCount > 0 && (
                      <button type="button" onClick={() => updateStatus("confirmed", selectedIds.filter((id) => cards.some((card) => card.id === id && card.status === "draft")))} disabled={saving} className="ui-button-success h-8 min-h-8 px-2 text-xs">
                        确认 {selectedDraftCount}
                      </button>
                    )}
                    <button type="button" onClick={() => setMobileBatchOpen(true)} disabled={saving} className="ui-button-ghost h-8 min-h-8 gap-1 px-2 text-xs font-semibold xl:hidden">
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
                          <DropdownMenuItem onSelect={() => toggleBatchMode("add_project")}>加入项目</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => toggleBatchMode("move_project")}>移动到项目</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => toggleBatchMode("remove_project")}>移出项目</DropdownMenuItem>
                          <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void deleteCards(selectedIds)} className="text-[var(--ui-danger-text)] focus:bg-[var(--ui-danger-surface)] focus:text-[var(--ui-danger-text)]">
                            批量删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <button type="button" onClick={clearSelection} className="ui-button-ghost h-8 min-h-8 px-2 text-xs">
                      清空
                    </button>
                    {hiddenSelectedCount > 0 && (
                      <button type="button" onClick={clearHiddenSelection} className="ui-button-ghost h-8 min-h-8 px-2 text-xs">
                        清除不可见项
                      </button>
                    )}
                  </div>
                </div>
                {batchMode && (
                  <div className="ui-panel-muted hidden rounded-lg p-2 xl:block">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[var(--ui-accent-text)]">
                        {batchMode === "tag" ? "添加标签" : batchMode === "remove_tag" ? "移除标签" : batchMode === "add_project" ? "加入项目" : batchMode === "move_project" ? "移动到项目" : "移出项目"}
                      </span>
                      <button type="button" onClick={() => { setBatchMode(""); setBatchValue(""); }} className="ui-icon-button h-7 w-7" aria-label="关闭批量编辑">
                        <X size={13} />
                      </button>
                    </div>
                    <div className="flex w-full items-center gap-1.5">
                      <input
                        value={batchValue}
                        onChange={(e) => setBatchValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyBatch(); } }}
                        placeholder={batchMode === "tag" || batchMode === "remove_tag" ? "标签，逗号分隔多个" : batchMode === "move_project" ? "目标项目名" : "项目名"}
                        list={batchMode === "tag" || batchMode === "remove_tag" ? undefined : "knowledge-project-options"}
                        className="ui-field h-9 min-w-0 flex-1 rounded-lg px-2.5 text-xs"
                        autoFocus
                      />
                      <button type="button" onClick={() => void applyBatch()} disabled={saving || !batchValue.trim()} className="ui-button-primary h-9 shrink-0 px-3 text-xs">
                        应用
                      </button>
                    </div>
                    {batchMode === "move_project" && <p className="mt-1.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">移动会替换卡片已有项目；目标项目不存在时会自动创建。</p>}
                    <datalist id="knowledge-project-options">
                      {projectCounts.map(({ name }) => <option key={name} value={name} />)}
                    </datalist>
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
                <p className="mt-3 text-sm font-medium text-[var(--ui-text)]">
                  {totalCards > 0 ? `第 ${page} 页没有卡片` : `没有${emptyStatusLabel}`}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
                  {totalCards > 0 ? "当前页已经超出结果范围，请返回上一页。" : activeStatus === "draft" ? "从每日记录或周/月复盘提取草稿后，在这里逐条确认。" : activeStatus === "all" ? "可以新建卡片，或调整筛选条件查看其他状态。" : "切换到待确认，先把草稿确认成沉淀内容。"}
                </p>
              </div>
              <div className="mt-3 grid gap-2">
                <KnowledgeHint icon={ShieldCheck} title="先看来源" desc="确认前先核对原文片段，避免把 AI 推断当成事实。" />
                <KnowledgeHint icon={Tags} title="类型要克制" desc="事实、方法、原则优先；不确定的内容先留在草稿。" />
                <KnowledgeHint icon={Lightbulb} title="写成复习卡" desc="标题回答“这是什么”，正文沉淀可复用判断或方法。" />
              </div>
            </div>
          ) : (
            <div
              ref={listParent}
              aria-busy={loading}
              className={["relative pr-1 xl:min-h-0 xl:flex-1 xl:overflow-y-auto", density === "comfortable" ? "space-y-1.5" : "space-y-1", loading ? "opacity-60 transition-opacity" : ""].join(" ")}
            >
              {loading && (
                <div className="ui-status-accent sticky top-0 z-10 mb-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium shadow-xs backdrop-blur">
                  <LoaderCircle size={12} className="animate-spin" /> 更新列表中...
                </div>
              )}
              {sortedCards.map((card) => (
                <div
                  key={card.id}
                  data-state={selectedIds.includes(card.id) ? "selected" : selectedId === card.id ? "active" : "idle"}
                  data-active={selectedId === card.id ? "true" : undefined}
                  className={[
                    "knowledge-card-row group relative flex w-full items-start gap-1",
                    density === "comfortable" ? "rounded-xl p-1.5" : "rounded-lg p-1",
                  ].join(" ")}
                >
                  <label
                    className={[
                      "relative z-[1] mt-0.5 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors",
                      selectedIds.includes(card.id) ? "ui-status-accent" : "hover:bg-[var(--ui-surface-hover)]",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(card.id)}
                      onChange={() => toggleSelected(card.id)}
                      aria-label={`${selectedIds.includes(card.id) ? "取消选择" : "选择"}：${card.title}`}
                      className="h-4 w-4 cursor-pointer rounded border-[var(--ui-border-strong)] accent-[var(--ui-accent-solid)] focus:ring-2 focus:ring-[var(--ui-focus)]/40"
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
                    onClick={() => {
                      selectCard(card);
                      if (isMobile) setMobileView("detail");
                    }}
                    className={[
                      "min-w-0 flex-1 rounded-lg text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-focus)]/30",
                      density === "comfortable" ? "px-2 py-2" : "px-1.5 py-1.5",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--ui-text)]">{card.title}</span>
                      <ChevronRight size={14} className="shrink-0 text-[var(--ui-text-disabled)] group-hover:text-[var(--ui-text-subtle)]" />
                    </div>
                    <div className={[
                      "flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ui-text-subtle)]",
                      density === "comfortable" ? "mt-1.5" : "mt-1",
                    ].join(" ")}>
                      <span>{typeLabels[card.card_type]}</span>
                      {card.source_date && <span className="knowledge-source-line">{card.source_date} · {card.source_review_id ? "AI 复盘" : "每日记录"}</span>}
                      {card.usage_count ? `· 用过 ${card.usage_count} 次` : ""}
                      {card.tags.slice(0, density === "comfortable" ? 4 : 2).map((tag) => <span key={tag}>#{tag}</span>)}
                    </div>
                    {density === "comfortable" && card.content.trim() && (
                      <p className="mt-1 line-clamp-1 text-xs leading-5 text-[var(--ui-text-muted)]">{card.content}</p>
                    )}
                  </Link>
                  {selectedIds.length === 0 && (
                    <div className="flex shrink-0 items-center self-stretch opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="ui-icon-button h-8 w-8"
                            aria-label={`卡片操作：${card.title}`}
                            title="卡片操作"
                          >
                            <MoreHorizontal size={15} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuLabel>卡片操作</DropdownMenuLabel>
                          <DropdownMenuItem onSelect={() => void updateStatus(card.status === "draft" ? "confirmed" : "outdated", [card.id])}>
                            {card.status === "draft" ? "确认入库" : card.status === "outdated" ? "恢复卡片" : "标记为过时"}
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

        <section className={["knowledge-inspector ui-panel flex flex-col overflow-visible p-4 xl:h-full xl:min-h-0 xl:overflow-y-auto", mobileView === "detail" ? "" : "hidden", "xl:flex"].join(" ")}>
          <div className="mb-3 flex items-center gap-2 xl:hidden">
            <button type="button" onClick={() => void closeMobileDetail()} className="ui-button-ghost h-10 px-2.5 text-sm">
              <ArrowLeft size={16} /> 知识卡片
            </button>
            <span className="text-xs text-[var(--ui-text-subtle)]">详情与编辑</span>
          </div>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-bold text-[var(--ui-text)]">{selectedId ? "卡片详情" : "新建知识卡片"}</h3>
                {saveState === "saving" && <span className="inline-flex items-center gap-1 text-xs text-[var(--ui-accent-text)]"><LoaderCircle size={12} className="animate-spin" /> 自动保存</span>}
                {saveState === "saved" && <span className="text-xs text-[var(--ui-success-text)]">已保存</span>}
                {saveState === "error" && <span className="text-xs text-[var(--ui-danger-text)]">保存失败</span>}
              </div>
              <p className="mt-1 text-xs text-[var(--ui-text-subtle)]">
                {selectedCard?.source_date || draft.source_date ? `${selectedCard?.source_date || draft.source_date} · ${currentSourceType}` : "来源用于回溯依据"}
                {selectedCard?.usage_count ? ` · 用过 ${selectedCard.usage_count} 次` : ""}
                {selectedCard?.last_used_at ? ` · 最近使用 ${selectedCard.last_used_at}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedId && draft.status === "draft" && (
                <button type="button" onClick={() => updateStatus("confirmed")} disabled={saving} className="ui-button-primary">
                  <CheckCircle2 size={14} /> 确认入库
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

          <div className="grid gap-4">
            <input value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} placeholder="卡片标题" className="ui-field h-10" />
            <div className="grid gap-3 2xl:grid-cols-[1fr_auto]">
              <Picker label="类型" value={draft.card_type} options={typeOptions} onChange={(value) => updateDraft({ card_type: value as KnowledgeCardType })} />
              <Picker label="状态" value={draft.status} options={statusOptions} onChange={(value) => updateDraft({ status: value as KnowledgeCardStatus })} />
            </div>
            <div className="ui-editor-surface overflow-hidden">
              <CodeMirror
                value={draft.content}
                onChange={(value) => updateDraft({ content: value })}
                extensions={[markdown(), EditorView.lineWrapping]}
                placeholder="沉淀事实、方法、概念、决策依据或案例..."
                theme={dark ? "dark" : "light"}
                height="200px"
                basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
              />
            </div>
            <div>
              <div className="ui-section-kicker mb-1.5">标签</div>
              <div className="ui-token-input">
                {parsedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="ui-chip border-[var(--ui-selected-border)] bg-[var(--ui-surface-selected)] text-[var(--ui-accent-text)] hover:bg-[var(--ui-surface-hover)]"
                    title="点击移除标签"
                  >
                    #{tag} <X size={12} />
                  </button>
                ))}
                <input
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
              <div className="ui-section-kicker mb-1.5">项目</div>
              <div className="ui-token-input">
                {parsedProjects.map((project) => (
                  <button
                    key={project}
                    type="button"
                    onClick={() => removeProject(project)}
                    className="ui-chip border-[var(--ui-selected-border)] bg-[var(--ui-surface-selected)] text-[var(--ui-accent-text)] hover:bg-[var(--ui-surface-hover)]"
                    title="点击移除项目"
                  >
                    <Folder size={12} /> {project} <X size={12} />
                  </button>
                ))}
                <input
                  value={projectInput}
                  onChange={(e) => setProjectInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addProject();
                    }
                    if (e.key === "Backspace" && !projectInput && parsedProjects.length) {
                      removeProject(parsedProjects[parsedProjects.length - 1]);
                    }
                  }}
                  onBlur={() => addProject()}
                  placeholder="归入项目（可多个）"
                  className="h-8 min-w-[120px] flex-1 border-0 bg-transparent px-1 text-sm text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-subtle)]"
                />
              </div>
              {projectSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--ui-text-subtle)]">建议</span>
                  {projectSuggestions.map(({ name }) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => addProject(name)}
                      className="ui-chip h-7 px-2 py-0.5 text-[11px]"
                    >
                      <Folder size={11} className="mr-0.5 inline" />{name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Command shouldFilter={false} className="relative">
              <Command.Input
                value={relatedQuery}
                onValueChange={setRelatedQuery}
                placeholder="搜索并添加关联卡片…"
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
                      <button
                        type="button"
                        onClick={() => {
                          setDraftRelatedIds((ids) => ids.filter((id) => id !== chip.id));
                          setDirty(true);
                          setSaveState("idle");
                        }}
                        className="text-[var(--ui-accent-text)] opacity-50 transition-opacity hover:opacity-100"
                        title="移除关联"
                      >
                        <X size={11} />
                      </button>
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

          {(duplicateHint || notice) && (
            <div
              className={["mt-3", duplicateHint ? "ui-alert-warn" : noticeTone === "good" ? "ui-alert-good" : noticeTone === "bad" ? "ui-alert-bad" : "ui-alert-warn"].join(" ")}
              role={noticeTone === "bad" && !duplicateHint ? "alert" : "status"}
              aria-live="polite"
            >
              {duplicateHint || notice}
            </div>
          )}

          <div className="mt-5 grid items-stretch gap-4 xl:flex-1 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col">
              <div className="ui-section-kicker mb-2">预览</div>
              <div className="ui-panel-muted min-h-[280px] flex-1 p-4">
                {draft.content ? (
                  <MarkdownContent content={draft.content} onWikiLink={onWikiLink} />
                ) : (
                  <KnowledgeEmptyPreview />
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-col">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="ui-section-kicker flex items-center gap-1.5">
                  <ExternalLink size={12} /> 来源追溯
                </div>
                {(draft.source_date || sourceArticle?.date) && (
                  <button type="button" onClick={openSource} className="ui-button-ghost h-7 min-h-7 gap-1 px-2 text-xs font-semibold text-[var(--ui-accent-text)]">
                    <ExternalLink size={12} /> 定位原文
                  </button>
                )}
              </div>
              <div className="ui-editor-surface flex min-h-[280px] flex-1 flex-col overflow-hidden">
                <div className="ui-soft-divider flex items-center gap-2 border-b px-3 py-2">
                  <FileText size={13} className="shrink-0 text-[var(--ui-text-subtle)]" />
                  <div className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--ui-text-muted)]">
                    {sourceLoading ? "加载来源..." : sourceArticle?.title || (draft.source_date ? `${draft.source_date} · ${currentSourceType}` : "暂无来源")}
                  </div>
                </div>
                <textarea
                  value={draft.source_excerpt}
                  onChange={(e) => updateDraft({ source_excerpt: e.target.value })}
                  placeholder="支撑这张卡片的原文片段"
                  className="min-h-[120px] flex-1 w-full resize-none border-0 bg-transparent px-3 py-2 text-xs leading-5 text-[var(--ui-text)] outline-hidden placeholder:text-[var(--ui-text-subtle)]"
                />
                <div className="ui-soft-divider grid gap-2 border-t p-3 pt-2">
                  <input value={draft.source_date} onChange={(e) => updateDraft({ source_date: e.target.value })} placeholder="来源日期 YYYY-MM-DD" className="ui-field h-9 text-xs" />
                  <input value={draft.source_article_id || draft.source_review_id} readOnly placeholder="来源 ID" className="ui-field h-9 text-xs text-[var(--ui-text-muted)]" />
                </div>
              </div>
            </div>
          </div>
          {!draft.content && !draft.source_excerpt && (
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <KnowledgeHint icon={ShieldCheck} title="可信边界" desc="只确认来源里明确出现的事实、方法和原则。" />
              <KnowledgeHint icon={Sparkles} title="AI 只起草" desc="AI 生成内容默认是草稿，确认后才算沉淀。" />
              <KnowledgeHint icon={ExternalLink} title="保留回跳" desc="来源日期和片段越完整，后续复习越可靠。" />
            </div>
          )}
        </section>
      </div>
      {dialog}
    </motion.div>
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

function KnowledgeHint({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof FileText;
  title: string;
  desc: string;
}) {
  return (
    <div className="ui-panel-muted p-3">
      <div className="flex items-start gap-2">
        <span className="ui-status-accent mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
          <Icon size={14} />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--ui-text)]">{title}</div>
          <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">{desc}</p>
        </div>
      </div>
    </div>
  );
}

function KnowledgeEmptyPreview() {
  return (
    <div className="grid gap-3 text-sm text-[var(--ui-text-muted)]">
      <div className="ui-panel-muted p-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--ui-text)]">
          <FileText size={14} /> 卡片正文建议
        </div>
        <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
          用一两段写清楚可复习的结论，避免只写“以后注意”。
        </p>
      </div>
      <div className="grid gap-2 text-xs leading-5">
        <div className="ui-panel-muted p-3">
          <span className="font-semibold text-[var(--ui-text)]">事实：</span>
          记录已经发生、可被来源片段支撑的内容。
        </div>
        <div className="ui-panel-muted p-3">
          <span className="font-semibold text-[var(--ui-text)]">方法：</span>
          沉淀具体步骤、判断顺序或排查清单。
        </div>
        <div className="ui-panel-muted p-3">
          <span className="font-semibold text-[var(--ui-text)]">原则：</span>
          从多次记录里确认过的稳定做法。
        </div>
      </div>
    </div>
  );
}

function Picker<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[T, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="ui-section-kicker mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([itemValue, itemLabel]) => (
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
