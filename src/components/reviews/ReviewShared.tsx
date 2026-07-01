import { useState } from "react";
import { BookMarked, X } from "lucide-react";
import type { Review } from "../../lib/api";
import { normalizeReviewContent } from "../../lib/reviewContent";
import MarkdownContent from "../MarkdownContent";

export function ReviewStatusPill({ status }: { status: Review["status"] }) {
  return (
    <span
      className={[
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        status === "confirmed"
          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300"
          : "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300",
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
}) {
  const [editing, setEditing] = useState(false);
  const sourceCount = review.kind === "weekly"
    ? countJsonItems(review.source_article_ids)
    : countJsonItems(review.source_review_ids);
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={onClose}>
      <div
        className="ui-modal-surface flex max-h-[92vh] max-w-3xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 dark:border-white/5 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h3>
              <ReviewStatusPill status={review.status} />
            </div>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {review.kind === "weekly" ? "周复盘" : "月复盘"} · {review.period_start} 至 {review.period_end} · v{review.version} · {review.model || "AI"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-icon-button h-8 w-8"
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-gray-100 bg-gray-50/70 px-5 py-3 dark:border-white/5 dark:bg-white/[0.03] sm:grid-cols-3">
          {metaItems.map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="text-[11px] text-gray-400 dark:text-gray-500">{item.label}</div>
              <div className="mt-0.5 truncate text-xs font-medium text-gray-700 dark:text-gray-200">{item.value}</div>
            </div>
          ))}
        </div>

        {/* Body */}
        {editing ? (
          <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-2">
            <div className="border-b border-gray-100 p-4 dark:border-white/5 lg:border-b-0 lg:border-r">
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">标题</label>
              <input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                className="ui-field mb-3 rounded-lg"
              />
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">正文</label>
              <textarea
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                className="ui-textarea h-[48vh] min-h-[320px] rounded-lg font-mono"
              />
            </div>
            <div className="min-h-[320px] overflow-y-auto p-4">
              <div className="mb-3 text-xs font-medium text-gray-500 dark:text-gray-400">预览</div>
              <MarkdownContent content={content} />
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <MarkdownContent content={displayContent} />
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 dark:border-white/5 px-5 py-4 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="ui-button-danger"
          >
            删除
          </button>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button onClick={() => setEditing(false)} disabled={saving}
                  className="ui-button-secondary">取消编辑</button>
                <button onClick={onSave} disabled={saving}
                  className="ui-button-primary">保存草稿</button>
                <button onClick={onConfirm} disabled={saving}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50">确认归档</button>
              </>
            ) : (
              <>
                {onExtractKnowledge && (
                  <button onClick={onExtractKnowledge} disabled={saving || extractingKnowledge}
                    className="ui-button-secondary">
                    <BookMarked size={14} />
                    {extractingKnowledge ? "提取中" : "提取知识"}
                  </button>
                )}
                <button onClick={() => setEditing(true)}
                  className="ui-button-secondary">编辑</button>
                {review.status !== "confirmed" && (
                  <button onClick={onConfirm} disabled={saving}
                    className="ui-button-primary">确认归档</button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function countJsonItems(raw: string) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
