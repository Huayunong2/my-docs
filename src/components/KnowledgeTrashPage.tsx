import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import * as api from "../lib/api";
import PageHeader, { PageHeaderActions } from "./ui/PageHeader";

function formatDeletedAt(value: string) {
  if (!value) return "删除时间未知";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function KnowledgeTrashPage() {
  const [cards, setCards] = useState<api.KnowledgeCard[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadCards = async () => {
    setLoading(true);
    setError("");
    try {
      setCards(await api.listDeletedKnowledgeCards());
      setSelectedIds([]);
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCards();
  }, []);

  const allSelected = cards.length > 0 && selectedIds.length === cards.length;
  const selectedCount = useMemo(() => selectedIds.length, [selectedIds]);

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : cards.map((card) => card.id));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const restore = async (ids: string[]) => {
    if (!ids.length) return;
    setSaving(true);
    try {
      const result = await api.restoreKnowledgeCards(ids);
      setCards((current) => current.filter((card) => !ids.includes(card.id)));
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      toast.success(`已恢复 ${result.updated} 张卡片。`);
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-surface page-surface-knowledge-trash mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5 px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-7"
    >
      <PageHeader
        icon={Trash2}
        title="回收站"
        description="已删除的卡片会暂时保留在这里。恢复后，正文、标签、项目关系和复习进度都会回到原来的状态。"
        className="mb-0"
        actions={
          <PageHeaderActions
            primary={
              <Link to="/knowledge" search={{} as never} className="ui-button-primary h-9 px-3 text-xs">
                <ArrowLeft size={14} />
                返回知识
              </Link>
            }
            secondary={
              <button
                type="button"
                onClick={() => void loadCards()}
                disabled={loading || saving}
                className="ui-button-secondary h-9 px-3 text-xs"
                aria-label="刷新回收站"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                刷新
              </button>
            }
          />
        }
      />

      {error && <div className="ui-alert-bad" role="alert">{error}</div>}

      <section className="ui-panel overflow-hidden">
        <div className="ui-soft-divider flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <label className="inline-flex min-h-9 items-center gap-2 rounded-lg px-1 text-xs font-medium text-[var(--ui-text-muted)]">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={cards.length === 0 || saving}
                className="h-4 w-4 rounded border-[var(--ui-border-strong)] accent-[var(--ui-accent-solid)] focus:ring-2 focus:ring-[var(--ui-focus)]/30"
                aria-label={allSelected ? "取消选择全部回收站卡片" : "选择全部回收站卡片"}
              />
              {allSelected ? "取消全选" : "全选"}
            </label>
            <span className="text-xs text-[var(--ui-text-subtle)]">
              {cards.length} 张卡片{selectedCount > 0 ? ` · 已选 ${selectedCount} 张` : ""}
            </span>
          </div>
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => void restore(selectedIds)}
              disabled={saving}
              className="ui-button-primary h-9 px-3 text-xs"
            >
              <RotateCcw size={14} />
              恢复选中
            </button>
          )}
        </div>

        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-[var(--ui-text-muted)]" role="status">正在加载回收站...</div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-16 text-center">
            <span className="ui-status-muted flex h-12 w-12 items-center justify-center rounded-2xl">
              <Check size={22} />
            </span>
            <h2 className="mt-4 text-sm font-semibold text-[var(--ui-text)]">回收站是空的</h2>
            <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--ui-text-muted)]">
              暂时没有需要恢复的知识卡片。
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--ui-border)]">
            {cards.map((card) => {
              const selected = selectedIds.includes(card.id);
              return (
                <div key={card.id} data-state={selected ? "selected" : "idle"} className={["knowledge-card-row relative flex items-center gap-3 px-4 py-3 sm:px-5", selected ? "" : "hover:bg-[var(--ui-surface-hover)]"].join(" ")}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelected(card.id)}
                    disabled={saving}
                    className="h-4 w-4 shrink-0 rounded border-[var(--ui-border-strong)] accent-[var(--ui-accent-solid)] focus:ring-2 focus:ring-[var(--ui-focus)]/30"
                    aria-label={`选择回收站卡片：${card.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 truncate text-sm font-semibold text-[var(--ui-text)]">{card.title || "无标题卡片"}</h2>
                      <span className={["rounded-md px-1.5 py-0.5 text-[10px] font-medium", card.status === "confirmed" ? "ui-status-success" : card.status === "outdated" ? "ui-status-warning" : "ui-status-muted"].join(" ")}>{card.status === "confirmed" ? "已确认" : card.status === "outdated" ? "已过时" : "待确认"}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--ui-text-muted)]">{card.content || "无正文"}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ui-text-subtle)]">
                      <span>删除于 {formatDeletedAt(card.updated_at)}</span>
                      {(card.projects || []).slice(0, 2).map((project) => <span key={project} className="ui-chip h-6 px-2 text-[11px]">{project}</span>)}
                      {(card.tags || []).slice(0, 3).map((tag) => <span key={tag} className="ui-chip h-6 px-2 text-[11px]">#{tag}</span>)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void restore([card.id])}
                    disabled={saving}
                    className="ui-button-secondary h-9 shrink-0 px-2.5 text-xs"
                    aria-label={`恢复卡片：${card.title}`}
                  >
                    <RotateCcw size={14} />
                    <span className="hidden sm:inline">恢复</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="ui-panel-muted px-4 py-3 text-xs leading-5 text-[var(--ui-text-muted)] sm:px-5">
        当前版本只提供可恢复删除，不提供物理清理。这样误删后可以从 Toast 或回收站恢复，项目计数和复习队列也会自动同步。
      </div>
    </motion.div>
  );
}
