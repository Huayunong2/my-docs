import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookMarked,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import { cardTypeLabels } from "../lib/cardLabels";
import { copyText } from "../lib/clipboard";
import { toast } from "sonner";
import MarkdownContent from "./MarkdownContent";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { DialogPositionMenu, useDialogWindowMovement } from "./ui/dialogWindow";
import {
  matchesAiSource,
  validKnowledgeCandidate,
} from "../lib/todayAiWorkflow";

type Mode = "summary" | "knowledge";
type Candidate = api.KnowledgeCardCandidate & { selected: boolean };
interface Props {
  mode: Mode | null;
  date: string;
  title: string;
  content: string;
  onMode: (mode: Mode | null) => void;
  ensureSource: () => Promise<api.Article | null>;
  onKnowledge: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}
export default function TodayAIPanel(p: Props) {
  const [summary, setSummary] = useState("");
  const [summarySource, setSummarySource] = useState({ date: "", content: "" });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateSource, setCandidateSource] = useState({
    date: "",
    content: "",
  });
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState<Mode | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<Mode, string>>({
    summary: "",
    knowledge: "",
  });
  const [imported, setImported] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const propsRef = useRef(p);
  propsRef.current = p;
  const queryClient = useQueryClient();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const staleSummary = !!summary && !matchesAiSource(summarySource, p);
  const staleCandidates =
    !!candidateSource.date && !matchesAiSource(candidateSource, p);
  const selected = candidates.filter((item) => item.selected);
  const invalid = selected.some((item) => !validKnowledgeCandidate(item));
  const generate = async (mode: Mode) => {
    if (lock.current || !p.content.trim()) return;
    const snapshot = { date: p.date, content: p.content };
    lock.current = true;
    setRunning(mode);
    setErrors((value) => ({ ...value, [mode]: "" }));
    try {
      if (mode === "summary") {
        const result = await api.summarizeWithAI({ content: snapshot.content });
        if (!mounted.current) return;
        if (!result.summary?.trim())
          throw new Error("没有收到可用总结，请重试。");
        setSummary(result.summary);
        setSummarySource(snapshot);
      } else {
        const result = await api.analyzeKnowledgeCards({
          content: snapshot.content,
          source_name: `${snapshot.date} ${p.title}`,
          max_cards: 6,
        });
        if (!mounted.current) return;
        setCandidates(
          result.cards.map((item) => ({ ...item, selected: true })),
        );
        setCandidateSource(snapshot);
        setActive(0);
        setImported(null);
        setSkipped(result.skipped);
      }
    } catch (error) {
      if (mounted.current)
        setErrors((value) => ({
          ...value,
          [mode]: api.getErrorMessage(error),
        }));
    } finally {
      lock.current = false;
      if (mounted.current) setRunning(null);
    }
  };
  const commit = async () => {
    if (
      lock.current ||
      invalid ||
      !selected.length ||
      staleCandidates ||
      imported !== null
    )
      return;
    lock.current = true;
    setSaving(true);
    setErrors((value) => ({ ...value, knowledge: "" }));
    try {
      const source = await p.ensureSource();
      if (!mounted.current) return;
      if (
        !source ||
        !matchesAiSource(candidateSource, propsRef.current) ||
        source.date !== candidateSource.date ||
        source.content !== candidateSource.content
      )
        throw new Error("原记录尚未保存或已经变化，请保存原文后重新提取。");
      const result = await api.importKnowledgeCards(
        selected.map(({ selected: _selected, ...item }) => ({
          ...item,
          source_article_id: source.id,
          source_date: source.date,
        })),
      );
      if (!mounted.current) return;
      setImported(result.imported);
      setSkipped(result.skipped);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: api.knowledgeQueryKeys.cardsRoot,
        }),
        queryClient.invalidateQueries({
          queryKey: api.knowledgeQueryKeys.tags,
        }),
        queryClient.invalidateQueries({
          queryKey: api.knowledgeQueryKeys.projects,
        }),
      ]);
      toast.success(`已保存 ${result.imported} 个知识草稿`);
    } catch (error) {
      if (mounted.current)
        setErrors((value) => ({
          ...value,
          knowledge: api.getErrorMessage(error),
        }));
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const editCandidate = (patch: Partial<Candidate>) =>
    !saving &&
    setCandidates((items) =>
      items.map((item, index) =>
        index === active ? { ...item, ...patch } : item,
      ),
    );
  const item = candidates[active];
  const mode = p.mode || "summary";
  const movement = useDialogWindowMovement(mode === "summary" ? "AI 总结" : "知识提取", p.mode !== null);
  const copy = async () => {
    try {
      await copyText(summary);
      toast.success("已复制总结");
    } catch {
      toast.error("复制失败，请选择文字后手动复制");
    }
  };
  return (
    <Dialog.Root
      open={p.mode !== null}
      onOpenChange={(open) => {
        if (!open && !saving) p.onMode(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-[70]" />
        <Dialog.Content
          ref={movement.dialogRef}
          style={movement.dialogStyle}
          data-window-movable={movement.canMove || undefined}
          className="ft-ai-dialog dialog-window"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            p.returnFocusRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <header className="dialog-drag-handle" {...movement.handleProps}>
            <div>
              <Dialog.Title ref={titleRef} tabIndex={-1}>
                {mode === "summary" ? "AI 总结" : "知识提取"}
              </Dialog.Title>
              <Dialog.Description>
                {p.date}
                {p.title ? ` · ${p.title}` : ""}
              </Dialog.Description>
            </div>
            <div className="dialog-window-actions">
              {movement.canMove && <DialogPositionMenu onMove={movement.moveBy} onCenter={movement.center} />}
              <Dialog.Close asChild>
                <button
                  className="shell-icon"
                  disabled={saving}
                  aria-label="关闭 AI 结果"
                >
                  <X size={19} />
                </button>
              </Dialog.Close>
            </div>
          </header>
          <Tabs
            value={mode}
            onValueChange={(value) => {
              if (!saving) p.onMode(value as Mode);
            }}
            className="ft-tabs ft-ai-tabs"
          >
            <TabsList aria-label="AI 工作流">
              <TabsTrigger value="summary" disabled={saving}>
                <Sparkles size={15} />
                总结
              </TabsTrigger>
              <TabsTrigger value="knowledge" disabled={saving}>
                <BookMarked size={15} />
                提取知识
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ft-ai-body">
            {errors[mode] && (
              <div className="ui-alert-bad" role="alert">
                {errors[mode]}
              </div>
            )}
            {(mode === "summary" ? staleSummary : staleCandidates) && (
              <div className="ui-alert-warn" role="status">
                原文已变化，下方是旧版本结果。请重新生成后使用。
              </div>
            )}
            {running === mode ? (
              <div className="ft-ai-loading" role="status">
                <LoaderCircle size={28} className="animate-spin" />
                <h2>{mode === "summary" ? "正在整理总结" : "正在提炼知识"}</h2>
                <p>结果不会覆盖原记录</p>
                <div className="ui-skeleton h-3 w-4/5" />
                <div className="ui-skeleton h-3 w-3/5" />
              </div>
            ) : mode === "summary" ? (
              summary ? (
                <article className="ft-ai-summary">
                  <MarkdownContent content={summary} />
                </article>
              ) : (
                <div className="ft-ai-start">
                  <Sparkles size={29} strokeWidth={1.5} />
                  <h2>整理重点与下一步</h2>
                  <p>使用当前记录生成总结，不改写正文。</p>
                  <details>
                    <summary>
                      查看原文
                      <ChevronDown size={14} />
                    </summary>
                    <pre>{p.content || "当前记录还没有正文"}</pre>
                  </details>
                  <button
                    className="ui-button-primary"
                    disabled={!p.content.trim() || !!running}
                    onClick={() => void generate("summary")}
                  >
                    <Sparkles size={16} />
                    生成总结
                  </button>
                </div>
              )
            ) : imported !== null ? (
              <div className="ft-ai-complete" role="status">
                <CheckCircle2 size={35} />
                <h2>
                  {imported ? `已保存 ${imported} 个知识草稿` : "没有新增草稿"}
                </h2>
                {skipped > 0 && <p>跳过 {skipped} 个重复条目</p>}
                <p>到知识库确认后，可为条目创建复习题。</p>
                <button className="ui-button-primary" onClick={p.onKnowledge}>
                  打开知识库
                  <ArrowRight size={15} />
                </button>
              </div>
            ) : candidateSource.date ? (
              candidates.length > 0 ? (
                <>
                  <div className="ft-ai-candidate-top">
                    <span>
                      {candidates.length} 个候选 · 已选 {selected.length}
                    </span>
                    <button
                      className="ui-button-ghost"
                      disabled={saving}
                      onClick={() =>
                        setCandidates((items) =>
                          items.map((item) => ({
                            ...item,
                            selected: selected.length !== candidates.length,
                          })),
                        )
                      }
                    >
                      {selected.length === candidates.length
                        ? "取消全选"
                        : "全选"}
                    </button>
                  </div>
                  <div className="ft-ai-candidates">
                    <nav aria-label="候选知识">
                      {candidates.map((candidate, index) => (
                        <div key={index} data-active={active === index}>
                          <label>
                            <input
                              type="checkbox"
                              disabled={saving}
                              checked={candidate.selected}
                              onChange={() =>
                                setCandidates((items) =>
                                  items.map((item, i) =>
                                    i === index
                                      ? { ...item, selected: !item.selected }
                                      : item,
                                  ),
                                )
                              }
                              aria-label={`选择候选 ${index + 1}`}
                            />
                          </label>
                          <button
                            aria-current={active === index ? "true" : undefined}
                            onClick={() => setActive(index)}
                          >
                            <span>{cardTypeLabels[candidate.card_type]}</span>
                            <strong>{candidate.title || "未填写标题"}</strong>
                          </button>
                        </div>
                      ))}
                    </nav>
                    {item && (
                      <section className="ft-ai-candidate-editor">
                        <label>
                          标题
                          <input
                            disabled={saving}
                            value={item.title}
                            className="ui-field"
                            aria-label="候选知识标题"
                            onChange={(event) =>
                              editCandidate({ title: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          正文
                          <textarea
                            disabled={saving}
                            value={item.content}
                            className="ui-textarea"
                            aria-label="候选知识正文"
                            onChange={(event) =>
                              editCandidate({ content: event.target.value })
                            }
                          />
                        </label>
                        <details open>
                          <summary>
                            原文依据
                            <ChevronDown size={14} />
                          </summary>
                          <textarea
                            disabled={saving}
                            className="ui-textarea"
                            value={item.source_excerpt}
                            aria-label="候选知识原文依据"
                            onChange={(event) =>
                              editCandidate({
                                source_excerpt: event.target.value,
                              })
                            }
                          />
                        </details>
                        {item.tags.length > 0 && (
                          <div className="ft-ai-tags">
                            {item.tags.map((tag) => (
                              <span key={tag}>#{tag}</span>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                  {invalid && (
                    <p className="ui-alert-warn" role="alert">
                      已选条目需要完整标题与正文。
                    </p>
                  )}
                </>
              ) : (
                <div className="ft-ai-start">
                  <BookMarked size={29} />
                  <h2>没有提取到候选知识</h2>
                  <p>补充原文上下文后再试。</p>
                </div>
              )
            ) : (
              <div className="ft-ai-start">
                <BookMarked size={29} strokeWidth={1.5} />
                <h2>留下值得复用的知识</h2>
                <p>从原文提取，先核对，再保存。无需先生成总结。</p>
                <details>
                  <summary>
                    查看原文
                    <ChevronDown size={14} />
                  </summary>
                  <pre>{p.content || "当前记录还没有正文"}</pre>
                </details>
                <button
                  className="ui-button-primary"
                  disabled={!p.content.trim() || !!running}
                  onClick={() => void generate("knowledge")}
                >
                  <Sparkles size={16} />
                  提取预览
                </button>
              </div>
            )}
          </div>
          <footer>
            <span>
              {mode === "summary"
                ? "当前页面保留结果，不改写记录"
                : "仅在确认保存后写入知识草稿"}
            </span>
            <div>
              {mode === "summary" && summary && (
                <button className="ui-button-secondary" onClick={copy}>
                  <Copy size={14} />
                  复制总结
                </button>
              )}
              {((mode === "summary" && summary) ||
                (mode === "knowledge" && candidateSource.date)) && (
                <button
                  className="ui-button-secondary"
                  disabled={!!running || saving || !p.content.trim()}
                  onClick={() => void generate(mode)}
                >
                  <RefreshCw size={14} />
                  重新{mode === "summary" ? "生成" : "提取"}
                </button>
              )}
              {mode === "knowledge" &&
                selected.length > 0 &&
                imported === null && (
                  <button
                    className="ui-button-primary"
                    disabled={!!running || saving || invalid || staleCandidates}
                    onClick={() => void commit()}
                  >
                    {saving ? (
                      <LoaderCircle size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    {saving ? "保存中…" : `保存 ${selected.length} 个草稿`}
                  </button>
                )}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
