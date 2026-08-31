import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Archive,
  Check,
  Folder,
  FolderCog,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import * as api from "../lib/api";
import { useConfirmDialog } from "./ui/Feedback";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type SpaceChange = {
  previousName?: string;
  nextName?: string;
};

type SpaceForm = {
  name: string;
  kind: api.SpaceKind;
  description: string;
};

const emptyForm: SpaceForm = {
  name: "",
  kind: "topic",
  description: "",
};

function kindLabel(kind?: api.SpaceKind) {
  return kind === "project" ? "项目" : "主题";
}

export default function SpaceManagerDialog({
  open,
  onOpenChange,
  onSpacesChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSpacesChanged?: (spaces: api.KnowledgeProject[], change?: SpaceChange) => void;
}) {
  const [spaces, setSpaces] = useState<api.KnowledgeProject[]>([]);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState<SpaceForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog } = useConfirmDialog();

  const loadSpaces = async (change?: SpaceChange) => {
    setLoading(true);
    setError("");
    try {
      const next = await api.listSpaces(undefined, true);
      setSpaces(next);
      onSpacesChanged?.(next, change);
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setEditingName(null);
    setForm(emptyForm);
    void loadSpaces();
  }, [open]);

  const startCreate = () => {
    setEditingName(null);
    setForm(emptyForm);
  };

  const startEdit = (space: api.KnowledgeProject) => {
    setEditingName(space.name);
    setForm({
      name: space.name,
      kind: space.kind === "project" ? "project" : "topic",
      description: space.description || "",
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    setSaving(true);
    setError("");
    try {
      const saved = editingName
        ? await api.updateSpace(editingName, { name, kind: form.kind, description: form.description })
        : await api.createSpace(name, form.kind, form.description);
      await loadSpaces(editingName ? { previousName: editingName, nextName: saved.name } : undefined);
      const message = editingName
        ? `空间「${saved.name}」已更新。`
        : `${kindLabel(saved.kind)}「${saved.name}」已创建。`;
      toast.success(message);
      if (editingName) {
        setEditingName(saved.name);
        setForm({ name: saved.name, kind: saved.kind || "topic", description: saved.description || "" });
      } else {
        setForm(emptyForm);
      }
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const archive = async (space: api.KnowledgeProject) => {
    const accepted = await confirm({
      title: `归档${kindLabel(space.kind)}「${space.name}」？`,
      message: "归档会将它从活跃空间目录和筛选中移除，但不会删除每日记录、知识条目、来源关系或复习进度。之后可以在空间管理中恢复。",
      confirmText: "归档空间",
      cancelText: "保留空间",
    });
    if (!accepted) return;
    setSaving(true);
    setError("");
    try {
      await api.archiveSpace(space.name);
      await loadSpaces({ previousName: space.name });
      toast.success(`空间「${space.name}」已归档，可随时恢复。`);
      if (editingName === space.name) {
        setEditingName(null);
        setForm(emptyForm);
      }
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const restore = async (space: api.KnowledgeProject) => {
    setSaving(true);
    setError("");
    try {
      const restored = await api.restoreSpace(space.name);
      await loadSpaces({ nextName: restored.name });
      toast.success(`空间「${restored.name}」已恢复。`);
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const deletePermanently = async (space: api.KnowledgeProject) => {
    const cardCount = space.count || 0;
    const articleCount = space.article_count || 0;
    const accepted = await confirm({
      title: `永久删除${kindLabel(space.kind)}「${space.name}」？`,
      message: `此操作不可恢复，只会删除空间和归属关系，不会删除其中的 ${cardCount} 个知识条目或 ${articleCount} 篇每日记录。若以后需要重新组织内容，可以重新创建同名空间。`,
      confirmText: "永久删除空间",
      cancelText: "保留空间",
      danger: true,
    });
    if (!accepted) return;
    setSaving(true);
    setError("");
    try {
      await api.deleteSpacePermanently(space.name);
      await loadSpaces({ previousName: space.name });
      toast.success(`空间「${space.name}」已永久删除，内容仍保留。`);
      if (editingName === space.name) {
        setEditingName(null);
        setForm(emptyForm);
      }
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const activeSpaces = spaces.filter((space) => space.status !== "archived");
  const archivedSpaces = spaces.filter((space) => space.status === "archived");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-[80] backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="ui-modal-surface fixed inset-x-3 bottom-3 z-[81] w-auto max-h-[min(90dvh,720px)] overflow-y-auto p-4 outline-hidden data-[state=open]:animate-slide-up sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[min(920px,calc(100%-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:animate-fade-in sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="ui-status-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <FolderCog size={19} />
              </span>
              <div className="min-w-0">
                <Dialog.Title className="text-[15px] font-semibold leading-6 text-[var(--ui-text)]">空间管理</Dialog.Title>
                <Dialog.Description className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--ui-text-muted)]">
                  主题和项目只管理组织上下文。归档可恢复；永久删除只移除空间和归属关系，不删除其中的内容。
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="ui-icon-button h-11 w-11 md:h-9 md:w-9" aria-label="关闭空间管理">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          {error && <div className="ui-alert-bad mt-4" role="alert">{error}</div>}

          <div className="mt-5 grid items-stretch gap-4 sm:grid-cols-[minmax(0,1fr)_300px]">
            <section className="order-2 flex min-w-0 flex-col sm:order-1">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-semibold leading-5 text-[var(--ui-text)]">空间目录</h2>
                  <p className="mt-1 text-xs leading-4 text-[var(--ui-text-subtle)]">
                    {activeSpaces.length} 个活跃 · {archivedSpaces.length} 个已归档
                  </p>
                </div>
                <button type="button" onClick={startCreate} disabled={loading || saving} className="ui-button-secondary h-11 min-h-11 px-2.5 text-xs md:h-9 md:min-h-9">
                  <Plus size={14} /> 新建空间
                </button>
              </div>

              <div className="ui-panel-muted flex-1 overflow-hidden">
                {loading ? (
                  <div className="px-4 py-10 text-center text-xs text-[var(--ui-text-muted)]" role="status">正在加载空间...</div>
                ) : spaces.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-10 text-center">
                    <span className="ui-status-muted flex h-10 w-10 items-center justify-center rounded-xl"><Folder size={18} /></span>
                    <p className="mt-3 text-xs font-medium text-[var(--ui-text)]">还没有空间</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--ui-text-subtle)]">为长期领域或具体目标建立一个清晰的入口。</p>
                    <button type="button" onClick={startCreate} className="ui-button-primary mt-4 h-11 min-h-11 px-3 text-xs md:h-9 md:min-h-9"><Plus size={14} /> 创建第一个空间</button>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--ui-border)]">
                    {spaces.map((space) => {
                      const archived = space.status === "archived";
                      return (
                        <div key={space.name} className="flex items-start gap-3 px-3 py-3 sm:px-4">
                          <span className={["mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", archived ? "ui-status-muted" : "ui-status-accent"].join(" ")}>
                            {archived ? <Archive size={15} /> : <Folder size={15} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={["truncate text-sm font-semibold", archived ? "text-[var(--ui-text-muted)]" : "text-[var(--ui-text)]"].join(" ")}>{space.name}</span>
                              <span className="ui-chip h-6 px-1.5 text-[11px]">{kindLabel(space.kind)}</span>
                              {archived && <span className="ui-status-muted rounded-md px-1.5 py-0.5 text-[11px]">已归档</span>}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ui-text-subtle)]">
                              {space.description || "暂无说明"}
                            </p>
                            <p className="mt-1.5 text-xs leading-4 text-[var(--ui-text-subtle)]">
                              {space.count} 个知识条目 · {space.article_count || 0} 篇记录
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button type="button" onClick={() => startEdit(space)} disabled={saving} className="ui-icon-button h-11 w-11 md:h-9 md:w-9" aria-label={`编辑空间：${space.name}`} title="编辑">
                              <Pencil size={14} />
                            </button>
                            {archived ? (
                              <>
                                <button type="button" onClick={() => void restore(space)} disabled={saving} className="ui-icon-button h-11 w-11 text-[var(--ui-accent-text)] md:h-9 md:w-9" aria-label={`恢复空间：${space.name}`} title="恢复">
                                  <RotateCcw size={14} />
                                </button>
                                <button type="button" onClick={() => void deletePermanently(space)} disabled={saving} className="ui-icon-button h-11 w-11 text-[var(--ui-danger-text)] hover:bg-[var(--ui-danger-surface)] md:h-9 md:w-9" aria-label={`永久删除空间：${space.name}`} title="永久删除">
                                  <Trash2 size={14} />
                                </button>
                              </>
                            ) : (
                              <button type="button" onClick={() => void archive(space)} disabled={saving} className="ui-icon-button h-11 w-11 hover:bg-[var(--ui-warning-surface)] hover:text-[var(--ui-warning-text)] md:h-9 md:w-9" aria-label={`归档空间：${space.name}`} title="归档">
                                <Archive size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            <section className="order-1 flex min-w-0 sm:order-2">
              <form onSubmit={(event) => void submit(event)} className="ui-panel-muted flex h-full w-full flex-col p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-[13px] font-semibold leading-5 text-[var(--ui-text)]">{editingName ? "编辑空间" : "新建空间"}</h2>
                    <p className="mt-1 text-xs leading-4 text-[var(--ui-text-subtle)]">给它一个稳定、易检索的名称。</p>
                  </div>
                  {editingName && <span className="ui-status-muted rounded-md px-1.5 py-0.5 text-[11px]">{kindLabel(form.kind)}</span>}
                </div>
                <label className="mt-4 block text-xs font-medium text-[var(--ui-text-muted)]">
                  名称
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="例如：C++ 或 FPGA-DIAG"
                    className="ui-field mt-1.5 h-10"
                    maxLength={80}
                    autoFocus
                  />
                </label>
                <label className="mt-3 block text-xs font-medium text-[var(--ui-text-muted)]">
                  类型
                  <Select value={form.kind} onValueChange={(value) => setForm((current) => ({ ...current, kind: value as api.SpaceKind }))}>
                    <SelectTrigger className="mt-1.5 h-10" aria-label="空间类型"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="topic">主题 · 长期领域</SelectItem>
                      <SelectItem value="project">项目 · 有生命周期的目标</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="mt-3 block text-xs font-medium text-[var(--ui-text-muted)]">
                  说明 <span className="font-normal text-[var(--ui-text-subtle)]">（可选）</span>
                  <textarea
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="说明这个空间收纳什么内容"
                    className="ui-field mt-1.5 h-24 min-h-24 max-h-24 resize-none py-2.5 leading-5"
                    maxLength={500}
                  />
                </label>
                <div className="mt-auto flex items-center justify-end gap-2 pt-4">
                  <button type="submit" disabled={saving || !form.name.trim()} className="ui-button-primary h-11 min-h-11 px-3 text-xs md:h-9 md:min-h-9">
                    {saving ? "保存中..." : <><Check size={14} /> {editingName ? "保存修改" : "创建空间"}</>}
                  </button>
                </div>
              </form>
            </section>
          </div>

          <div className="ui-status-accent mt-4 flex items-start gap-2 p-3 text-xs leading-5">
            <Archive size={14} className="mt-0.5 shrink-0" />
            <p>空间归档不会进入知识条目回收站；永久删除空间只解除归属，不删除知识条目或每日记录。知识条目删除后会进入回收站，那里可以恢复。</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
      {dialog}
    </Dialog.Root>
  );
}
