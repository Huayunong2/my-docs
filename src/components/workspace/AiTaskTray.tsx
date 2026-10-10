import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { X, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { copyText } from "../../lib/clipboard";
import * as api from "../../lib/api";
import MarkdownContent from "../MarkdownContent";
import CandidateOrganizer, { type OrganizerDraft } from "../knowledge/CandidateOrganizer";
import "../knowledge/organize.css";

interface CandidateQueue {
  candidates: api.KnowledgeCardCandidate[];
  keys: string[];
  active: number;
  skipped: number[];
  drafts: Record<string, OrganizerDraft>;
}
const emptyQueue: CandidateQueue = { candidates: [], keys: [], active: 0, skipped: [], drafts: {} };

function restoreTaskFocus() {
  const launcher = document.getElementById("ai-task-launcher");
  if (launcher?.getClientRects().length) launcher.focus();
  else document.querySelector<HTMLElement>('.shell-mobile-nav [aria-label="打开更多入口"]')?.focus();
}

const taskNames: Record<api.AiTaskId, string> = {
  daily_summary: "每日总结",
  knowledge_extract: "知识条目提取",
  weekly_review: "周回顾",
  monthly_review: "月回顾",
};
const statusNames: Record<string, string> = {
  running: "进行中",
  completed: "已完成",
  completed_with_errors: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

function createdLabel(unix?: number) {
  return unix
    ? new Date(unix * 1000).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "时间未提供";
}

export default function AiTaskTray({
  open,
  onOpenChange,
  onRunningCountChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRunningCountChange: (count: number) => void;
}) {
  const [mobile, setMobile] = useState(() => matchMedia("(max-width: 767px)").matches);
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height || innerHeight);
  const [viewportBottom, setViewportBottom] = useState(0);
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => {
      const viewport = window.visualViewport;
      setMobile(media.matches);
      setViewportHeight(viewport?.height || innerHeight);
      setViewportBottom(viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0);
    };
    media.addEventListener("change", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => { media.removeEventListener("change", update); window.visualViewport?.removeEventListener("resize", update); window.visualViewport?.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [queues, setQueues] = useState<Record<string, CandidateQueue>>({});
  const server = api.getServerUrl();
  const queueKey = `${server}:${selected}`;
  const { candidates, active, skipped } = queues[queueKey] || emptyQueue;
  const updateQueue = (update: (queue: CandidateQueue) => CandidateQueue) =>
    setQueues(current => ({ ...current, [queueKey]: update(current[queueKey] || emptyQueue) }));
  const [actionBusy, setActionBusy] = useState(false);
  const actionLock = useRef(false);
  const [error, setError] = useState("");
  const [popover, setPopover] = useState({ left: 16, top: 80 });
  const wasOpen = useRef(open);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["aiTasks", api.getServerUrl()],
    queryFn: api.listAiTasks,
    refetchInterval: open ? 1500 : 10000,
  });
  const detail = useQuery({
    queryKey: ["aiTask", api.getServerUrl(), selected],
    queryFn: () => api.getAiTask(selected!),
    enabled: open && !!selected,
    refetchInterval: (state) => open && state.state.data?.status === "running" ? 1500 : false,
  });

  useEffect(() => {
    const update = () => void query.refetch();
    window.addEventListener("ai-tasks-changed", update);
    return () => window.removeEventListener("ai-tasks-changed", update);
  }, [query.refetch]);
  useEffect(() => {
    if (!detail.data || detail.data.id !== selected) return;
    const incoming = (detail.data.result?.cards || []).map((card: api.KnowledgeCardCandidate, index: number) => ({
      ...card,
      candidate_key: `${detail.data!.id}:${index}`,
    }));
    setQueues(current => {
      const queue = current[queueKey] || emptyQueue;
      const added = incoming.filter((card: api.KnowledgeCardCandidate) => !queue.keys.includes(card.candidate_key!));
      if (!added.length) return current;
      return { ...current, [queueKey]: { ...queue, candidates: [...queue.candidates, ...added], keys: [...queue.keys, ...added.map((card: api.KnowledgeCardCandidate) => card.candidate_key!)] } };
    });
  }, [selected, detail.data, queueKey]);

  const tasks = query.data ?? [];
  const task = detail.data || tasks.find((item) => item.id === selected);
  const running = tasks.filter((item) => item.status === "running").length;
  const inputTokens = tasks.reduce((total, item) => total + (item.usage?.prompt_tokens ?? 0), 0);
  const outputTokens = tasks.reduce((total, item) => total + (item.usage?.completion_tokens ?? 0), 0);
  const hasKnownUsage = tasks.some((item) => item.usage !== null);
  const pricedTasks = tasks.filter((item) => item.estimated_cost_cny !== null);
  const estimatedCost = pricedTasks.reduce((total, item) => total + (item.estimated_cost_cny ?? 0), 0);
  const incompleteUsage = tasks.some((item) => item.status === "running" || !item.usage_complete);
  const missingPrice = tasks.some((item) => item.usage_complete && item.usage && item.estimated_cost_cny === null);

  useEffect(() => { onRunningCountChange(running); }, [running, onRunningCountChange]);
  useLayoutEffect(() => {
    if (wasOpen.current && !open) restoreTaskFocus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open || mobile) return;
    const anchor = document.getElementById("ai-task-launcher");
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(452, innerWidth - 24);
    const height = Math.min(selected ? 660 : 360, innerHeight - 24);
    const left = Math.min(Math.max(rect.left + rect.width / 2 < innerWidth / 2 ? rect.left : rect.right - width, 12), Math.max(12, innerWidth - width - 12));
    const below = rect.bottom + 12;
    const top = below + height <= innerHeight - 12 ? below : Math.max(12, rect.top - height - 12);
    setPopover({ left, top });
  }, [open, selected, mobile, viewportHeight]);

  const runAction = async (action: () => Promise<unknown>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setActionBusy(true);
    setError("");
    try {
      await action();
      await Promise.all([
        client.invalidateQueries({ queryKey: ["aiTasks"] }),
        client.invalidateQueries({ queryKey: ["aiTask"] }),
      ]);
    } catch (cause) {
      setError(api.getErrorMessage(cause));
    } finally { actionLock.current = false; setActionBusy(false); }
  };

  const taskSource = (item: api.AiTaskView) =>
    item.source_name || (item.date ? `记录日期 ${item.date}` : "处理范围见结果来源");
  const tokenTotal = (value: number) => !tasks.length ? "—" : !hasKnownUsage ? "未返回" : incompleteUsage ? `已知 ${value.toLocaleString("zh-CN")}+` : value.toLocaleString("zh-CN");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={mobile}>
      <Dialog.Portal>
        {mobile && <Dialog.Overlay className="ko-task-overlay"/>}
        <Dialog.Content
          className="ko-task-dialog"
          data-expanded={!!selected}
          aria-describedby="ai-task-description"
          id="ai-task-panel"
          style={{ left: popover.left, top: popover.top, "--ko-viewport-height": `${viewportHeight}px`, "--ko-viewport-bottom": `${viewportBottom}px` } as CSSProperties}
          onInteractOutside={(event) => {
            if (event.target instanceof Element && event.target.closest("#ai-task-launcher")) {
              event.preventDefault();
              return;
            }
            onOpenChange(false);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreTaskFocus();
          }}
        >
          <header>
            <div>
              <Dialog.Title>AI 使用情况</Dialog.Title>
              <Dialog.Description id="ai-task-description">
                今日总结、知识条目提取和周／月回顾会生成后台任务。这里查看来源、进度、结果和供应商用量；任务保留一小时，服务重启后失效。
              </Dialog.Description>
            </div>
            <Dialog.Close className="ui-icon-button" aria-label="关闭 AI 使用情况">
              <X size={18} />
            </Dialog.Close>
          </header>

          <section className="ko-usage-overview" aria-label="最近保留的 AI 用量">
            <div><span>进行中</span><strong>{running}</strong></div>
            <div><span>输入 token</span><strong>{tokenTotal(inputTokens)}</strong></div>
            <div><span>输出 token</span><strong>{tokenTotal(outputTokens)}</strong></div>
            <div><span>费用估算（CNY）</span><strong>{pricedTasks.length ? `¥${estimatedCost.toFixed(4)}${pricedTasks.length < tasks.length ? "+" : ""}` : !tasks.length ? "—" : missingPrice ? "未设置单价" : "未返回"}</strong></div>
            <p>{tasks.length ? `${tasks.length} 个任务（最近一小时）` : "尚无 AI 任务"}{incompleteUsage ? " · 有任务用量未返回完整" : ""}{missingPrice ? " · 部分模型未设置单价" : ""}</p>
          </section>

          <div className="ko-task-body">
            {query.isError ? (
              <button className="ui-button-secondary" onClick={() => void query.refetch()}>读取任务失败，重试</button>
            ) : query.isPending ? (
              <p className="ko-muted">正在读取最近的 AI 任务…</p>
            ) : !tasks.length ? (
              <p className="ko-muted">在今日记录使用总结或知识提取，在统计页生成周回顾／月回顾后，相关 AI 任务会显示在这里。</p>
            ) : (
              <div className="ko-task-grid">
                {selected && <button className="ui-button-ghost" onClick={() => setSelected(null)}>返回用量概览</button>}
                <nav aria-label="AI 任务列表">
                  {tasks.map((item) => (
                    <button
                      className="ko-task-item"
                      aria-current={selected === item.id ? "true" : undefined}
                      key={item.id}
                      onClick={() => { setSelected(item.id); setError(""); }}
                    >
                      <strong>{taskNames[item.task]}</strong>
                      <span>{taskSource(item)}</span>
                      <small>{statusNames[item.status] || item.status}{item.status === "running" ? ` · ${item.progress_percent}%` : ""} · {createdLabel(item.created_at_unix)}</small>
                    </button>
                  ))}
                </nav>

                <section className="ko-task-detail">
                  {detail.isError ? (
                    <div className="ui-alert-warn" role="alert"><p>{detail.error instanceof api.ApiError && detail.error.status === 404 ? "此任务已过期或服务已重启，结果无法再读取。请回到原页面重新生成。" : api.getErrorMessage(detail.error)}</p><button className="ui-button-secondary" onClick={() => void detail.refetch()}>重新读取</button></div>
                  ) : selected && detail.isPending ? (
                    <p className="ko-muted" role="status">正在读取任务结果…</p>
                  ) : !task ? (
                    <p className="ko-muted">选择任务查看处理范围、结果与用量。</p>
                  ) : (
                    <>
                      <div className="ko-task-title">
                        <div><h3>{taskNames[task.task]}</h3><p>来源：{taskSource(task)}</p><p>开始：{createdLabel(task.created_at_unix)}</p></div>
                        <span className="ko-task-status" data-status={task.status}>{statusNames[task.status] || task.status}{task.status === "running" ? ` · ${task.progress_percent}%` : ""}</span>
                      </div>
                      {task.status === "running" && <div className="ko-task-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress_percent} aria-label="AI 任务进度"><i style={{ width: `${task.progress_percent}%` }} /></div>}
                      <div className="ko-actions">
                        {task.status === "running" && <button className="ui-button-secondary" disabled={actionBusy} onClick={() => void runAction(() => api.cancelAiTask(task.id))}>取消任务</button>}
                        {["failed", "completed_with_errors", "cancelled"].includes(task.status) && <button className="ui-button-secondary" disabled={actionBusy} onClick={() => void runAction(() => api.retryAiTask(task.id))}><RefreshCw size={14} />重试未完成部分</button>}
                      </div>
                      {task.error && <p className="ui-alert-warn" role="alert">{task.error}</p>}
                      <p className="ko-task-usage" role="status">
                        {task.usage ? `本任务：输入 ${task.usage.prompt_tokens.toLocaleString("zh-CN")} · 输出 ${task.usage.completion_tokens.toLocaleString("zh-CN")} token${task.usage_complete ? "" : " · 用量尚未完整"}` : "本任务：供应商尚未返回 token 用量"}
                        {task.estimated_cost_cny !== null && ` · 估算 ¥${task.estimated_cost_cny.toFixed(4)}`}
                        {task.usage_complete && task.usage && task.estimated_cost_cny === null && " · 模型未设置单价"}
                      </p>
                      {task.task === "knowledge_extract" ? (
                        <>
                          {candidates[active] && !skipped.includes(active) ? (
                            <CandidateOrganizer
                              key={`${task.id}-${active}-${candidates.length}`}
                              candidate={candidates[active]}
                              sessionDraft={queues[queueKey]?.drafts[candidates[active].candidate_key!]}
                              onSessionDraftChange={draft => updateQueue(queue => ({ ...queue, drafts: { ...queue.drafts, [candidates[active].candidate_key!]: draft } }))}
                              sourceName={task.result?.source_name}
                              candidateKey={candidates[active].candidate_key}
                              sourceJobId={task.analysis_job_id || undefined}
                              onChange={(patch) => updateQueue(queue => ({ ...queue, candidates: queue.candidates.map((card, index) => index === active ? { ...card, ...patch } : card) }))}
                              onProcessed={() => updateQueue(queue => {
                                const remaining = queue.candidates.filter((_, index) => index !== active);
                                const stillSkipped = queue.skipped.filter(index => index !== active).map(index => index > active ? index - 1 : index);
                                const next = remaining.findIndex((_, index) => !stillSkipped.includes(index));
                                return { ...queue, candidates: remaining, skipped: stillSkipped, active: Math.max(0, next) };
                              })}
                              onSkip={() => updateQueue(queue => {
                                const skippedNext = [...new Set([...queue.skipped, active])];
                                return { ...queue, skipped: skippedNext, active: Math.max(0, queue.candidates.findIndex((_, index) => !skippedNext.includes(index))) };
                              })}
                            />
                          ) : candidates.length ? (
                            <div className="ko-task-empty"><p>候选知识均已处理或跳过。</p><button className="ui-button-ghost" onClick={() => updateQueue(queue => ({ ...queue, skipped: [], active: 0 }))}>恢复候选列表</button></div>
                          ) : (
                            <p className="ko-muted">{task.status === "running" ? "正在提取候选知识，已完成部分会陆续显示。" : task.result?.cards?.length ? "本任务的候选知识已处理完成。" : "本任务没有提取到候选知识。"}</p>
                          )}
                        </>
                      ) : task.result?.summary ? (
                        <>
                          <MarkdownContent content={task.result.summary} />
                          <div className="ko-actions">
                            <button className="ui-button-secondary" onClick={async () => {
                              try { await copyText(task.result.summary); toast.success("已复制总结"); }
                              catch { toast.error("复制失败，请选择正文后复制"); }
                            }}>复制总结</button>
                            <Link className="ui-button-secondary" to="/today" search={{ date: task.date }} onClick={() => onOpenChange(false)}>返回原记录</Link>
                          </div>
                        </>
                      ) : task.result?.content ? (
                        <><MarkdownContent content={task.result.content} /><Link className="ui-button-secondary" to="/reviews" search={{}} onClick={() => onOpenChange(false)}>打开周期回顾</Link></>
                      ) : (
                        <p className="ko-muted">任务完成后，总结或周期回顾会显示在这里。</p>
                      )}
                    </>
                  )}
                  {error && <p role="alert" className="ui-alert-warn">{error}</p>}
                </section>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
