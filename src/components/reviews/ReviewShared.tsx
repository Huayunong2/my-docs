import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BookMarked, ChevronDown, X } from "lucide-react";
import type { Review } from "../../lib/api";
import { normalizeReviewContent } from "../../lib/reviewContent";
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
  onClose,
  onRestoreFocus,
}: {
  review: Review;
  title: string;
  content: string;
  saving: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onConfirm: () => void;
  onDelete: () => void;
  onExtractKnowledge?: () => void;
  extractingKnowledge?: boolean;
  onClose: () => void;
  onRestoreFocus?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(false);
  const sourceCount = review.kind === "weekly"
    ? review.source_article_ids.length
    : review.source_review_ids.length;
  const displayContent = normalizeReviewContent(review.kind, title, content);
  const metaItems = [
    { label: "类型", value: review.kind === "weekly" ? "周复盘" : "月复盘" },
    { label: "周期", value: `${review.period_start} 至 ${review.period_end}` },
    { label: "版本", value: `v${review.version}` },
    { label: "来源", value: `${sourceCount} ${review.kind === "weekly" ? "篇记录" : "个周复盘"}` },
    { label: "模型", value: review.model || "AI" },
    { label: "生成", value: review.generated_at || "未知" },
  ];

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="ui-modal-surface fixed inset-x-3 bottom-3 z-50 flex max-h-[min(92dvh,860px)] max-w-5xl flex-col overflow-hidden outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2"
          onCloseAutoFocus={(event) => {
            if (!onRestoreFocus) return;
            event.preventDefault();
            onRestoreFocus();
          }}
        >
        {/* Header */}
        <div className="ui-soft-divider flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Dialog.Title className="text-base font-bold text-[var(--ui-text)]">{title}</Dialog.Title>
              <ReviewStatusPill status={review.status} />
            </div>
            <Dialog.Description className="mt-1 text-xs text-[var(--ui-text-subtle)]">
              {review.kind === "weekly" ? "周复盘" : "月复盘"} · {review.period_start} 至 {review.period_end} · v{review.version} · {review.model || "AI"}
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button type="button" className="ui-icon-button h-8 w-8" aria-label="关闭复盘详情">
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
            <div className="mt-2.5 grid grid-cols-2 gap-2">
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
        {editing ? (
          <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-2">
            <div className="ui-soft-divider min-h-0 overflow-y-auto border-b p-4 md:border-b-0 md:border-r">
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
                className="ui-textarea min-h-[320px] h-[48vh] rounded-lg font-mono text-xs leading-5"
              />
            </div>
            <div className="min-h-0 overflow-y-auto p-4">
              <div className="mb-1.5 flex h-[18px] items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ui-text)]">预览</span>
                <span className="text-[10px] text-[var(--ui-text-subtle)]">实时同步</span>
              </div>
              <div className="ui-panel-muted flex h-10 items-center rounded-lg px-3 text-sm font-medium text-[var(--ui-text)]">
                <span className="truncate">{title.trim() || "未填写标题"}</span>
              </div>
              <div className="mb-1.5 mt-4 text-xs font-semibold text-[var(--ui-text)]">正文预览</div>
              <div className="ui-panel-muted min-h-[320px] p-4">
                <MarkdownContent content={content} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <MarkdownContent content={displayContent} />
          </div>
        )}

        {/* Footer */}
        <div className="ui-soft-divider flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="ui-button-danger"
          >
            删除
          </button>
          <div className="flex flex-wrap justify-end gap-2">
            {editing ? (
              <>
                <button type="button" onClick={() => setEditing(false)} disabled={saving}
                  className="ui-button-secondary">取消编辑</button>
                <button type="button" onClick={onSave} disabled={saving}
                  className="ui-button-primary">保存草稿</button>
                <button type="button" onClick={onConfirm} disabled={saving}
                  className="ui-button-success">确认归档</button>
              </>
            ) : (
              <>
                {onExtractKnowledge && (
                  <button type="button" onClick={onExtractKnowledge} disabled={saving || extractingKnowledge}
                    className="ui-button-secondary">
                    <BookMarked size={14} />
                    {extractingKnowledge ? "提取中" : "提取知识"}
                  </button>
                )}
                <button type="button" onClick={() => setEditing(true)}
                  className="ui-button-secondary">编辑</button>
                {review.status !== "confirmed" && (
                  <button type="button" onClick={onConfirm} disabled={saving}
                    className="ui-button-primary">确认归档</button>
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
