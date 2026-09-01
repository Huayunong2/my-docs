import { useRef, useState, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, Check, Copy, Edit3, Folder, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Article } from "../lib/api";
import { copyText } from "../lib/clipboard";
import MarkdownContent from "./MarkdownContent";
import SourceExcerptMatch from "./SourceExcerptMatch";

export default function ArticleDetail({
  article,
  mode = "modal",
  onClose,
  onEdit,
  onDelete,
  highlight = "",
  returnFocusRef,
}: {
  article: Article;
  mode?: "modal" | "panel";
  onClose: () => void;
  onEdit: (date: string) => void;
  onDelete?: (article: Article) => void;
  highlight?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [copied, setCopied] = useState(false);
  const tags = article.tags;
  const spaces = article.spaces || [];
  const hasTitle = Boolean(article.title?.trim());
  const displayTitle = article.title?.trim() || "(无标题)";
  const readableContent = withoutDuplicateLeadingHeading(article.content, hasTitle ? displayTitle : "");
  const sourceHeadingRef = useRef<HTMLHeadingElement>(null);

  const copyContent = async () => {
    try {
      await copyText(article.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("复制失败，当前浏览器未允许访问剪贴板；请选中正文后复制。", { duration: 3200 });
    }
  };

  const content = (
    <div
      className={
        mode === "panel"
          ? "article-detail-surface flex h-full flex-col bg-[var(--ui-surface)]"
          : "article-detail-surface ui-modal-surface flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"
      }
    >
      <div className="article-detail-header ui-soft-divider border-b px-4 py-4 md:px-6">
        <div className="article-detail-header-inner flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="article-detail-meta flex flex-wrap items-center gap-2">
              <CalendarDays size={14} aria-hidden="true" />
              <time className="article-detail-date tabular-nums" dateTime={article.date}>{article.date}</time>
              {article.mood && <span className="article-detail-mood ml-1 text-base leading-none" aria-label="当天心情">{article.mood}</span>}
            </div>
            {mode === "modal" ? (
              <Dialog.Title asChild>
                <h2
                  ref={sourceHeadingRef}
                  tabIndex={-1}
                  className={["article-detail-title mt-2 break-words text-[1.375rem] leading-7", hasTitle ? "font-semibold" : "article-detail-title-empty font-medium"].join(" ")}
                >
                  {displayTitle}
                </h2>
              </Dialog.Title>
            ) : (
              <h2 className={["article-detail-title mt-2 break-words text-[1.375rem] leading-7", hasTitle ? "font-semibold" : "article-detail-title-empty font-medium"].join(" ")}>
                {displayTitle}
              </h2>
            )}
            {mode === "modal" && (
              <Dialog.Description className="sr-only">
                查看每日记录详情，可复制、编辑或将这条记录移入回收站。
              </Dialog.Description>
            )}
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="article-detail-tag">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            {spaces.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {spaces.map((space) => (
                  <span key={space} className="article-detail-tag article-detail-space">
                    <Folder size={11} /> {space}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="article-detail-actions flex shrink-0 flex-wrap items-center gap-1 self-end" role="group" aria-label="记录操作">
            <button type="button" onClick={copyContent} className="article-detail-action-button ui-button-ghost justify-center" aria-label={copied ? "已复制记录内容" : "复制记录内容"} title={copied ? "已复制" : "复制记录内容"}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span className="article-detail-action-label">{copied ? "已复制" : "复制"}</span>
            </button>
            <button type="button" onClick={() => onEdit(article.date)} className="article-detail-action-button ui-button-ghost justify-center" aria-label="编辑记录" title="编辑记录">
              <Edit3 size={14} /> <span className="article-detail-action-label">编辑</span>
            </button>
            {onDelete && (
              <button type="button" onClick={() => onDelete(article)} className="article-detail-action-button ui-button-danger justify-center" aria-label="移入记录回收站" title="移入记录回收站">
                <Trash2 size={14} /> <span className="article-detail-action-label">移入回收站</span>
              </button>
            )}
            <button type="button" onClick={onClose} className="article-detail-close-button ui-icon-button" title="关闭" aria-label="关闭详情">
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
      <div className="article-detail-body flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
        <div className="ui-reader">
          <SourceExcerptMatch source={article.content} excerpt={highlight} />
          <MarkdownContent content={readableContent} />
        </div>
      </div>
      <div className="ui-modal-meta ui-soft-divider border-t px-4 py-3 text-xs text-[var(--ui-text-subtle)] md:px-6">
        <div className="ui-reader flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span>共 {article.word_count} 字</span>
            <span className="truncate" title={article.updated_at}>更新于 {formatUpdatedAt(article.updated_at)}</span>
          </div>
          {highlight.trim() && (
            <button type="button" onClick={onClose} className="ui-button-primary min-h-11 shrink-0 self-end text-xs md:min-h-0 md:self-auto">
              返回知识条目
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const touchY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchY.current = e.target === e.currentTarget ? e.touches[0].clientY : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchY.current !== null && e.target === e.currentTarget && e.changedTouches[0].clientY - touchY.current > 150) onClose();
    touchY.current = null;
  };

  if (mode === "panel") return content;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          asChild
          onOpenAutoFocus={(event) => {
            if (!returnFocusRef && !highlight.trim()) return;
            if (!sourceHeadingRef.current) return;
            event.preventDefault();
            sourceHeadingRef.current.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef?.current) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
        >
          <div
            onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className="fixed inset-0 z-50 flex items-end justify-center outline-hidden sm:items-center"
          >
            {content}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function withoutDuplicateLeadingHeading(content: string, title: string): string {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return content;
  const lines = content.split("\n");
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLine < 0) return content;
  const match = lines[firstContentLine].match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (!match) return content;
  const heading = match[1].trim().replace(/\s+#+\s*$/, "").trim();
  if (heading !== normalizedTitle) return content;
  return [...lines.slice(0, firstContentLine), ...lines.slice(firstContentLine + 1)].join("\n").replace(/^\n+/, "");
}

function formatUpdatedAt(value: string): string {
  if (!value) return "时间未知";
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
