import { useRef, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, ExternalLink, X } from "lucide-react";
import type { Review } from "../lib/api";
import { reviewBodyContent } from "../lib/reviewContent";
import MarkdownContent from "./MarkdownContent";
import SourceExcerptMatch from "./SourceExcerptMatch";

/**
 * 知识条目来源为周/月复盘时使用的只读查看器。
 * 复用现有阅读样式，只提供核验所需的正文、引用片段和回到知识条目动作。
 */
export default function ReviewSourceDetail({
  review,
  highlight = "",
  onClose,
  onOpenReview,
  returnFocusRef,
}: {
  review: Review;
  highlight?: string;
  onClose: () => void;
  onOpenReview?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const kindLabel = review.kind === "weekly" ? "周复盘" : "月复盘";
  const content = reviewBodyContent(review.kind, review.title, review.content);
  const sourceHeadingRef = useRef<HTMLHeadingElement>(null);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            if (!sourceHeadingRef.current) return;
            event.preventDefault();
            sourceHeadingRef.current.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef?.current) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
          className="ui-modal-surface fixed inset-x-3 bottom-3 z-50 flex max-h-[min(92dvh,860px)] max-w-3xl flex-col overflow-hidden outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2"
        >
          <div className="ui-soft-divider flex items-start justify-between gap-3 border-b px-4 py-4 md:px-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ui-chip h-auto gap-1 px-2.5 py-1 text-xs">
                  <CalendarDays size={13} /> {kindLabel}
                </span>
                <span className="ui-chip h-auto px-2.5 py-1 text-xs">{review.period_start} 至 {review.period_end}</span>
              </div>
              <Dialog.Title asChild>
                <h2 ref={sourceHeadingRef} tabIndex={-1} className="mt-2 break-words text-xl font-bold leading-7 text-[var(--ui-text)]">
                  {review.title || "（无标题）"}
                </h2>
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-[var(--ui-text-subtle)]">
                只读来源 · v{review.version} · {review.model || "AI"}
              </Dialog.Description>
            </div>
            <button type="button" onClick={onClose} className="ui-icon-button h-11 w-11 shrink-0 md:h-9 md:w-9" title="返回知识条目" aria-label="返回知识条目">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
            <div className="ui-reader">
              <SourceExcerptMatch source={content} excerpt={highlight} />
              <MarkdownContent content={content} />
            </div>
          </div>

          <div className="ui-soft-divider flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
            <span className="text-xs text-[var(--ui-text-subtle)]">来源是复盘内容，原始记录仍保留在每日记录中。</span>
            <div className="flex flex-wrap justify-end gap-2">
              {onOpenReview && (
                <button type="button" onClick={onOpenReview} className="ui-button-secondary min-h-11 md:min-h-0">
                  <ExternalLink size={14} /> 打开复盘
                </button>
              )}
              <button type="button" onClick={onClose} className="ui-button-primary min-h-11 md:min-h-0">
                返回知识条目
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
