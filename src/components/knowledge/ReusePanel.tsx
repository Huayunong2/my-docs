import { newClientId } from "../../lib/clientId";
import { Textarea } from "../ui/reading-surface";
import { SelectField, SelectItem } from "../ui/select";
import { motion, useReducedMotion } from "framer-motion";
import { useSimpleDisplay } from "../../lib/simpleDisplay";
import { Button } from "../ui/button";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CornerUpRight, History, Undo2 } from "lucide-react";
import * as api from "../../lib/api";
import "./organize.css";

export default function ReusePanel({ cardId }: { cardId: string }) {
  const client = useQueryClient();
  const simple=useSimpleDisplay();
  const reduced=useReducedMotion();
  const [page, setPage] = useState(1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<api.ReuseEvent | null>(null);
  const [justRecorded, setJustRecorded] = useState(false);
  const [project, setProject] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<string | null>(null);
  const lock = useRef(false);
  const history = useQuery({
    queryKey: ["knowledgeReuse", cardId, page],
    queryFn: () => api.queryKnowledgeReuse({ card_id: cardId, page }),
    enabled: historyOpen,
  });
  const spaces = useQuery({
    queryKey: ["reuseSpaces"],
    queryFn: () => api.listSpaces(undefined, true),
    staleTime: 60_000,
    enabled: !!editing,
  });

  const act = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ["knowledgeReuse"] });
    } catch (cause) {
      setError(api.getErrorMessage(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const record = () => act(async () => {
    request.current ??= newClientId();
    const event = await api.recordKnowledgeReuse(cardId, request.current);
    request.current = null;
    setEditing(event);
    setJustRecorded(true);
    setProject("");
    setProblem("");
    setPage(1);
    setHistoryOpen(true);
  });

  return (
    <section className="ko-reuse" data-knowledge-reuse-panel={cardId} aria-label="知识复用记录">
      <div className="ko-reuse-toolbar">
        <div className="ko-reuse-copy">
          <strong>实际复用</strong>
          <span>打开次数只表示浏览，不计入复用</span>
        </div>
        <div className="ko-reuse-controls">
          <Button variant="primary" disabled={!!editing} loading={busy} onClick={() => void record()}>
            <CornerUpRight size={15} />记录本次使用
          </Button>
          <button
            className="ui-button-secondary"
            aria-expanded={historyOpen}
            aria-controls="knowledge-reuse-history"
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <History size={15} />{historyOpen ? "收起历史" : "查看历史"}
            {historyOpen && history.data ? ` · ${history.data.total}` : ""}
          </button>
        </div>
      </div>

      {editing && (
        <motion.div className="ko-reuse-form" initial={simple || reduced ? false : {opacity:0,y:4}} animate={{opacity:1,y:0}} transition={{duration:simple || reduced ? 0 : .18}}>
          <p role="status"><Check size={15} />{justRecorded ? "已记录一次，可选填使用场景。" : "补充这次复用的使用场景。"}</p>
          <label>
            用于哪个项目
            <SelectField aria-label="用于哪个项目" className="ui-field" value={project} onValueChange={(event) => setProject(event)}>
              <SelectItem value="">暂不填写</SelectItem>
              {project && !spaces.data?.some(space => space.kind === "project" && space.name === project) && <SelectItem value={project}>{project}</SelectItem>}
              {spaces.data?.filter((space) => space.kind === "project").map((space) => (
                <SelectItem value={space.name} key={space.name}>
                  {space.name}{space.status === "archived" ? "（已归档）" : ""}
                </SelectItem>
              ))}
            </SelectField>
          </label>
          <label>
            解决了什么问题
            <Textarea
              className="ui-textarea"
              maxLength={2000}
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
              placeholder="例如：用这条知识定位了备份恢复问题"
            />
          </label>
          <div className="ko-actions">
            <button className="ui-button-secondary" disabled={busy} onClick={() => void act(async () => {
              await api.updateKnowledgeReuse(editing.id, project, problem);
              setEditing(null);
              toast.success("复用详情已保存");
            })}>保存详情</button>
            <button className="ui-button-ghost" disabled={busy} onClick={() => setEditing(null)}>稍后补充</button>
            <button className="ui-button-ghost" disabled={busy} onClick={() => void act(async () => {
              await api.deleteKnowledgeReuse(editing.id);
              setEditing(null);
              toast.success("已撤销本次复用");
            })}><Undo2 size={14} />撤销本次</button>
          </div>
        </motion.div>
      )}

      {error && <p className="ui-alert-warn" role="alert">{error}</p>}
      {historyOpen && (
        <div className="ko-reuse-history" id="knowledge-reuse-history">
          {history.isError ? (
            <button className="ui-button-secondary" onClick={() => void history.refetch()}>读取失败，重试</button>
          ) : history.isPending ? (
            <p className="ko-muted">正在读取复用记录…</p>
          ) : !history.data.events.length ? (
            <p className="ko-muted">尚无复用记录。使用知识条目解决问题后，可以在这里留下记录。</p>
          ) : (
            <ul className="ko-event-list">
              {history.data.events.map((event) => (
                <li key={event.id}>
                  <div><time>{event.used_at.replace("T", " ").slice(0, 16)}</time>{event.project && <span>{event.project}</span>}</div>
                  <p>{event.problem || "未补充问题说明"}</p>
                  <div className="ko-event-actions">
                    <button className="ui-button-ghost" disabled={busy} onClick={() => {
                      setEditing(event);
                      setJustRecorded(false);
                      setProject(event.project);
                      setProblem(event.problem);
                    }}>补充详情</button>
                    <button className="ui-button-ghost" disabled={busy} onClick={() => void act(async () => { await api.deleteKnowledgeReuse(event.id); if (editing?.id === event.id) setEditing(null); toast.success("已撤销这次复用"); })}>撤销</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {(page > 1 || history.data?.has_more) && (
            <div className="ko-actions">
              <button className="ui-button-ghost" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
              <button className="ui-button-ghost" disabled={!history.data?.has_more} onClick={() => setPage((value) => value + 1)}>下一页</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
