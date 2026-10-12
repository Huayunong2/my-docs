import { Field } from "../ui/reading-surface";
import RelatedKnowledgeField from "./RelatedKnowledgeField";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, GitMerge, SkipForward, Save, ArrowLeft } from "lucide-react";
import * as api from "../../lib/api";
import MarkdownContent from "../MarkdownContent";
import { cardTypeLabels } from "../../lib/cardLabels";
import "./organize.css";
type Candidate = api.KnowledgeCardImportInput;
export interface OrganizerDraft {
    target: api.KnowledgeCard | null;
    related: string[];
    mergeRelated: string[];
    merged: string;
    mergeTags: string;
    mergeSpaces: string;
    tagsText: string;
    spacesText: string;
    conflict: boolean;
    notice: string;
    error: string;
}
interface Props {
    sessionDraft?: OrganizerDraft;
    onSessionDraftChange?: (draft: OrganizerDraft) => void;
    candidate: Candidate;
    onChange: (patch: Partial<Candidate>) => void;
    onProcessed: () => void;
    onSkip?: () => void;
    disabled?: boolean;
    source?: () => Promise<Partial<Candidate>>;
    sourceJobId?: string;
    sourceName?: string;
    candidateKey?: string;
    existing?: api.KnowledgeCard;
    onUpdated?: (card: api.KnowledgeCard) => void;
}
export default function CandidateOrganizer(p: Props) {
    const [similar, setSimilar] = useState<{
        card: api.KnowledgeCard;
        reason: string;
    }[]>([]);
    const [target, setTarget] = useState<api.KnowledgeCard | null>(p.sessionDraft?.target ?? p.existing ?? null);
    const [related,setRelated]=useState(p.sessionDraft?.related ?? p.existing?.declared_related_ids ?? p.candidate.related_ids ?? []);
    const [mergeRelated,setMergeRelated]=useState<string[]>(p.sessionDraft?.mergeRelated || []);
    const [merged, setMerged] = useState(p.sessionDraft?.merged || "");
    const [mergeTags, setMergeTags] = useState(p.sessionDraft?.mergeTags || "");
    const [mergeSpaces, setMergeSpaces] = useState(p.sessionDraft?.mergeSpaces || "");
    const [tagsText, setTagsText] = useState(p.sessionDraft?.tagsText ?? (p.candidate.tags || []).join(", "));
    const [spacesText, setSpacesText] = useState(p.sessionDraft?.spacesText ?? (p.candidate.projects || []).join(", "));
    const [conflict, setConflict] = useState(p.sessionDraft?.conflict || false);
    const [notice, setNotice] = useState(p.sessionDraft?.notice || "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(p.sessionDraft?.error || "");
    const [checking, setChecking] = useState(false);
    const request = useRef({ signature: "", id: "" });
    const lock = useRef(false);
    const client = useQueryClient();
    const draftChanged = useRef(p.onSessionDraftChange);
    draftChanged.current = p.onSessionDraftChange;
    useEffect(() => {
        draftChanged.current?.({ target, related, mergeRelated, merged, mergeTags, mergeSpaces, tagsText, spacesText, conflict, notice, error });
    }, [target, related, mergeRelated, merged, mergeTags, mergeSpaces, tagsText, spacesText, conflict, notice, error]);
    useEffect(() => { const abort = new AbortController(); setSimilar([]); setChecking(false); if (p.existing || !p.candidate.title.trim() || !p.candidate.content.trim())
        return; const timer = setTimeout(() => { setChecking(true); api.similarKnowledge(p.candidate, abort.signal).then(setSimilar).catch(e => { if (!abort.signal.aborted)
        setError(api.getErrorMessage(e)); }).finally(() => { if (!abort.signal.aborted)
        setChecking(false); }); }, 500); return () => { clearTimeout(timer); abort.abort(); }; }, [p.candidate.title, p.candidate.content, p.existing]);
    const save = async (status: "draft" | "confirmed") => {
        if (lock.current)
            return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            const source = await p.source?.();
            const card = { ...p.candidate, tags: tagsText.split(/[,，]/).map(t => t.trim()).filter(Boolean), projects: spacesText.split(/[,，]/).map(t => t.trim()).filter(Boolean), ...source, status };
            let sources: api.KnowledgeSource[] = [];
            if (target) {
                sources = await api.getKnowledgeSources(target.id);
            }
            if (target && !p.existing) {
                card.title = target.title;
                card.content = merged;
                card.tags = mergeTags.split(/[,，]/).map(t => t.trim()).filter(Boolean);
                card.projects = mergeSpaces.split(/[,，]/).map(t => t.trim()).filter(Boolean);
            }
            const incoming = { article_id: card.source_article_id || "", review_id: card.source_review_id || "", date: card.source_date || "", excerpt: card.source_excerpt || "" };
            if (incoming.excerpt)
                sources.push(incoming);
            if (target && !p.existing && target.source_excerpt) {
                card.source_article_id = target.source_article_id;
                card.source_review_id = target.source_review_id;
                card.source_date = target.source_date;
                card.source_excerpt = target.source_excerpt;
            }
            const payload = { card: { ...card, related_ids: target && !p.existing ? mergeRelated : related }, sources, source_job_id: p.sourceJobId, target_id: target?.id, expected_updated_at: target?.updated_at };
            const signature = JSON.stringify(payload);
            if (request.current.signature !== signature) {
                const id=await api.knowledgeCandidateRequestId(p.candidateKey?`${p.candidateKey}:${status}:${target?.id||"new"}`:undefined);
                request.current = { signature, id };
            }
            const saved = await api.organizeKnowledge({ ...payload, request_id: request.current.id });
            p.onUpdated?.(saved);
            await Promise.all([client.invalidateQueries({ queryKey: api.knowledgeQueryKeys.cardsRoot }), client.invalidateQueries({ queryKey: api.knowledgeQueryKeys.tags }), client.invalidateQueries({ queryKey: api.knowledgeQueryKeys.projects })]);
            p.onProcessed();
        }
        catch (e) {
            setError(api.getErrorMessage(e));
            if (e instanceof api.ApiError && e.status === 409 && target) setConflict(true);
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    };
    const refreshTarget = async () => {
        if (!target || busy) return;
        setBusy(true);
        try {
            const latest = await api.getKnowledgeCard(target.id);
            setTarget(latest);
            setConflict(false);
            setError("");
            setNotice("已读取最新版本。你的编辑内容已保留，请对照后再次确认。");
        } catch (e) { setError(api.getErrorMessage(e)); }
        finally { setBusy(false); }
    };
    const blocked = conflict || busy || p.disabled || !p.candidate.title.trim() || !p.candidate.content.trim() || (!!target && !p.existing && !merged.trim());
    return <section className="ko-editor" aria-label="整理候选知识">
    <div className="ko-heading"><span>{p.sourceName || "核对内容与来源"}</span><small>{checking ? "检查相似条目…" : `${similar.length} 个相似条目`}</small></div>
    <Field label="标题" value={p.candidate.title} disabled={busy} onChange={e => p.onChange({ title: e.target.value })}/>
    <div className="ko-fields"><label>类型<select className="ui-field" value={p.candidate.card_type} onChange={e => p.onChange({ card_type: e.target.value as api.KnowledgeCardType })}>{Object.entries(cardTypeLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>标签<input className="ui-field" value={tagsText} onChange={e => { setTagsText(e.target.value); p.onChange({ tags: e.target.value.split(/[,，]/).map(t => t.trim()).filter(Boolean) }); }}/></label></div>
    <label>空间<input className="ui-field" value={spacesText} onChange={e => { setSpacesText(e.target.value); p.onChange({ projects: e.target.value.split(/[,，]/).map(t => t.trim()).filter(Boolean) }); }}/></label>
    {(!target||p.existing)&&<RelatedKnowledgeField ids={related} onChange={setRelated} exclude={target?.id}/>}
        <label>来源日期（可选）<input className="ui-field" type="date" value={p.candidate.source_date||""} onChange={e=>p.onChange({source_date:e.target.value})}/></label>
        <div className="ko-evidence-grid"><label>正文<textarea aria-label="正文" className="ui-textarea" value={p.candidate.content} disabled={busy} onChange={e => p.onChange({ content: e.target.value })}/></label><details open><summary>来源依据</summary><textarea aria-label="来源依据" className="ui-textarea" value={p.candidate.source_excerpt || ""} disabled={busy} onChange={e => p.onChange({ source_excerpt: e.target.value })}/><small>来源可选；附上来源时，应能定位并支撑正文。</small></details></div>
    {!target && similar.length > 0 && <section className="ko-similar"><h3>可能已有相关知识</h3>{similar.map(({ card, reason }) => <button className="ko-match" key={card.id} onClick={() => { setTarget(card);setMergeRelated([...new Set([...(card.declared_related_ids||[]),...related])]); setMerged(card.content); setMergeTags([...new Set([...card.tags, ...(p.candidate.tags || [])])].join(", ")); setMergeSpaces([...new Set([...(card.projects || []), ...(p.candidate.projects || [])])].join(", ")); }}><span><strong>{card.title}</strong><small>{reason}</small></span><GitMerge size={16}/></button>)}</section>}
    {target && !p.existing && <section className="ko-merge"><button className="ui-button-ghost" onClick={() => { setTarget(null); setConflict(false); setNotice(""); setError(""); }}><ArrowLeft size={14}/>取消合并</button><h3>合并到：{target.title}</h3><div className="ko-evidence-grid"><div><small>已有正文</small><MarkdownContent content={target.content}/></div><div><small>候选正文</small><MarkdownContent content={p.candidate.content}/></div></div><label>最终正文<textarea aria-label="最终正文" className="ui-textarea" value={merged} onChange={e => setMerged(e.target.value)}/></label><div className="ko-fields"><label>合并标签<input className="ui-field" value={mergeTags} onChange={e => setMergeTags(e.target.value)}/></label><label>合并空间<input className="ui-field" value={mergeSpaces} onChange={e => setMergeSpaces(e.target.value)}/></label></div><RelatedKnowledgeField ids={mergeRelated} onChange={setMergeRelated} exclude={target.id}/><p>保留目标的来源与记忆进度；正文变化后，相关复习题需要重新核对。</p></section>}
    {notice && <p className="ko-muted" role="status">{notice}</p>}
    {notice && p.existing && target && <details><summary>对照最新正文</summary><MarkdownContent content={target.content}/></details>}
    {conflict && <button className="ui-button-secondary" disabled={busy} onClick={() => void refreshTarget()}>读取最新版本并重新对照</button>}
    {error && <p className="ui-alert-warn" role="alert">{error}</p>}
    <div className="ko-actions"><button className="ui-button-primary" disabled={blocked} onClick={() => void save("confirmed")}><Check size={15}/>{busy ? "保存中…" : target && !p.existing ? "确认合并" : "确认入库"}</button>{!target && <button className="ui-button-secondary" disabled={blocked} onClick={() => void save("draft")}><Save size={15}/>保存草稿</button>}{p.onSkip && <button className="ui-button-ghost" disabled={busy} onClick={p.onSkip}><SkipForward size={15}/>跳过</button>}</div>
  </section>;
}
