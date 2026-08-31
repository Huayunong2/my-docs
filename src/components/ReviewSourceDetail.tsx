import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, ExternalLink, X } from "lucide-react";
import type { Review } from "../lib/api";
import { normalizeReviewContent } from "../lib/reviewContent";
import MarkdownContent from "./MarkdownContent";

/**
 * 知识卡片来源为周/月复盘时使用的只读查看器。
 * 复用现有阅读样式，只提供核验所需的正文、引用片段和回到知识卡片动作。
 */
export default function ReviewSourceDetail({
  review,
  highlight = "",
  onClose,
  onOpenReview,
}: {
  review: Review;
  highlight?: string;
  onClose: () => void;
  onOpenReview?: () => void;
}) {
  const kindLabel = review.kind === "weekly" ? "周复盘" : "月复盘";
  const content = normalizeReviewContent(review.kind, review.title, review.content);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
        <Dialog.Content className="ui-modal-surface fixed inset-x-3 bottom-3 z-50 flex max-h-[min(92dvh,860px)] max-w-3xl flex-col overflow-hidden outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div className="ui-soft-divider flex items-start justify-between gap-3 border-b px-4 py-4 md:px-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ui-chip h-auto gap-1 px-2.5 py-1 text-xs">
                  <CalendarDays size={13} /> {kindLabel}
                </span>
                <span className="ui-chip h-auto px-2.5 py-1 text-xs">{review.period_start} 至 {review.period_end}</span>
              </div>
              <Dialog.Title className="mt-2 break-words text-xl font-bold leading-7 text-[var(--ui-text)]">
                {review.title || "（无标题）"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-[var(--ui-text-subtle)]">
                只读来源 · v{review.version} · {review.model || "AI"}
              </Dialog.Description>
            </div>
            <button type="button" onClick={onClose} className="ui-icon-button h-9 w-9 shrink-0" title="返回卡片" aria-label="返回知识卡片">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
            <div className="ui-reader">
              {highlight.trim() && (
                <figure className="ui-status-accent mb-5 rounded-xl p-3" aria-label="当前卡片引用的来源片段">
                  <figcaption className="mb-1 text-xs font-semibold">当前卡片引用的片段</figcaption>
                  <blockquote className="whitespace-pre-wrap break-words text-sm leading-6">{highlight}</blockquote>
                </figure>
              )}
              <MarkdownContent content={content} />
            </div>
          </div>

          <div className="ui-soft-divider flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
            <span className="text-xs text-[var(--ui-text-subtle)]">来源是复盘内容，原始记录仍保留在每日记录中。</span>
            <div className="flex flex-wrap justify-end gap-2">
              {onOpenReview && (
                <button type="button" onClick={onOpenReview} className="ui-button-secondary">
                  <ExternalLink size={14} /> 打开复盘
                </button>
              )}
              <button type="button" onClick={onClose} className="ui-button-primary">
                返回卡片
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
