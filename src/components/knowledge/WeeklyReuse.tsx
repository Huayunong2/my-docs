import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import * as api from "../../lib/api";
import { Button } from "../ui/button";
import { InlineError } from "../ui/Feedback";
import "./organize.css";

export default function WeeklyReuse() {
  const [page, setPage] = useState(1);
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const query = useQuery({ queryKey: ["knowledgeReuse", "week", date, page], queryFn: () => api.queryKnowledgeReuse({ date, page }) });
  return <section className="ft-panel ko-weekly" aria-label="本周实际复用">
    <header className="ft-panel-heading"><h2>本周实际复用</h2><span className="ft-caption">{query.data ? `${query.data.total} 次 · 周一至周日` : query.isPending ? "正在读取" : "读取失败"}</span></header>
    {query.isError ? <InlineError message="无法读取本周复用记录。" onRetry={() => void query.refetch()}/> : query.isPending ? <p role="status">正在读取…</p> : query.data.events.length ? <ul className="ko-event-list">{query.data.events.map(event => <li key={event.id}><Link to="/knowledge/$cardId" params={{ cardId: event.card_id }} search={{}}>{event.title}</Link><p>{event.project ? `${event.project} · ` : ""}{event.problem || "已记录复用，未补充问题说明"}</p><time>{event.used_at.replace("T", " ").slice(0, 16)}</time></li>)}</ul> : <p className="ko-muted ko-weekly-empty">尚无复用记录。使用知识解决问题后，可以在阅读区一键记录。</p>}
    {(page > 1 || query.data?.has_more) && <nav className="ko-actions" aria-label="本周复用分页"><Button size="small" variant="ghost" disabled={page === 1 || query.isFetching} onClick={() => setPage(value => value - 1)}>上一页</Button><Button size="small" variant="ghost" disabled={!query.data?.has_more || query.isFetching} onClick={() => setPage(value => value + 1)}>下一页</Button></nav>}
  </section>;
}
