import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { Command } from "cmdk";
import {
  BookMarked,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  Lightbulb,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
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
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

const typeOptions = Object.entries(typeLabels) as Array<[KnowledgeCardType, string]>;
const statusOptions = Object.entries(statusLabels) as Array<[KnowledgeCardStatus, string]>;

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

export default function KnowledgePage({ onEditDate, onNavigate, initialCardId, initialNonce, dark, onWikiLink }: {
  onEditDate: (date: string) => void;
  onNavigate: (page: Page) => void;
  initialCardId?: string;
  initialNonce?: number;
  dark?: boolean;
  onWikiLink?: (title: string) => void;
}) {
  const [listParent] = useAutoAnimate();
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [allCards, setAllCards] = useState<KnowledgeCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [activeStatus, setActiveStatus] = useState<KnowledgeCardStatus>("draft");
  const [typeFilter, setTypeFilter] = useState("");
  const [usageFilter, setUsageFilter] = useState<"" | "never_used">("");
  const [tagFilter, setTagFilter] = useState("");
  const [tagCounts, setTagCounts] = useState<api.KnowledgeTagCount[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [projectCounts, setProjectCounts] = useState<api.KnowledgeTagCount[]>([]);
  const [projectInput, setProjectInput] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [batchMode, setBatchMode] = useState<"" | "tag" | "project">("");
  const [batchValue, setBatchValue] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sourceArticle, setSourceArticle] = useState<Article | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [draftRelatedIds, setDraftRelatedIds] = useState<string[]>([]);
  const [relatedQuery, setRelatedQuery] = useState("");
  const [reviewHistory, setReviewHistory] = useState<api.ReviewHistoryEntry[]>([]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedSignature = useRef("");
  const touchedCardIds = useRef<Set<string>>(new Set());
  const { confirm, dialog } = useConfirmDialog();

  const selectedCard = useMemo(() => cards.find((card) => card.id === selectedId) || allCards.find((card) => card.id === selectedId) || null, [allCards, cards, selectedId]);
  const counts = useMemo(() => ({
    draft: allCards.filter((card) => card.status === "draft").length,
    confirmed: allCards.filter((card) => card.status === "confirmed").length,
    outdated: allCards.filter((card) => card.status === "outdated").length,
  }), [allCards]);

  const duplicateHint = useMemo(() => {
    const title = compact(draft.title);
    const content = compact(draft.content);
    if (!title && content.length < 20) return "";
    const duplicate = allCards.find((card) => {
      if (card.id === selectedId) return false;
      return (!!title && compact(card.title) === title) || (!!content && compact(card.content) === content);
    });
    return duplicate ? `可能与「${duplicate.title}」重复。` : "";
  }, [allCards, draft.content, draft.title, selectedId]);

  const loadCards = async (keepSelection = true) => {
    // 切换筛选/状态前先落盘未保存的编辑，避免列表刷新时覆盖草稿。
    // related_ids 不在 payloadFromDraft 内，后端 update 会保留原值，不会误清。
    if (dirty && selectedId) {
      const pending = payloadFromDraft(draft);
      if (pending.title && pending.content) {
        try {
          await api.updateKnowledgeCard(selectedId, pending);
          setDirty(false);
        } catch {
          // 保存失败不阻断列表刷新；内容会留待下次 auto-save 重试
        }
      }
    }
    setLoading(true);
    setError("");
    try {
      const [list, fullList] = await Promise.all([
        api.listKnowledgeCards({ card_type: typeFilter, status: activeStatus, q: query.trim(), usage: usageFilter || undefined, tag: tagFilter || undefined, project: projectFilter || undefined }),
        api.listKnowledgeCards(),
      ]);
      setCards(list);
      setAllCards(fullList);
      setSelectedIds((ids) => ids.filter((id) => list.some((card) => card.id === id)));
      if (keepSelection && selectedId && list.some((card) => card.id === selectedId)) return;
      const next = list[0] || null;
      setSelectedId(next?.id || null);
      setDraft(next ? toDraft(next) : emptyDraft);
      setDirty(false);
      lastSavedSignature.current = next ? JSON.stringify(payloadFromDraft(toDraft(next))) : "";
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCards(false); }, [activeStatus, typeFilter, usageFilter, tagFilter, projectFilter]);

  useEffect(() => {
    let cancelled = false;
    api.listKnowledgeTags()
      .then((tags) => { if (!cancelled) setTagCounts(tags); })
      .catch(() => { if (!cancelled) setTagCounts([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.listKnowledgeProjects()
      .then((projects) => { if (!cancelled) setProjectCounts(projects); })
      .catch(() => { if (!cancelled) setProjectCounts([]); });
    return () => { cancelled = true; };
  }, []);

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
        lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(saved)));
        setAllCards((items) => items.map((item) => item.id === saved.id ? saved : item));
        setCards((items) => items.map((item) => item.id === saved.id ? saved : item));
        setDirty(false);
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        setNotice(api.getErrorMessage(e));
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

  const createProject = () => {
    const name = newProjectName.trim();
    if (!name) return;
    setProjectCounts((prev) => {
      if (prev.some((project) => project.tag === name)) return prev;
      return [...prev, { tag: name, count: 0 }].sort((a, b) => b.count - a.count);
    });
    setProjectFilter(name);
    setNewProjectName("");
  };

  const projectSuggestions = useMemo(
    () => projectCounts.filter(({ tag }) => !parsedProjects.includes(tag)).slice(0, 6),
    [projectCounts, parsedProjects]
  );

  const tagSuggestions = useMemo(
    () => tagCounts.filter(({ tag }) => !parsedTags.includes(tag)).slice(0, 8),
    [tagCounts, parsedTags]
  );

  const openCard = (card: KnowledgeCard) => {
    setSelectedId(card.id);
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
          setAllCards((items) => items.map(patch));
          setCards((items) => items.map(patch));
        })
        .catch(() => { /* 使用计数失败不打扰用户 */ });
    }
  };

  // 从搜索跳转打开指定卡片（只定位一次，避免 allCards 刷新时覆盖用户正在编辑的卡）
  const initialCardHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!initialCardId || initialCardHandled.current === initialCardId) return;
    const target = allCards.find((card) => card.id === initialCardId);
    if (!target) return;
    initialCardHandled.current = initialCardId;
    setActiveStatus(target.status);
    openCard(target);
  }, [initialCardId, initialNonce, allCards]);

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
      .map((id) => allCards.find((card) => card.id === id))
      .filter((card): card is KnowledgeCard => !!card),
    [allCards, draftRelatedIds]
  );

  const relatedCandidates = useMemo(() => {
    const q = relatedQuery.trim().toLowerCase();
    return allCards
      .filter((card) => card.id !== selectedId && !draftRelatedIds.includes(card.id))
      .filter((card) => !q || card.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allCards, selectedId, draftRelatedIds, relatedQuery]);

  const startNew = () => {
    setSelectedId(null);
    setDraft({ ...emptyDraft, status: activeStatus });
    setDraftRelatedIds([]);
    setRelatedQuery("");
    setDirty(false);
    setNotice("");
    setSaveState("idle");
  };

  const saveNewCard = async () => {
    const payload = payloadFromDraft(draft);
    if (!payload.title || !payload.content) {
      setNotice("标题和内容都必填。");
      return;
    }
    setSaving(true);
    try {
      const saved = selectedId
        ? await api.updateKnowledgeCard(selectedId, { ...payload, related_ids: draftRelatedIds })
        : await api.createKnowledgeCard({ ...payload, related_ids: draftRelatedIds });
      await loadCards(true);
      setSelectedId(saved.id);
      setDraft(toDraft(saved));
      setDirty(false);
      setSaveState("saved");
      lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(saved)));
      setNotice(selectedId ? "已保存知识卡片。" : "已创建知识卡片。");
    } catch (e) {
      setNotice(api.getErrorMessage(e));
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (status: KnowledgeCardStatus, ids = selectedId ? [selectedId] : []) => {
    if (!ids.length) return;
    setSaving(true);
    try {
      await Promise.all(ids.map((id) => api.updateKnowledgeCard(id, { status })));
      setSelectedIds([]);
      await loadCards(false);
      setNotice(status === "confirmed" ? `已确认 ${ids.length} 张卡片。` : "状态已更新。");
    } catch (e) {
      setNotice(api.getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteCards = async (ids = selectedId ? [selectedId] : []) => {
    if (!ids.length) return;
    const ok = await confirm({
      title: "删除知识卡片",
      message: ids.length === 1 ? "删除当前知识卡片？这不会删除来源记录。" : `删除选中的 ${ids.length} 张草稿卡片？`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await Promise.all(ids.map((id) => api.deleteKnowledgeCard(id)));
    setSelectedIds([]);
    setSelectedId(null);
    setDraft(emptyDraft);
    await loadCards(false);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };
  const visibleDraftIds = useMemo(() => cards.filter((card) => card.status === "draft").map((card) => card.id), [cards]);
  const selectAllVisible = () => setSelectedIds(visibleDraftIds);
  const invertVisibleSelection = () => {
    setSelectedIds((ids) => visibleDraftIds.filter((id) => !ids.includes(id)));
  };
  const clearSelection = () => setSelectedIds([]);

  const applyBatch = async () => {
    const values = batchValue.split(",").map((value) => value.trim()).filter(Boolean);
    if (!values.length || !selectedIds.length || !batchMode) return;
    setSaving(true);
    try {
      await api.batchKnowledgeCards({ ids: selectedIds, action: batchMode === "tag" ? "add_tags" : "add_projects", values });
      const ids = selectedIds.length;
      setSelectedIds([]);
      setBatchMode("");
      setBatchValue("");
      await loadCards(false);
      setNotice(batchMode === "tag" ? `已为 ${ids} 张卡片添加标签。` : `已为 ${ids} 张卡片归入项目。`);
    } catch (e) {
      setNotice(api.getErrorMessage(e));
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-full px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden"
    >
      <header className="mb-4 flex flex-col gap-3 md:mb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-100">
            <BookMarked size={20} /> 知识工作台
          </h2>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-400">把真实记录沉淀成可追溯、可确认的知识卡片</p>
        </div>
        <Tabs value={activeStatus} onValueChange={(v) => setActiveStatus(v as KnowledgeCardStatus)} className="md:w-[420px]">
          <TabsList className="grid w-full grid-cols-3">
            {statusOptions.map(([status, label]) => (
              <TabsTrigger key={status} value={status}>
                {label} <span className="font-mono text-[11px] opacity-70">{counts[status]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      {error && <div className="ui-alert-bad mb-4">{error}</div>}

      <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[240px_minmax(340px,430px)_minmax(0,1fr)] xl:items-stretch xl:overflow-hidden">
        <aside className="ui-panel flex flex-col p-3 xl:h-full xl:min-h-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-500" size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") loadCards(false); }}
              placeholder="搜索卡片"
              className="ui-field h-10 pl-9"
            />
          </div>
          <button type="button" onClick={() => loadCards(false)} className="ui-button-secondary mt-2 w-full">
            搜索
          </button>
          {/* 项目导航（一级，突出） */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">项目</div>
              {projectFilter && (
                <button type="button" onClick={() => setProjectFilter("")} className="text-[11px] font-medium text-accent hover:underline">显示全部</button>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setProjectFilter("")}
                className={[
                  "flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  !projectFilter ? "bg-accent text-white shadow-xs" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
                ].join(" ")}
              >
                <span className="flex items-center gap-2"><Folder size={15} /> 全部卡片</span>
              </button>
              {projectCounts.map(({ tag, count }) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setProjectFilter(projectFilter === tag ? "" : tag)}
                  className={[
                    "flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                    projectFilter === tag ? "bg-accent text-white shadow-xs" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
                  ].join(" ")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder size={15} className={projectFilter === tag ? "text-white/90" : "opacity-70"} />
                    <span className="truncate">{tag}</span>
                  </span>
                  <span className={`ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${projectFilter === tag ? "bg-white/20 text-white" : "bg-gray-100 text-gray-400 dark:bg-white/10 dark:text-gray-500"}`}>{count}</span>
                </button>
              ))}
              {projectCounts.length === 0 && (
                <p className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500">暂无项目，创建一个</p>
              )}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createProject(); } }}
                placeholder="新建项目..."
                className="h-8 min-w-0 flex-1 rounded-lg border border-dashed border-gray-200 bg-transparent px-2 text-xs text-gray-800 outline-hidden placeholder:text-gray-400 focus:border-accent/40 dark:border-white/15 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
              <button type="button" onClick={createProject} className="h-8 shrink-0 rounded-lg bg-accent-light px-2 text-xs font-semibold text-accent hover:bg-accent-light/80 dark:bg-accent-light/20">
                <Plus size={13} />
              </button>
            </div>
          </div>

          {/* 筛选与状态（折叠） */}
          <div className="mt-4 border-t border-gray-100 pt-2 dark:border-white/10">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <span>筛选与状态</span>
              <ChevronDown size={14} className={`transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
            {showFilters && (
              <div className="mt-2 space-y-4">
                <div className="grid grid-cols-3 gap-1.5">
                  {statusOptions.map(([status, label]) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setActiveStatus(status)}
                      className={[
                        "rounded-lg border px-2 py-2 text-left transition-colors",
                        activeStatus === status
                          ? "border-accent/30 bg-accent-light text-accent dark:bg-accent-light/20"
                          : "border-gray-200/70 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/[0.035] dark:text-gray-400",
                      ].join(" ")}
                    >
                      <div className="text-[10px] leading-none">{label}</div>
                      <div className="mt-1 font-mono text-sm font-bold">{counts[status]}</div>
                    </button>
                  ))}
                </div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">类型</div>
                  <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-1">
                    <FilterButton active={!typeFilter} onClick={() => setTypeFilter("")}>全部类型</FilterButton>
                    {typeOptions.map(([value, label]) => (
                      <FilterButton key={value} active={typeFilter === value} onClick={() => setTypeFilter(value)}>{label}</FilterButton>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">使用</div>
                  <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-1">
                    <FilterButton active={!usageFilter} onClick={() => setUsageFilter("")}>全部卡片</FilterButton>
                    <FilterButton active={usageFilter === "never_used"} onClick={() => setUsageFilter(usageFilter === "never_used" ? "" : "never_used")}>从未使用</FilterButton>
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">标签</div>
                    {tagFilter && (
                      <button type="button" onClick={() => setTagFilter("")} className="text-[11px] font-medium text-accent hover:underline">清除</button>
                    )}
                  </div>
                  {tagCounts.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500">暂无标签</p>
                  ) : (
                    <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                      {tagCounts.map(({ tag, count }) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
                          className={[
                            "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                            tagFilter === tag
                              ? "border-accent/30 bg-accent-light text-accent dark:bg-accent-light/20"
                              : "border-gray-200/70 bg-white text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-400 dark:hover:bg-white/10",
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

          <button type="button" onClick={startNew} className="ui-button-primary mt-4 w-full">
            <Plus size={14} /> 新建卡片
          </button>
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.035]">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">工作流</div>
            <div className="mt-2 space-y-2 text-xs leading-5 text-gray-400 dark:text-gray-500">
              <p>1. 从记录或复盘提取草稿</p>
              <p>2. 对照来源片段确认</p>
              <p>3. 沉淀后用于复习检索</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-accent/15 bg-accent-light/40 p-3 text-xs leading-5 text-accent dark:bg-accent-light/10 xl:mt-auto">
            知识卡片必须能回到来源。没有来源片段的内容，不建议确认入库。
          </div>
        </aside>

        <section className="ui-panel flex flex-col overflow-visible p-2 xl:h-full xl:min-h-0 xl:overflow-hidden">
          <div className="shrink-0 px-2 py-1">
            <div className="flex min-h-9 items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {statusLabels[activeStatus]} · {cards.length}
            </div>
            {activeStatus === "draft" && cards.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <button type="button" onClick={selectAllVisible} className="h-7 rounded-lg px-2 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10">
                  全选
                </button>
                <button type="button" onClick={invertVisibleSelection} className="h-7 rounded-lg px-2 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10">
                  反选
                </button>
              </div>
            )}
            </div>
            {selectedIds.length > 0 && (
              <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-accent/15 bg-accent-light/40 px-2 py-1.5 dark:bg-accent-light/10">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-xs font-medium text-accent">已选 {selectedIds.length}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                  {activeStatus === "draft" && (
                    <button type="button" onClick={() => updateStatus("confirmed", selectedIds)} className="h-8 rounded-lg px-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10">
                      批量确认
                    </button>
                  )}
                  <button type="button" onClick={() => { setBatchMode(batchMode === "tag" ? "" : "tag"); setBatchValue(""); }} className={`h-8 rounded-lg px-2 text-xs font-semibold ${batchMode === "tag" ? "bg-accent text-white" : "text-accent hover:bg-white dark:hover:bg-white/10"}`}>
                    打标签
                  </button>
                  <button type="button" onClick={() => { setBatchMode(batchMode === "project" ? "" : "project"); setBatchValue(""); }} className={`h-8 rounded-lg px-2 text-xs font-semibold ${batchMode === "project" ? "bg-accent text-white" : "text-accent hover:bg-white dark:hover:bg-white/10"}`}>
                    改项目
                  </button>
                  <button type="button" onClick={() => deleteCards(selectedIds)} className="h-8 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10">
                    批量删除
                  </button>
                  <button type="button" onClick={clearSelection} className="h-8 rounded-lg px-2 text-xs font-medium text-gray-500 hover:bg-white dark:text-gray-400 dark:hover:bg-white/10">
                    清空
                  </button>
                  </div>
                </div>
                {batchMode && (
                  <div className="flex w-full items-center gap-1.5">
                    <input
                      value={batchValue}
                      onChange={(e) => setBatchValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBatch(); } }}
                      placeholder={batchMode === "tag" ? "输入标签，逗号分隔多个" : "输入项目名"}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-accent/25 bg-white px-2 text-xs text-gray-800 outline-hidden placeholder:text-gray-400 focus:border-accent/60 dark:bg-gray-950/40 dark:text-gray-100 dark:placeholder:text-gray-500"
                      autoFocus
                    />
                    <button type="button" onClick={applyBatch} disabled={saving} className="h-8 shrink-0 rounded-lg bg-accent px-2.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                      应用
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {loading ? (
            <p className="p-3 text-sm text-gray-400">加载中...</p>
          ) : cards.length === 0 ? (
            <div className="p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center dark:border-white/10 dark:bg-white/[0.035]">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white text-gray-300 dark:bg-white/[0.06] dark:text-gray-600">
                  <FileText size={22} />
                </span>
                <p className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-300">没有{statusLabels[activeStatus]}卡片</p>
                <p className="mt-1 text-xs leading-5 text-gray-400 dark:text-gray-500">
                  {activeStatus === "draft" ? "从每日记录或周/月复盘提取草稿后，在这里逐条确认。" : "切换到待确认，先把草稿确认成沉淀内容。"}
                </p>
              </div>
              <div className="mt-3 grid gap-2">
                <KnowledgeHint icon={ShieldCheck} title="先看来源" desc="确认前先核对原文片段，避免把 AI 推断当成事实。" />
                <KnowledgeHint icon={Tags} title="类型要克制" desc="事实、方法、原则优先；不确定的内容先留在草稿。" />
                <KnowledgeHint icon={Lightbulb} title="写成复习卡" desc="标题回答“这是什么”，正文沉淀可复用判断或方法。" />
              </div>
            </div>
          ) : (
            <div ref={listParent} className="space-y-1 pr-1 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
              {cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => openCard(card)}
                  className={[
                    "group w-full rounded-lg px-2.5 py-2.5 text-left transition-colors",
                    selectedId === card.id ? "bg-accent-light text-accent dark:bg-accent-light/20" : "hover:bg-gray-50 dark:hover:bg-white/5",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-2">
                    {activeStatus === "draft" && (
                      <span
                        role="checkbox"
                        aria-checked={selectedIds.includes(card.id)}
                        onClick={(e) => { e.stopPropagation(); toggleSelected(card.id); }}
                        className={[
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          selectedIds.includes(card.id) ? "border-accent bg-accent text-white" : "border-gray-300 dark:border-white/20",
                        ].join(" ")}
                      >
                        {selectedIds.includes(card.id) && <CheckCircle2 size={12} />}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{card.title}</span>
                        <ChevronRight size={14} className="shrink-0 text-gray-300 group-hover:text-gray-400" />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                        <span>{typeLabels[card.card_type]}</span>
                        {card.source_date && <span>· {card.source_date} · {card.source_review_id ? "AI 复盘" : "每日记录"}</span>}
                        {card.usage_count ? `· 用过 ${card.usage_count} 次` : ""}
                        {card.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="ui-panel flex flex-col overflow-visible p-4 xl:h-full xl:min-h-0 xl:overflow-y-auto">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-bold text-gray-800 dark:text-gray-100">{selectedId ? "卡片详情" : "新建知识卡片"}</h3>
                {saveState === "saving" && <span className="inline-flex items-center gap-1 text-xs text-accent"><LoaderCircle size={12} className="animate-spin" /> 自动保存</span>}
                {saveState === "saved" && <span className="text-xs text-emerald-500">已保存</span>}
                {saveState === "error" && <span className="text-xs text-red-500">保存失败</span>}
              </div>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
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
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">标签</div>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-gray-950/30">
                {parsedTags.map((tag) => (
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
                  className="h-8 min-w-[120px] flex-1 border-0 bg-transparent px-1 text-sm text-gray-800 outline-hidden placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
                />
              </div>
              {tagSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-gray-400">建议</span>
                  {tagSuggestions.map(({ tag }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addTag(tag)}
                      className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/10"
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">项目</div>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-gray-950/30">
                {parsedProjects.map((project) => (
                  <button
                    key={project}
                    type="button"
                    onClick={() => removeProject(project)}
                    className="ui-chip border-accent/20 bg-accent-light text-accent hover:bg-accent-light/80 dark:bg-accent-light/20"
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
                  className="h-8 min-w-[120px] flex-1 border-0 bg-transparent px-1 text-sm text-gray-800 outline-hidden placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
                />
              </div>
              {projectSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-gray-400">建议</span>
                  {projectSuggestions.map(({ tag }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addProject(tag)}
                      className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/10"
                    >
                      <Folder size={11} className="mr-0.5 inline" />{tag}
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
                <Command.List className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-xl border border-gray-100 bg-white p-1 shadow-modal dark:border-white/10 dark:bg-gray-900">
                  <Command.Empty className="px-3 py-2 text-sm text-gray-400">无匹配卡片</Command.Empty>
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
                      className="flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm text-gray-700 data-[selected=true]:bg-accent-light data-[selected=true]:text-accent dark:text-gray-200"
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
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">关联</span>
                  {relatedChips.map((chip) => (
                    <span
                      key={chip.id}
                      className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-accent-light px-2 py-0.5 text-[11px] font-medium text-accent dark:bg-accent-light/20"
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
                        className="text-accent/50 transition-colors hover:text-accent"
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
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">复习间隔趋势</span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">最近 {reviewHistory[reviewHistory.length - 1].interval_days.toFixed(0)} 天</span>
                  </div>
                  <IntervalChart history={reviewHistory} />
                </div>
              )}
            </div>
          )}

          {(duplicateHint || notice) && (
            <div className="mt-3 rounded-lg border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              {duplicateHint || notice}
            </div>
          )}

          <div className="mt-5 grid items-stretch gap-4 xl:flex-1 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">预览</div>
              <div className="min-h-[280px] flex-1 rounded-lg bg-gray-50 p-4 dark:bg-white/[0.035]">
                {draft.content ? (
                  <MarkdownContent content={draft.content} onWikiLink={onWikiLink} />
                ) : (
                  <KnowledgeEmptyPreview />
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-col">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  <ExternalLink size={12} /> 来源追溯
                </div>
                {(draft.source_date || sourceArticle?.date) && (
                  <button type="button" onClick={openSource} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-accent hover:bg-accent-light dark:hover:bg-accent-light/20">
                    <ExternalLink size={12} /> 定位原文
                  </button>
                )}
              </div>
              <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xs dark:border-white/10 dark:bg-white/[0.035]">
                <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-white/10">
                  <FileText size={13} className="shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1 truncate text-xs font-medium text-gray-600 dark:text-gray-300">
                    {sourceLoading ? "加载来源..." : sourceArticle?.title || (draft.source_date ? `${draft.source_date} · ${currentSourceType}` : "暂无来源")}
                  </div>
                </div>
                <textarea
                  value={draft.source_excerpt}
                  onChange={(e) => updateDraft({ source_excerpt: e.target.value })}
                  placeholder="支撑这张卡片的原文片段"
                  className="min-h-[120px] flex-1 w-full resize-none border-0 bg-transparent px-3 py-2 text-xs leading-5 text-gray-700 outline-hidden placeholder:text-gray-400 dark:text-gray-200 dark:placeholder:text-gray-500"
                />
                <div className="grid gap-2 border-t border-gray-100 p-3 pt-2 dark:border-white/10">
                  <input value={draft.source_date} onChange={(e) => updateDraft({ source_date: e.target.value })} placeholder="来源日期 YYYY-MM-DD" className="ui-field h-9 text-xs" />
                  <input value={draft.source_article_id || draft.source_review_id} readOnly placeholder="来源 ID" className="ui-field h-9 bg-gray-50 text-xs text-gray-400 dark:bg-white/[0.035]" />
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

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-8 rounded-lg border px-2.5 text-left text-xs font-medium transition-colors",
        active
          ? "border-accent/30 bg-accent-light text-accent dark:bg-accent-light/20"
          : "border-gray-200/70 bg-white text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-400 dark:hover:bg-white/10",
      ].join(" ")}
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
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-accent dark:bg-white/[0.06]">
          <Icon size={14} />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">{title}</div>
          <p className="mt-1 text-xs leading-5 text-gray-400 dark:text-gray-500">{desc}</p>
        </div>
      </div>
    </div>
  );
}

function KnowledgeEmptyPreview() {
  return (
    <div className="grid gap-3 text-sm text-gray-500 dark:text-gray-400">
      <div className="rounded-lg border border-gray-100 bg-white p-3 dark:border-white/10 dark:bg-white/[0.035]">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
          <FileText size={14} /> 卡片正文建议
        </div>
        <p className="text-xs leading-5 text-gray-400 dark:text-gray-500">
          用一两段写清楚可复习的结论，避免只写“以后注意”。
        </p>
      </div>
      <div className="grid gap-2 text-xs leading-5">
        <div className="rounded-lg bg-white p-3 dark:bg-white/[0.035]">
          <span className="font-semibold text-gray-600 dark:text-gray-300">事实：</span>
          记录已经发生、可被来源片段支撑的内容。
        </div>
        <div className="rounded-lg bg-white p-3 dark:bg-white/[0.035]">
          <span className="font-semibold text-gray-600 dark:text-gray-300">方法：</span>
          沉淀具体步骤、判断顺序或排查清单。
        </div>
        <div className="rounded-lg bg-white p-3 dark:bg-white/[0.035]">
          <span className="font-semibold text-gray-600 dark:text-gray-300">原则：</span>
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
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([itemValue, itemLabel]) => (
          <button
            key={itemValue}
            type="button"
            onClick={() => onChange(itemValue)}
            className={[
              "inline-flex h-8 items-center justify-center rounded-lg border px-2.5 text-xs font-medium transition-colors",
              value === itemValue
                ? "border-accent/30 bg-accent-light text-accent dark:bg-accent-light/20"
                : "border-gray-200/70 bg-white text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-400 dark:hover:bg-white/10",
            ].join(" ")}
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
          <Line type="monotone" dataKey="days" stroke="#6366f1" strokeWidth={1.5} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
