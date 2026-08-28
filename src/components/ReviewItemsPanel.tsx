import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import type {
  KnowledgeCardStatus,
  ReviewItem,
  ReviewItemStatus,
  ReviewItemType,
} from "../lib/api";
import { toast } from "sonner";
import { useConfirmDialog } from "./ui/Feedback";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const itemTypeLabels: Record<ReviewItemType, string> = {
  basic: "基础问答",
  cloze: "填空",
  code: "代码题",
  compare: "对比题",
  scenario: "场景题",
};

const itemStatusLabels: Record<ReviewItemStatus, string> = {
  active: "复习中",
  suspended: "已暂停",
  stale: "正文已变更",
};

type ReviewItemForm = {
  item_type: ReviewItemType;
  status: ReviewItemStatus;
  prompt: string;
  answer: string;
  hint: string;
};

const emptyForm: ReviewItemForm = {
  item_type: "basic",
  status: "active",
  prompt: "",
  answer: "",
  hint: "",
};

function preview(value: string, maxLength = 160) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

function statusClass(status: ReviewItemStatus) {
  if (status === "active") return "ui-status-success";
  if (status === "stale") return "ui-status-warning";
  return "ui-chip";
}

export default function ReviewItemsPanel({
  cardId,
  cardStatus,
  contentVersion,
}: {
  cardId: string;
  cardStatus: KnowledgeCardStatus;
  contentVersion?: number;
}) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReviewItemForm>(emptyForm);
  const { confirm, dialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await api.listKnowledgeReviewItems(cardId));
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    if (!editorOpen) void load();
  }, [contentVersion, editorOpen, load]);

  const startCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, status: cardStatus === "confirmed" ? "active" : "suspended" });
    setEditorOpen(true);
    setError("");
  };

  const startEdit = (item: ReviewItem) => {
    setEditingId(item.id);
    setForm({
      item_type: item.item_type,
      status: item.status,
      prompt: item.prompt,
      answer: item.answer,
      hint: item.hint,
    });
    setEditorOpen(true);
    setError("");
  };

  const cancelEdit = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  };

  const save = async () => {
    const prompt = form.prompt.trim();
    const answer = form.answer.trim();
    if (!prompt || !answer) {
      setError("复习题需要问题和答案。答案应是能在一次回忆中说完的最小单元。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        item_type: form.item_type,
        status: form.status,
        prompt,
        answer,
        hint: form.hint.trim(),
      };
      const saved = editingId
        ? await api.updateKnowledgeReviewItem(editingId, payload)
        : await api.createKnowledgeReviewItem(cardId, payload);
      setItems((current) => editingId
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved]);
      setEditorOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success(editingId ? "复习题已更新" : "复习题已添加");
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (item: ReviewItem) => {
    const nextStatus: ReviewItemStatus = item.status === "active" ? "suspended" : "active";
    try {
      const updated = await api.updateKnowledgeReviewItem(item.id, { status: nextStatus });
      setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
      if (cardStatus !== "confirmed" && nextStatus === "active") {
        toast.success("复习题已保存；知识条目确认后才会进入队列");
      } else {
        toast.success(nextStatus === "active" ? "复习题已恢复" : "复习题已暂停");
      }
    } catch (e) {
      toast.error(api.getErrorMessage(e));
    }
  };

  const archive = async (item: ReviewItem) => {
    if (!(await confirm({
      title: "归档复习题",
      message: "归档这道复习题？历史复习记录会保留。",
      confirmText: "归档",
      danger: true,
    }))) return;
    try {
      await api.deleteKnowledgeReviewItem(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      if (editingId === item.id) cancelEdit();
      toast.success("复习题已归档");
    } catch (e) {
      toast.error(api.getErrorMessage(e));
    }
  };

  return (
    <section className="ui-panel-muted mt-5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-[var(--ui-text)]">复习题</h4>
            <span className="ui-chip h-auto px-2 py-0.5 text-[11px]">{items.length} 道</span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ui-text-subtle)]">
            知识正文负责完整记录，复习题负责主动回忆。一条知识可以拆成多道短题；正文修改后，相关题目会标记为过时。
          </p>
        </div>
        <button type="button" onClick={startCreate} className="ui-button-secondary h-8 shrink-0 px-2.5 text-xs">
          <Plus size={13} /> 添加复习题
        </button>
      </div>

      {cardStatus !== "confirmed" && (
        <div className="ui-alert-warn mt-3 px-3 py-2 text-xs leading-5">
          当前条目尚未确认。可以先整理题目，但它不会进入复习队列。
        </div>
      )}

      {error && !editorOpen && <div className="ui-alert-bad mt-3 px-3 py-2 text-xs">{error}</div>}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--ui-text-subtle)]">
          <LoaderCircle size={13} className="animate-spin" /> 加载复习题…
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--ui-border)] px-3 py-4 text-center text-xs leading-5 text-[var(--ui-text-subtle)]">
          还没有复习题。正文可以很长，先从一个能在 30 秒内回答的问题开始。
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="ui-chip h-auto px-2 py-0.5 text-[11px]">{itemTypeLabels[item.item_type]}</span>
                    <span className={`${statusClass(item.status)} rounded-md px-2 py-0.5 text-[11px] font-medium`}>
                      {itemStatusLabels[item.status]}
                    </span>
                    {item.review_count > 0 && (
                      <span className="text-[11px] text-[var(--ui-text-subtle)]">已复习 {item.review_count} 次</span>
                    )}
                  </div>
                  <p className="text-sm font-semibold leading-5 text-[var(--ui-text)]">{preview(item.prompt, 240)}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ui-text-subtle)]">答案：{preview(item.answer)}</p>
                  {item.source_version < (contentVersion || item.source_version) && (
                    <p className="mt-1 text-[11px] text-[var(--ui-warning-text)]">依据正文 v{item.source_version}，当前正文已是 v{contentVersion}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => startEdit(item)} className="ui-icon-button h-8 w-8" title="编辑复习题" aria-label="编辑复习题">
                    <Edit3 size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleStatus(item)}
                    className="ui-icon-button h-8 w-8"
                    title={item.status === "active" ? "暂停复习题" : "恢复复习题"}
                    aria-label={item.status === "active" ? "暂停复习题" : "恢复复习题"}
                  >
                    {item.status === "active" ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
                  <button type="button" onClick={() => void archive(item)} className="ui-icon-button h-8 w-8 text-[var(--ui-danger-text)]" title="归档复习题" aria-label="归档复习题">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editorOpen && (
        <div className="ui-editor-surface mt-4 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-[var(--ui-text)]">{editingId ? "编辑复习题" : "添加复习题"}</div>
              <p className="mt-1 text-[11px] text-[var(--ui-text-subtle)]">问题和答案分别是主动回忆的两面，不要把整篇正文复制进答案。</p>
            </div>
            <button type="button" onClick={cancelEdit} className="ui-icon-button h-8 w-8" title="取消" aria-label="取消编辑复习题">
              <X size={14} />
            </button>
          </div>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-[160px_160px_1fr]">
              <label className="grid gap-1 text-[11px] font-medium text-[var(--ui-text-subtle)]">
                类型
                <Select value={form.item_type} onValueChange={(value) => setForm((current) => ({ ...current, item_type: value as ReviewItemType }))}>
                  <SelectTrigger className="h-9 text-xs" aria-label="复习题类型"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(itemTypeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-[var(--ui-text-subtle)]">
                状态
                <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value as ReviewItemStatus }))}>
                  <SelectTrigger className="h-9 text-xs" aria-label="复习题状态"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(itemStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <div className="hidden sm:block" />
            </div>
            <textarea value={form.prompt} onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))} placeholder="问题：例如“C++ 中 vector 扩容时迭代器何时失效？”" className="ui-textarea min-h-[76px] text-sm leading-5" />
            <textarea value={form.answer} onChange={(event) => setForm((current) => ({ ...current, answer: event.target.value }))} placeholder="答案：只写回答这个问题所需的最小充分内容，可使用 Markdown。" className="ui-textarea min-h-[120px] text-sm leading-5" />
            <input value={form.hint} onChange={(event) => setForm((current) => ({ ...current, hint: event.target.value }))} placeholder="提示（可选）" className="ui-field h-9 text-xs" />
          </div>
          {error && <div className="ui-alert-bad mt-3 px-3 py-2 text-xs">{error}</div>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={cancelEdit} disabled={saving} className="ui-button-secondary h-8 px-2.5 text-xs">取消</button>
            <button type="button" onClick={() => void save()} disabled={saving} className="ui-button-primary h-8 px-2.5 text-xs">
              {saving ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
              {saving ? "保存中…" : "保存复习题"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--ui-text-subtle)]">
        <RotateCcw size={12} />
        <span>编辑正文会让旧题变为“正文已变更”，复习前请重新核对答案。</span>
      </div>
      {dialog}
    </section>
  );
}
