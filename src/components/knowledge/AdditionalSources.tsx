import { useQuery } from "@tanstack/react-query";
import * as api from "../../lib/api";
export default function AdditionalSources({ cardId }: {
    cardId: string;
}) { const q = useQuery({ queryKey: ["knowledgeSources", cardId], queryFn: () => api.getKnowledgeSources(cardId) }); if (!q.data || q.data.length < 2)
    return null; return <details className="kl-reader-source"><summary>全部来源 · {q.data.length}</summary>{q.data.map((s, i) => <div key={i}><p>{s.date || (s.review_id ? "周期回顾" : "补充资料")}</p><blockquote>{s.excerpt}</blockquote>{s.article_id && s.date && <a className="ui-button-ghost" href={`/today?date=${encodeURIComponent(s.date)}`}>查看今日记录</a>}</div>)}</details>; }
