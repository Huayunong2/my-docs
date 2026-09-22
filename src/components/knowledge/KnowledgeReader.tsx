import {
  BookOpen,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  Link2,
  PencilLine,
} from "lucide-react";
import type { KnowledgeCard } from "../../lib/api";
import { cardStatusLabels, cardTypeLabels } from "../../lib/cardLabels";
import { knowledgeDate } from "../../lib/knowledgePresentation";
import { copyText } from "../../lib/clipboard";
import { toast } from "sonner";
import MarkdownContent from "../MarkdownContent";

interface Props {
  card: KnowledgeCard;
  related: KnowledgeCard[];
  sourceLabel: string;
  sourceState: string;
  sourceAvailable: boolean;
  sourceLoading: boolean;
  onSource: () => void;
  onEdit: () => void;
  onOpen: (card: KnowledgeCard) => void;
  onWikiLink?: (title: string) => void;
}

export default function KnowledgeReader(p: Props) {
  const copy = async () => {
    try {
      await copyText(`# ${p.card.title}\n\n${p.card.content}`);
      toast.success("已复制 Markdown");
    } catch {
      toast.error("复制失败，请在正文中选择文字后复制");
    }
  };
  return (
    <article className="kl-reading" aria-labelledby="knowledge-reading-title">
      <div className="kl-reader-meta">
        <span className="kl-type">
          <FileText size={15} />
          {cardTypeLabels[p.card.card_type]}
        </span>
        <span className="kl-status" data-status={p.card.status}>
          <i />
          {cardStatusLabels[p.card.status]}
        </span>
      </div>
      <h2 id="knowledge-reading-title" tabIndex={-1}>
        {p.card.title}
      </h2>
      <div className="kl-reading-byline">
        <span>更新于 {knowledgeDate(p.card.updated_at)}</span>
        {p.card.usage_count ? (
          <span>已打开 {p.card.usage_count} 次</span>
        ) : null}
      </div>
      {(p.card.projects?.length || p.card.tags.length) > 0 && (
        <div className="kl-reading-taxonomy">
          {p.card.projects?.map((name) => (
            <span key={name}>
              <Folder size={13} />
              {name}
            </span>
          ))}
          {p.card.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      )}
      <div className="kl-reading-content">
        <MarkdownContent content={p.card.content} onWikiLink={p.onWikiLink} />
      </div>
      <div className="kl-reading-actions">
        <button className="ui-button-secondary" onClick={copy}>
          <Copy size={15} />
          复制 Markdown
        </button>
        <button className="ui-button-ghost" onClick={p.onEdit}>
          <PencilLine size={15} />
          编辑内容
        </button>
      </div>
      <details className="kl-reader-source" open={undefined}>
        <summary>
          <BookOpen size={16} />
          <span>来源与依据</span>
          <small>{p.sourceState}</small>
        </summary>
        <div>
          <p>{p.sourceLabel}</p>
          {p.card.source_excerpt ? (
            <blockquote>{p.card.source_excerpt}</blockquote>
          ) : (
            <p className="kl-muted-note">
              尚未附上来源片段。来源可选，可在编辑时补充。
            </p>
          )}
          {p.sourceAvailable && (
            <button
              className="ui-button-secondary"
              onClick={p.onSource}
              disabled={p.sourceLoading}
            >
              <ExternalLink size={14} />
              {p.sourceLoading ? "读取中…" : "打开来源原文"}
            </button>
          )}
        </div>
      </details>
      {p.related.length > 0 && (
        <section className="kl-reading-related" aria-label="关联知识">
          <h3>
            <Link2 size={16} />
            关联知识
          </h3>
          {p.related.map((card) => (
            <button key={card.id} onClick={() => p.onOpen(card)}>
              <span>{card.title}</span>
              <ExternalLink size={14} />
            </button>
          ))}
        </section>
      )}
    </article>
  );
}
