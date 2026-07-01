import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  BookMarked,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import * as api from "../lib/api";
import type { Article, KnowledgeCard, KnowledgeCardStatus, KnowledgeCardType } from "../lib/api";
import { parseTags, stringifyTags } from "../lib/tags";
import MarkdownContent from "./MarkdownContent";
import { useConfirmDialog } from "./ui/Feedback";

const typeLabels: Record<KnowledgeCardType, string> = {
  fact: "事实",
  method: "方法",
  concept: "概念",
  decision: "决策",
  case: "案例",
  quote: "表述",
  principle: "原则",
};

const statusLabels: Record<KnowledgeCardStatus, string> = {
  draft: "待确认",
  confirmed: "已沉淀",
  outdated: "已过时",
};

const typeOptions = Object.entries(typeLabels) as Array<[KnowledgeCardType, string]>;
const statusOptions = Object.entries(statusLabels) as Array<[KnowledgeCardStatus, string]>;

const emptyDraft = {
  card_type: "fact" as KnowledgeCardType,
  status: "draft" as KnowledgeCardStatus,
  title: "",
  content: "",
  tagsText: "",
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
    tagsText: parseTags(card.tags).join(", "),
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
    tags: stringifyTags(draft.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean)),
    source_date: draft.source_date.trim(),
    source_article_id: draft.source_article_id.trim(),
    source_review_id: draft.source_review_id.trim(),
    source_excerpt: draft.source_excerpt.trim(),
  };
}

function compact(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

export default function KnowledgePage({ onEditDate }: { onEditDate: (date: string) => void }) {
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [allCards, setAllCards] = useState<KnowledgeCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [activeStatus, setActiveStatus] = useState<KnowledgeCardStatus>("draft");
  const [typeFilter, setTypeFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sourceArticle, setSourceArticle] = useState<Article | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedSignature = useRef("");
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
    setLoading(true);
    setError("");
    try {
      const [list, fullList] = await Promise.all([
        api.listKnowledgeCards({ card_type: typeFilter, status: activeStatus, q: query.trim() }),
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

  useEffect(() => { loadCards(false); }, [activeStatus, typeFilter]);

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

  const openCard = (card: KnowledgeCard) => {
    setSelectedId(card.id);
    setDraft(toDraft(card));
    setDirty(false);
    setNotice("");
    setSaveState("idle");
    lastSavedSignature.current = JSON.stringify(payloadFromDraft(toDraft(card)));
  };

  const startNew = () => {
    setSelectedId(null);
    setDraft({ ...emptyDraft, status: activeStatus });
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
      const saved = selectedId ? await api.updateKnowledgeCard(selectedId, payload) : await api.createKnowledgeCard(payload);
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

  const openSource = () => {
    const sourceDate = sourceArticle?.date || draft.source_date || selectedCard?.source_date;
    if (sourceDate) onEditDate(sourceDate);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-full overflow-y-auto px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6"
    >
      <header className="mb-4 flex flex-col gap-3 md:mb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-100">
            <BookMarked size={20} /> 知识工作台
          </h2>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-400">把真实记录沉淀成可追溯、可确认的知识卡片</p>
        </div>
        <div className="ui-segment grid w-full grid-cols-3 md:w-[420px]">
          {statusOptions.map(([status, label]) => (
            <button
              key={status}
              type="button"
              onClick={() => setActiveStatus(status)}
              className={["ui-segment-item", activeStatus === status ? "ui-segment-item-active" : ""].join(" ")}
            >
              {label} <span className="font-mono text-[11px] opacity-70">{counts[status]}</span>
            </button>
          ))}
        </div>
      </header>

      {error && <div className="ui-alert-bad mb-4">{error}</div>}

      <div className="grid min-h-[640px] gap-4 xl:grid-cols-[220px_minmax(320px,420px)_minmax(0,1fr)]">
        <aside className="ui-panel h-fit p-3">
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
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">类型</div>
            <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-1">
              <FilterButton active={!typeFilter} onClick={() => setTypeFilter("")}>全部类型</FilterButton>
              {typeOptions.map(([value, label]) => (
                <FilterButton key={value} active={typeFilter === value} onClick={() => setTypeFilter(value)}>{label}</FilterButton>
              ))}
            </div>
          </div>
          <button type="button" onClick={startNew} className="ui-button-primary mt-4 w-full">
            <Plus size={14} /> 新建卡片
          </button>
        </aside>

        <section className="ui-panel min-h-[320px] p-2">
          <div className="flex h-10 items-center justify-between px-2">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {statusLabels[activeStatus]} · {cards.length}
            </div>
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-1.5">
                {activeStatus === "draft" && (
                  <button type="button" onClick={() => updateStatus("confirmed", selectedIds)} className="h-8 rounded-lg px-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10">
                    批量确认
                  </button>
                )}
                <button type="button" onClick={() => deleteCards(selectedIds)} className="h-8 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10">
                  批量删除
                </button>
              </div>
            )}
          </div>
          {loading ? (
            <p className="p-3 text-sm text-gray-400">加载中...</p>
          ) : cards.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center">
              <FileText size={28} className="text-gray-300 dark:text-gray-600" />
              <p className="mt-2 text-sm font-medium text-gray-500 dark:text-gray-400">没有{statusLabels[activeStatus]}卡片</p>
              <p className="mt-1 text-xs leading-5 text-gray-400 dark:text-gray-500">
                {activeStatus === "draft" ? "从每日记录的 AI 总结面板提取知识卡片草稿。" : "切换到待确认，先把草稿确认成沉淀内容。"}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
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
                        {card.source_date && <span>· {card.source_date} · 每日记录</span>}
                        {parseTags(card.tags).slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="ui-panel min-h-[520px] p-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-bold text-gray-800 dark:text-gray-100">{selectedId ? "卡片详情" : "新建知识卡片"}</h3>
                {saveState === "saving" && <span className="inline-flex items-center gap-1 text-xs text-accent"><LoaderCircle size={12} className="animate-spin" /> 自动保存</span>}
                {saveState === "saved" && <span className="text-xs text-emerald-500">已保存</span>}
                {saveState === "error" && <span className="text-xs text-red-500">保存失败</span>}
              </div>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {selectedCard?.source_date || draft.source_date ? `${selectedCard?.source_date || draft.source_date} · 每日记录` : "来源用于回溯依据"}
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

          <div className="grid gap-3">
            <input value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} placeholder="卡片标题" className="ui-field h-10" />
            <div className="grid gap-3 2xl:grid-cols-[1fr_auto]">
              <Picker label="类型" value={draft.card_type} options={typeOptions} onChange={(value) => updateDraft({ card_type: value as KnowledgeCardType })} />
              <Picker label="状态" value={draft.status} options={statusOptions} onChange={(value) => updateDraft({ status: value as KnowledgeCardStatus })} />
            </div>
            <textarea
              value={draft.content}
              onChange={(e) => updateDraft({ content: e.target.value })}
              placeholder="沉淀事实、方法、概念、决策依据或案例..."
              className="ui-textarea min-h-[150px] font-mono text-sm leading-7"
            />
            <input value={draft.tagsText} onChange={(e) => updateDraft({ tagsText: e.target.value })} placeholder="标签，用逗号分隔" className="ui-field h-10" />
          </div>

          {(duplicateHint || notice) && (
            <div className="mt-3 rounded-lg border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              {duplicateHint || notice}
            </div>
          )}

          <div className="mt-5 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">预览</div>
              <div className="min-h-[160px] rounded-lg bg-gray-50 p-4 dark:bg-white/[0.035]">
                <MarkdownContent content={draft.content || "输入内容以预览..."} />
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">来源</div>
                {(draft.source_date || sourceArticle?.date) && (
                  <button type="button" onClick={openSource} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-accent hover:bg-accent-light dark:hover:bg-accent-light/20">
                    <ExternalLink size={12} /> 查看来源
                  </button>
                )}
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.035]">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {sourceLoading ? "加载来源..." : sourceArticle?.title || draft.source_date || "暂无来源"}
                </div>
                <textarea
                  value={draft.source_excerpt}
                  onChange={(e) => updateDraft({ source_excerpt: e.target.value })}
                  placeholder="支撑这张卡片的原文片段"
                  className="mt-3 min-h-[120px] w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-600 outline-none focus:border-accent/40 dark:border-white/10 dark:bg-gray-950/30 dark:text-gray-300"
                />
                <div className="mt-2 grid gap-2">
                  <input value={draft.source_date} onChange={(e) => updateDraft({ source_date: e.target.value })} placeholder="来源日期 YYYY-MM-DD" className="ui-field h-9 text-xs" />
                  <input value={draft.source_article_id || draft.source_review_id} readOnly placeholder="来源 ID" className="ui-field h-9 bg-gray-50 text-xs text-gray-400 dark:bg-white/[0.035]" />
                </div>
              </div>
            </div>
          </div>
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
