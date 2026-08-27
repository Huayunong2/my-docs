import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, Check, Copy, Edit3, Trash2, X } from "lucide-react";
import type { Article } from "../lib/api";
import MarkdownContent from "./MarkdownContent";

export default function ArticleDetail({
  article,
  mode = "modal",
  onClose,
  onEdit,
  onDelete,
}: {
  article: Article;
  mode?: "modal" | "panel";
  onClose: () => void;
  onEdit: (date: string) => void;
  onDelete?: (article: Article) => void;
}) {
  const [copied, setCopied] = useState(false);
  const tags = article.tags;

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(article.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = article.content; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  };

  const content = (
    <div
      className={
        mode === "panel"
          ? "flex h-full flex-col bg-[var(--ui-surface)]"
          : "ui-modal-surface flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"
      }
    >
      <div className="ui-soft-divider border-b px-4 py-4 md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-chip h-auto px-2.5 py-1 font-mono text-xs">
              <CalendarDays size={13} /> {article.date}
            </span>
            {article.mood && <span className="text-lg">{article.mood}</span>}
          </div>
          {mode === "modal" ? (
            <Dialog.Title asChild>
              <h2 className="mt-2 truncate text-xl font-bold text-[var(--ui-text)]">
                {article.title || "(无标题)"}
              </h2>
            </Dialog.Title>
          ) : (
            <h2 className="mt-2 truncate text-xl font-bold text-[var(--ui-text)]">
              {article.title || "(无标题)"}
            </h2>
          )}
          {mode === "modal" && (
            <Dialog.Description className="sr-only">
              查看每日记录详情，可复制、编辑或删除这条记录。
            </Dialog.Description>
          )}
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="ui-chip h-6 px-2 text-[11px]">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={copyContent} className="ui-button-secondary hidden sm:inline-flex" aria-label={copied ? "已复制记录内容" : "复制记录内容"}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制"}
          </button>
          <button type="button" onClick={() => onEdit(article.date)} className="ui-button-primary">
            <Edit3 size={14} /> 编辑
          </button>
          {onDelete && (
            <button type="button" onClick={() => onDelete(article)} className="ui-button-danger hidden sm:inline-flex">
              <Trash2 size={14} /> 删除
            </button>
          )}
          <button type="button" onClick={onClose} className="ui-icon-button h-9 w-9" title="关闭" aria-label="关闭详情">
            <X size={16} />
          </button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="ui-reader">
          <MarkdownContent content={article.content} />
        </div>
      </div>
      <div className="ui-soft-divider border-t px-4 py-3 text-xs text-[var(--ui-text-subtle)] md:px-6">
        <div className="ui-reader flex items-center justify-between gap-3">
          <span>共 {article.word_count} 字</span>
          <span className="truncate">更新于 {article.updated_at}</span>
        </div>
      </div>
    </div>
  );

  const touchY = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => { touchY.current = e.touches[0].clientY; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.changedTouches[0].clientY - touchY.current > 150) onClose();
  };

  if (mode === "panel") return content;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
        <Dialog.Content asChild>
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
