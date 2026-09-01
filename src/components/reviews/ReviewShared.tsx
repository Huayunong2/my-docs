import { useEffect, useRef, useState, type MouseEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BookMarked, ChevronDown, X } from "lucide-react";
import type { Review } from "../../lib/api";
import { formatReviewTimestamp, reviewBodyContent } from "../../lib/reviewContent";
import MarkdownContent from "../MarkdownContent";

export function ReviewStatusPill({ status }: { status: Review["status"] }) {
  return (
    <span
      className={[
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        status === "confirmed" ? "ui-status-success" : "ui-status-warning",
      ].join(" ")}
    >
      {status === "confirmed" ? "已确认" : "草稿"}
    </span>
  );
}

export function ReviewViewerModal({
  review,
  title,
  content,
  saving,
  onTitleChange,
  onContentChange,
  onSave,
  onConfirm,
  onDelete,
  onExtractKnowledge,
  extractingKnowledge = false,
  onOpenSources,
  onDiscardChanges,
  onClose,
  onRestoreFocus,
  readOnly = false,
}: {
  review: Review;
  title: string;
  content: string;
  saving: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSave: () => void | boolean | Promise<void | boolean>;
  onConfirm: () => void | boolean | Promise<void | boolean>;
  onDelete: () => void | boolean | Promise<void | boolean>;
  onExtractKnowledge?: () => void;
  extractingKnowledge?: boolean;
  onOpenSources?: (event: MouseEvent<HTMLButtonElement>) => void;
  onDiscardChanges?: () => Promise<boolean>;
  onClose: () => void;
  onRestoreFocus?: () => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [editBaseline, setEditBaseline] = useState({ title, content });
  const discardPromptRef = useRef<Promise<boolean> | null>(null);
  const sourceCount = review.kind === "weekly"
    ? review.source_article_ids.length
    : review.source_review_ids.length;
  const displayContent = reviewBodyContent(review.kind, title, content);
  const hasUnsavedChanges = !readOnly && editing && (title !== editBaseline.title || content !== editBaseline.content);
  const metaItems = [
    { label: "类型", value: review.kind === "weekly" ? "周复盘" : "月复盘" },
    { label: "周期", value: `${review.period_start} 至 ${review.period_end}` },
    { label: "版本", value: `v${review.version}` },
    { label: "来源", value: `${sourceCount} ${review.kind === "weekly" ? "篇记录" : "个周复盘"}` },
    { label: "模型", value: review.model || "AI" },
    { label: "生成", value: formatReviewTimestamp(review.generated_at) },
  ];

  useEffect(() => {
    setEditing(false);
    setMetaExpanded(false);
    setEditBaseline({ title, content });
  }, [review.id]);

  const resetEditDraft = () => {
    onTitleChange(editBaseline.title);
    onContentChange(editBaseline.content);
    setEditing(false);
  };

  const canDiscardChanges = async () => {
    if (!hasUnsavedChanges) return true;
    if (onDiscardChanges) {
      if (discardPromptRef.current) return discardPromptRef.current;
      const prompt = onDiscardChanges();
      discardPromptRef.current = prompt;
      try {
        return await prompt;
      } finally {
        if (discardPromptRef.current === prompt) discardPromptRef.current = null;
      }
    }
    return typeof window !== "undefined"
      ? window.confirm("放弃未保存的标题和正文修改？")
      : false;
  };

  const requestClose = async () => {
    if (saving) return;
    if (!(await canDiscardChanges())) return;
    onClose();
  };

  const requestCancelEdit = async () => {
    if (!(await canDiscardChanges())) return;
    resetEditDraft();
  };

  const enterEdit = () => {
    if (readOnly) return;
    setEditBaseline({ title, content });
    setEditing(true);
  };

  const submit = async (action: () => void | boolean | Promise<void | boolean>) => {
    const result = await action();
    if (result !== false) setEditBaseline({ title, content });
  };

  const requestDelete = async () => {
    if (readOnly) return;
    if (!(await canDiscardChanges())) return;
    await onDelete();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) void requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="ui-modal-surface fixed inset-x-3 bottom-3 z-50 flex w-[calc(100%-1.5rem)] min-w-0 max-h-[min(92dvh,860px)] max-w-5xl flex-col overflow-hidden outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2"
          aria-busy={saving || extractingKnowledge}
          onPointerDownOutside={(event) => {
            if (!hasUnsavedChanges) return;
            event.preventDefault();
            void requestClose();
          }}
          onEscapeKeyDown={(event) => {
            if (!hasUnsavedChanges) return;
            event.preventDefault();
            void requestClose();
          }}
          onCloseAutoFocus={(event) => {
            if (!onRestoreFocus) return;
            event.preventDefault();
            onRestoreFocus();
          }}
        >
        {/* Header */}
        <div className="ui-soft-divider flex items-start justify-between gap-3 border-b px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Dialog.Title className="break-words text-base font-bold text-[var(--ui-text)]">{title || "复盘详情"}</Dialog.Title>
              <ReviewStatusPill status={review.status} />
              {readOnly && <span className="ui-status-muted rounded-full px-2 py-0.5 text-[11px] font-medium">只读来源</span>}
              {hasUnsavedChanges && (
                <span className="ui-status-warning rounded-full px-2 py-0.5 text-[11px] font-medium">未保存</span>
              )}
            </div>
            <Dialog.Description className="mt-1 break-words text-xs leading-5 text-[var(--ui-text-subtle)]">
              <span className="sm:hidden">
                v{review.version} · {review.model || "AI"}{readOnly ? " · 只读来源" : ""}
              </span>
              <span className="hidden sm:inline">
                {review.kind === "weekly" ? "周复盘" : "月复盘"} · {review.period_start} 至 {review.period_end} · v{review.version} · {review.model || "AI"} · 生成于 {formatReviewTimestamp(review.generated_at)}{readOnly ? " · 仅用于核对来源" : ""}
              </span>
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button type="button" disabled={saving} className="ui-icon-button h-11 w-11 sm:h-8 sm:w-8" aria-label="关闭复盘详情" title="关闭复盘详情">
              <X size={15} />
            </button>
          </Dialog.Close>
        </div>

        {/* 移动端：元信息默认折叠成一行摘要，正文优先 */}
        <div className="ui-modal-meta border-b px-5 py-2.5 sm:hidden">
          <button
            type="button"
            onClick={() => setMetaExpanded(!metaExpanded)}
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={metaExpanded}
            aria-controls="review-mobile-meta-details"
          >
            <span className="min-w-0 truncate text-xs text-[var(--ui-text-subtle)]">
              {review.kind === "weekly" ? "周复盘" : "月复盘"} · {review.period_start} 至 {review.period_end} · v{review.version} · 来源 {sourceCount}
            </span>
            <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-[var(--ui-accent-text)]">
              {metaExpanded ? "收起" : "详情"}
              <ChevronDown size={14} className={`transition-transform ${metaExpanded ? "rotate-180" : ""}`} />
            </span>
          </button>
          {metaExpanded && (
            <div id="review-mobile-meta-details" className="mt-2.5 grid grid-cols-2 gap-2">
              {metaItems.map((item) => (
                <div key={item.label} className="min-w-0">
                  <div className="text-[11px] text-[var(--ui-text-subtle)]">{item.label}</div>
                  <div className="mt-0.5 truncate text-xs font-medium text-[var(--ui-text-muted)]">{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 桌面端：保持 6 项元信息网格不变 */}
        <div className="ui-modal-meta hidden grid-cols-2 gap-2 border-b px-5 py-3 sm:grid sm:grid-cols-3">
          {metaItems.map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="text-[11px] text-[var(--ui-text-subtle)]">{item.label}</div>
              <div className="mt-0.5 truncate text-xs font-medium text-[var(--ui-text-muted)]">{item.value}</div>
            </div>
          ))}
        </div>

        {/* Body */}
        {editing && !readOnly ? (
          <div className="grid min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto md:overflow-hidden md:grid-cols-2">
            <div className="ui-soft-divider min-w-0 border-b p-4 md:min-h-0 md:overflow-y-auto md:border-b-0 md:border-r">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="review-editor-title" className="text-xs font-semibold text-[var(--ui-text)]">标题</label>
                <span className="text-[10px] text-[var(--ui-text-subtle)]">可直接修改</span>
              </div>
              <input
                id="review-editor-title"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                className="ui-field h-10 rounded-lg text-sm font-medium"
              />
              <label htmlFor="review-editor-content" className="mb-1.5 mt-4 block text-xs font-semibold text-[var(--ui-text)]">正文</label>
              <textarea
                id="review-editor-content"
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                className="ui-textarea h-[38vh] min-h-[240px] rounded-lg font-mono text-xs leading-5 md:h-[48vh] md:min-h-[320px]"
              />
            </div>
            <div className="min-w-0 p-4 md:min-h-0 md:overflow-y-auto">
              <div className="mb-1.5 flex h-[18px] items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ui-text)]">预览</span>
                <span className="text-[10px] text-[var(--ui-text-subtle)]">实时同步</span>
              </div>
              <div className="ui-panel-muted flex h-10 items-center rounded-lg px-3 text-sm font-medium text-[var(--ui-text)]">
                <span className="truncate">{title.trim() || "未填写标题"}</span>
              </div>
              <div className="mb-1.5 mt-4 text-xs font-semibold text-[var(--ui-text)]">正文预览</div>
              <div className="ui-panel-muted min-h-[240px] p-4 md:min-h-[320px]">
                <MarkdownContent content={content} />
              </div>
            </div>
          </div>
        ) : (
          <div className="review-viewer-body min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-5">
            <MarkdownContent content={displayContent} />
          </div>
        )}

        {/* Footer */}
        <div className="ui-soft-divider flex flex-col-reverse gap-2 border-t px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pb-4">
          {!readOnly && (
            <button
              type="button"
              onClick={() => void requestDelete()}
              disabled={saving || extractingKnowledge}
              className="ui-button-danger self-start"
            >
              删除此版本
            </button>
          )}
          <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
            {readOnly ? (
              <button type="button" onClick={onClose} className="ui-button-primary w-full sm:w-auto">关闭</button>
            ) : editing ? (
              <>
                <button type="button" onClick={() => void requestCancelEdit()} disabled={saving}
                  className="ui-button-secondary flex-1 sm:flex-none">取消编辑</button>
                <button type="button" onClick={() => void submit(onSave)} disabled={saving}
                  className="ui-button-primary flex-1 sm:flex-none">{saving ? "保存中…" : review.status === "draft" ? "保存草稿" : "保存修改"}</button>
                <button type="button" onClick={() => void submit(onConfirm)} disabled={saving}
                  className="ui-button-success flex-1 sm:flex-none">{saving ? "确认中…" : "确认版本"}</button>
              </>
            ) : (
              <>
                {onExtractKnowledge && (
                  <button type="button" onClick={onExtractKnowledge} disabled={saving || extractingKnowledge}
                    className="ui-button-secondary flex-1 sm:flex-none">
                    <BookMarked size={14} />
                    {extractingKnowledge ? "提取中" : "提取知识"}
                  </button>
                )}
                {onOpenSources && sourceCount > 0 && (
                  <button type="button" onClick={(event) => onOpenSources(event)} disabled={saving || extractingKnowledge}
                    className="ui-button-secondary flex-1 sm:flex-none">查看来源</button>
                )}
                <button type="button" onClick={enterEdit} disabled={saving || extractingKnowledge}
                  className="ui-button-secondary flex-1 sm:flex-none">编辑</button>
                {review.status !== "confirmed" && (
                  <button type="button" onClick={() => void submit(onConfirm)} disabled={saving || extractingKnowledge}
                    className="ui-button-primary flex-1 sm:flex-none">{saving ? "确认中…" : "确认版本"}</button>
                )}
              </>
            )}
          </div>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
