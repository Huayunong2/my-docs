import { newClientId } from "../lib/clientId";
import { Input, Textarea } from "./ui/reading-surface";
import { SelectField, SelectItem } from "./ui/select";
import { Radio, Checkbox } from "./ui/checkbox";
import { createPortal } from "react-dom";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BriefcaseBusiness, CalendarDays, Check, Cloud, Copy, Download, GraduationCap, Link2, MapPin, Pencil, Plus, Printer, RotateCcw, Search, Sparkles, Target, Trash2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import * as api from "../lib/api";
import { copyText } from "../lib/clipboard";
import { normalizeTags, parseTags } from "../lib/tags";
import { useWideLayout } from "../lib/useWideLayout";
import { useMobileLayout } from "../lib/useMobileLayout";
import { useReadingScroll } from "../lib/useReadingScroll";
import { Button, IconButton } from "./ui/button";
import { Field } from "./ui/reading-surface";
import { EmptyState, InlineError, useConfirmDialog } from "./ui/Feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import WorkspaceHeader from "./workspace/WorkspaceHeader";
import ResponsiveSplit from "./workspace/ResponsiveSplit";
import ReadingActions from "./workspace/ReadingActions";
import { ProfileModal, ProfileTextarea, SourcePicker } from "./profile/ProfileEditors";
import { currentPersonalEntries, emptyPersonalProfile, experiencePeriod, mergePersonalDraft, newPersonalEntry, newPersonalGoal, parseResumeImport, personalArchiveText, personalSourceHref, profileDateBounds, profileKinds, purposeLabels, recommendedBackgroundIds, resumeData, safeProfileUrl, selectedBackgroundExperiences, statusChoices, statusLabel, validatePersonalEntry, type BackgroundPurpose, type PersonalEntry, type PersonalGoal, type PersonalProfile, type PersonalSnapshot, type ProfileKind, type ProfileView } from "../lib/personalProfile";
import "./personal-profile.css";
const MarkdownContent=lazy(()=>import("./MarkdownContent"));
type EditorState = {type:"profile";draft:PersonalProfile;base:PersonalProfile;revision:number} | {type:"entry";draft:PersonalEntry;base:PersonalEntry;revision:number} | {type:"goal";draft:PersonalGoal;base:PersonalGoal;revision:number};
type Conflict = {remote:PersonalSnapshot};
type Props={tab:ProfileView;entryId?:string;kind?:string;query?:string;onTabChange:(view:ProfileView)=>void;onSelect:(id?:string)=>void;onFilter:(kind:string,q:string)=>void};
const goalLabels={active:"进行中",paused:"暂停",completed:"已完成",cancelled:"已取消"};
const viewLabels:Record<ProfileView,string>={overview:"概览",timeline:"经历与成果",goals:"目标",context:"背景说明",analyses:"分析"};
const fieldLabels:Record<string,string>={name:"称呼",direction:"关注方向",city:"城市",bio:"简介",goal:"当前愿望",preference:"偏好",email:"邮箱",phone:"电话",website:"网站",skills:"技能自述",title:"标题",kind:"类型",organization:"组织",start:"开始时间",end:"结束时间",status:"状态",degree:"学历 / 学位",major:"专业",position:"岗位",role:"角色",focus:"学习方向",description:"说明",result:"成果",sourceNote:"依据说明",sourceUrl:"来源链接",sources:"关联来源",parentId:"归属经历",tags:"标签",aiAllowed:"背景使用许可",targetDate:"目标日期",nextStep:"下一步",spaceId:"关联空间",removed:"移除状态"};
function downloadText(text:string,name:string,type:string){
  const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function ResumeDocument({profile,entries,contacts}:{profile:PersonalProfile;entries:PersonalEntry[];contacts:boolean}){
  const actual=entries.filter(e=>!e.removed&&e.status!=="planned");
  return <article className="pf-resume-document"><header><h1>{profile.name||"个人简历"}</h1><p>{profile.direction}</p>{contacts&&<p>{[profile.email,profile.phone,profile.city,profile.website].filter(Boolean).join(" · ")}</p>}</header>{profile.bio&&<section><h2>个人介绍</h2><p>{profile.bio}</p></section>}{Object.entries(profileKinds).map(([kind,label])=>{
    const rows=actual.filter(e=>e.kind===kind);return rows.length>0&&<section key={kind}><h2>{label}</h2>{rows.map(entry=><div key={entry.id}><h3>{entry.title}<small>{experiencePeriod(entry)}</small></h3><p>{[entry.organization,entry.degree,entry.major,entry.position,entry.role,entry.focus].filter(Boolean).join(" · ")}</p><p>{entry.description}</p>{entry.result&&<p>{entry.result}</p>}</div>)}</section>;
  })}{profile.skills.length>0&&<section><h2>技能自述</h2><p>{profile.skills.join(" · ")}</p></section>}</article>;
}
export default function ProfilePage({tab,entryId,kind="all",query="",onTabChange,onSelect,onFilter}:Props){
  const server=api.getServerUrl();const client=useQueryClient();const key=api.personalProfileQueryKey();
  const mobile=useMobileLayout();const analysisMainTop=useRef(0);
  const {confirm,dialog}=useConfirmDialog();const editServer=useRef(server);
  const dataQuery=useQuery({queryKey:key,queryFn:({signal})=>api.getPersonalProfile({signal}),staleTime:15000});
  const data=dataQuery.data;
  const [edit,setEdit]=useState<EditorState|null>(null);
  const [tagText,setTagText]=useState("");const [skillsText,setSkillsText]=useState("");
  const [error,setError]=useState("");const [conflict,setConflict]=useState<Conflict|null>(null);const [conflictChoices,setConflictChoices]=useState<Record<string,"local"|"remote">>({});
  const [purpose,setPurpose]=useState<BackgroundPurpose>("general");
  const [selectedIds,setSelectedIds]=useState<string[]|null>(null);const [goalIds,setGoalIds]=useState<string[]>([]);
  const [includeProfile,setIncludeProfile]=useState(true);
  const [panel,setPanel]=useState<"export"|"trash"|null>(null);
  const [exportScope,setExportScope]=useState<"selected"|"whole">("selected");const [exportFormat,setExportFormat]=useState<"markdown"|"resume"|"print">("markdown");const [contacts,setContacts]=useState(false);
  const [resumeIds,setResumeIds]=useState<string[]|null>(null);const [exportIntro,setExportIntro]=useState(true);
  const [importDraft,setImportDraft]=useState<(ReturnType<typeof parseResumeImport>&{revision:number;selected:string[]})|null>(null);
  const [importAllowed,setImportAllowed]=useState(false);const [confirmedOwner,setConfirmedOwner]=useState(false);
  const [question,setQuestion]=useState("");const [reportId,setReportId]=useState<string|null>(null);const [analysisPage,setAnalysisPage]=useState(1);
  const origin=useRef<HTMLElement|null>(null);const fileInput=useRef<HTMLInputElement|null>(null);const listMainTop=useRef(0);
  const wide=useWideLayout();const listScroll=useReadingScroll(kind+":"+query,"personal-profile-list:"+server);
  const now=new Date();const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
  const dirty=!!edit&&(JSON.stringify(edit.draft)!==JSON.stringify(edit.base)||(edit.type==="entry"&&tagText!==edit.base.tags.join("，"))||(edit.type==="profile"&&skillsText!==edit.base.skills.join("，")));
  const blocker=useBlocker({shouldBlockFn:({current,next})=>dirty&&current.pathname!==next.pathname,enableBeforeUnload:dirty,withResolver:true});
  const saved=(snapshot:PersonalSnapshot)=>{client.setQueryData(key,snapshot);setError("");setConflict(null);};
  const writes=useMutation({mutationFn:async(fn:()=>Promise<PersonalSnapshot>)=>{if(server!==api.getServerUrl())throw new api.ApiError(0,"服务器连接已改变，请重新打开个人档案。");return fn();},onSuccess:saved,retry:false});
  const active=data?.entries.filter(e=>!e.removed)||[];
  const goals=data?.goals.filter(g=>!g.removed)||[];
  const chosenIds=selectedIds??recommendedBackgroundIds(active,purpose);
  const selected=selectedBackgroundExperiences(active,chosenIds);
  const selectedGoals=goals.filter(g=>g.aiAllowed&&goalIds.includes(g.id));
  const hasProfile=!!data&&(!!data.profile.name||!!data.profile.bio||!!data.profile.direction||!!data.profile.skills.length||purpose!=="resume"&&(!!data.profile.goal||!!data.profile.preference));
  const hasContext=includeProfile&&hasProfile||selected.length>0||selectedGoals.length>0;
  const contextRequest=useMemo(()=>({expectedRevision:data?.revision??0,purpose,includeProfile,entryIds:selected.map(e=>e.id),goalIds:selectedGoals.map(g=>g.id)}),[data?.revision,purpose,includeProfile,selected.map(e=>e.id).join(","),selectedGoals.map(g=>g.id).join(",")]);
  const contextQuery=useQuery({queryKey:["personalContext",server,contextRequest],queryFn:({signal})=>api.buildPersonalContext(contextRequest,{signal}),enabled:!!data&&hasContext&&(tab==="context"||panel==="export"&&exportFormat==="markdown"&&exportScope==="selected"),retry:false,staleTime:0});
  const analysisListQuery=useQuery({queryKey:["personalAnalysisList",server,analysisPage],queryFn:({signal})=>api.listPersonalAnalyses(analysisPage,{signal}),enabled:tab==="analyses",staleTime:15000});
  const reportQuery=useQuery({queryKey:["personalAnalysis",server,reportId],queryFn:({signal})=>api.getPersonalAnalysis(reportId!,{signal}),enabled:!!reportId,refetchInterval:q=>q.state.data?.status==="running"?1500:false});
  const analysis=useMutation({mutationFn:()=>api.analyzePersonalProfile(newClientId(),question.trim(),contextRequest,contextQuery.data!.fingerprint),onSuccess:result=>{
    client.setQueryData(["personalAnalysis",server,result.id],result);setReportId(result.id);void dataQuery.refetch();void client.invalidateQueries({queryKey:["personalAnalysisList",server]});setAnalysisPage(1);onTabChange("analyses");
  },onError:e=>void handleError(e),retry:false});
  useEffect(()=>{if(panel==="export"&&exportFormat==="print"){document.body.dataset.profilePrint="true";return()=>{delete document.body.dataset.profilePrint;};}},[panel,exportFormat]);
  const handleError=async(e:unknown)=>{
    setError(api.getErrorMessage(e));
    if(e instanceof api.ApiError&&e.status===409){const fresh=await dataQuery.refetch();if(fresh.data){if(edit)setConflict({remote:fresh.data});else await client.invalidateQueries({queryKey:["personalContext",server]});}}
  };
  const begin=(state:EditorState,button:HTMLElement|null)=>{origin.current=button;editServer.current=server;setEdit(state);setError("");setConflict(null);setConflictChoices({});if(state.type==="entry")setTagText(state.draft.tags.join("，"));if(state.type==="profile")setSkillsText(state.draft.skills.join("，"));};
  const newEntry=(type:ProfileKind,button:HTMLElement,parentId="")=>{if(!data)return;const draft={...newPersonalEntry(type),id:newClientId(),parentId};begin({type:"entry",draft,base:structuredClone(draft),revision:data.revision},button);};
  const editEntry=(entry:PersonalEntry,button:HTMLElement|null)=>{if(data)begin({type:"entry",draft:structuredClone(entry),base:structuredClone(entry),revision:data.revision},button);};
  const patchEntry=(patch:Partial<PersonalEntry>)=>setEdit(value=>value?.type==="entry"?{...value,draft:{...value.draft,...patch}}:value);
  const patchProfile=(patch:Partial<PersonalProfile>)=>setEdit(value=>value?.type==="profile"?{...value,draft:{...value.draft,...patch}}:value);
  const patchGoal=(patch:Partial<PersonalGoal>)=>setEdit(value=>value?.type==="goal"?{...value,draft:{...value.draft,...patch}}:value);
  const saveEdit=async()=>{
    if(!edit||writes.isPending)return;
    if(editServer.current!==api.getServerUrl()){setError("服务器连接已改变，编辑尚未发送。请复制草稿并重新打开个人档案。");return;}
    let prepared=edit;
    if(edit.type==="entry"){
      const draft={...edit.draft,tags:normalizeTags(parseTags(tagText)),start:edit.draft.start.trim(),end:edit.draft.status==="active"?"":edit.draft.end.trim(),sourceUrl:edit.draft.sourceUrl.trim()};
      const validation=validatePersonalEntry(draft,today);if(validation){setError(validation);return;}
      prepared={...edit,draft};setEdit(prepared);
    }else if(edit.type==="profile"){prepared={...edit,draft:{...edit.draft,skills:normalizeTags(parseTags(skillsText))}};setEdit(prepared);}
    try{
      await writes.mutateAsync(()=>prepared.type==="profile"?api.savePersonalProfile(prepared.revision,prepared.draft):prepared.type==="entry"?api.savePersonalEntry(prepared.revision,prepared.draft):api.savePersonalGoal(prepared.revision,prepared.draft));
      setEdit(null);toast.success("已保存到服务器");
    }catch(e){await handleError(e);}
  };
  const remove=async(id:string,goal:boolean,removed:boolean)=>{
    if(!data||writes.isPending)return;
    if(removed&&!await confirm({title:"移入个人档案回收站",message:"将移除“"+(goal?data.goals.find(g=>g.id===id)?.title:data.entries.find(e=>e.id===id)?.title)+"”。已保存资料可恢复；当前未保存的修改不会写入。",confirmText:"移入回收站",danger:true}))return;
    try{await writes.mutateAsync(()=>api.setPersonalRemoved(data.revision,id,goal,removed));if(removed){setSelectedIds(chosenIds.filter(value=>value!==id));setGoalIds(ids=>ids.filter(value=>value!==id));setEdit(null);if(!goal)onSelect();toast.success("已移入回收站，可随时恢复");}else toast.success("已恢复，请重新选择背景范围");}
    catch(e){await handleError(e);}
  };
  const closeEdit=()=>{setEdit(null);setError("");setConflict(null);};
  const entryDraft=edit?.type==="entry"?edit.draft:null;const profileDraft=edit?.type==="profile"?edit.draft:null;const goalDraft=edit?.type==="goal"?edit.draft:null;
  const remoteDraft=edit&&conflict?(edit.type==="profile"?conflict.remote.profile:edit.type==="entry"?conflict.remote.entries.find(e=>e.id===edit.draft.id):conflict.remote.goals.find(g=>g.id===edit.draft.id)):undefined;
  const merged=edit&&remoteDraft?mergePersonalDraft(edit.base as unknown as Record<string,unknown>,edit.draft as unknown as Record<string,unknown>,remoteDraft as unknown as Record<string,unknown>):undefined;
  const rebase=()=>{
    if(!edit||!conflict||!remoteDraft||!merged)return;
    const draft={...merged.draft} as Record<string,unknown>;const local=edit.draft as unknown as Record<string,unknown>;
    for(const field of merged.conflicts){if(conflictChoices[String(field)]==="local")draft[String(field)]=local[String(field)];}
    const next={...edit,base:structuredClone(remoteDraft),draft,revision:conflict.remote.revision} as unknown as EditorState;
    setEdit(next);if(next.type==="profile")setSkillsText(next.draft.skills.join("，"));if(next.type==="entry")setTagText(next.draft.tags.join("，"));setConflict(null);setError("");toast("已完成对比，请确认后保存");
  };
  const fieldValue=(record:object,key:string)=>{
    const value=(record as Record<string,unknown>)[key];
    if(key==="kind")return profileKinds[value as ProfileKind]||String(value);
    if(key==="status")return "kind" in record?statusLabel(record as PersonalEntry):goalLabels[value as PersonalGoal["status"]];
    if(key==="parentId")return data?.entries.find(e=>e.id===value)?.title||"未关联";
    if(key==="spaceId")return (record as PersonalGoal).spaceTitle||"未关联";
    if(typeof value==="boolean")return value?"是":"否";
    if(Array.isArray(value))return value.map(v=>typeof v==="string"?v:v?.title||"关联资料").join("、")||"未填写";
    return String(value||"未填写");
  };
  const conflictPanel=conflict&&edit?<div className="pf-conflict" role="alert"><h3>服务器已有更新，当前编辑已保留</h3>{!remoteDraft||"removed" in remoteDraft&&remoteDraft.removed?<p>该条目已移除或被迁移替换。请关闭编辑后检查回收站；可以先复制草稿内容。</p>:<>
    <p>未在本地修改的字段会采用服务器值；同时被修改的字段请逐项选择。</p>{merged?.conflicts.map(field=><fieldset key={String(field)}><legend>{fieldLabels[String(field)]||String(field)}</legend><label><Radio type="radio" name={"conflict-"+String(field)} checked={conflictChoices[String(field)]!=="local"} onChange={()=>setConflictChoices(value=>({...value,[field]:"remote"}))}/>服务器：{fieldValue(remoteDraft,String(field))}</label><label><Radio type="radio" name={"conflict-"+String(field)} checked={conflictChoices[String(field)]==="local"} onChange={()=>setConflictChoices(value=>({...value,[field]:"local"}))}/>我的编辑：{fieldValue(edit.draft,String(field))}</label></fieldset>)}<Button onClick={rebase}>采用以上选择继续编辑</Button></>}</div>:null;
  const importFile=async(file:File)=>{
    if(!data)return;setError("");try{if(file.size>1024*1024)throw new Error("简历 JSON 不能超过 1 MiB。");const parsed=parseResumeImport(JSON.parse(await file.text()));setImportDraft({...parsed,revision:data.revision,selected:parsed.entries.map(e=>e.id)});setImportAllowed(false);setConfirmedOwner(false);}
    catch(e){setError(api.getErrorMessage(e));}finally{if(fileInput.current)fileInput.current.value="";}
  };
  const importMutation=useMutation({mutationFn:()=>api.importPersonalResume(importDraft!.revision,importDraft!.profile,importDraft!.entries.filter(e=>importDraft!.selected.includes(e.id)).map(e=>({...e,aiAllowed:importAllowed})),confirmedOwner),onSuccess:result=>{
    saved(result.snapshot);setImportDraft(null);toast.success("已导入 "+result.imported+" 条经历，跳过 "+result.skipped+" 条完全重复内容");
  },onError:e=>{setError(api.getErrorMessage(e));if(e instanceof api.ApiError&&e.status===409)void dataQuery.refetch();},retry:false});
  const changePurpose=(value:BackgroundPurpose)=>{setPurpose(value);setSelectedIds(recommendedBackgroundIds(active,value));setGoalIds(value==="learning"?goals.filter(g=>g.aiAllowed&&g.status==="active").map(g=>g.id):[]);setError("");};
  const list=active.filter(e=>(kind==="all"||e.kind===kind)&&[e.title,e.organization,e.description,e.result,...e.tags].join(" ").toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>b.start.localeCompare(a.start)||b.updatedAt.localeCompare(a.updatedAt));
  const selectedEntry=entryId?data?.entries.find(e=>e.id===entryId):wide?list[0]:undefined;
  const chooseEntry=(id?:string)=>{
    if(id){listMainTop.current=document.getElementById("main-content")?.scrollTop||0;listScroll.rememberSelection(id);}
    onSelect(id);if(!wide)requestAnimationFrame(()=>document.getElementById("main-content")?.scrollTo({top:id?0:listMainTop.current}));
  };
  const selectReport=(id:string|null)=>{
    const main=document.getElementById("main-content");
    if(id)analysisMainTop.current=main?.scrollTop||0;
    setReportId(id);
    requestAnimationFrame(()=>{
      if(mobile)main?.scrollTo({top:id?0:analysisMainTop.current});
      else if(!wide&&id)document.querySelector(".pf-analysis-reader")?.scrollIntoView({block:"nearest"});
    });
  };
  const report=reportQuery.data;
  if(dataQuery.isPending)return <div className="pf-page"><WorkspaceHeader icon={UserRound} title="个人档案"/><div className="pf-loading" role="status">正在读取服务器档案…</div></div>;
  if(!data)return <div className="pf-page"><WorkspaceHeader icon={UserRound} title="个人档案"/><InlineError message={dataQuery.error instanceof api.ApiError&&dataQuery.error.status===404?"当前服务器尚未提供个人档案，请更新服务器后重试。":api.getErrorMessage(dataQuery.error)} onRetry={()=>void dataQuery.refetch()}/></div>;
  const {profile}=data;const current=currentPersonalEntries(active,today);
  const education=active.filter(e=>e.kind==="education"&&e.status==="completed");
  const isNew=active.length===0&&goals.length===0&&!Object.values(profile).some(value=>Array.isArray(value)?value.length:!!value);
  const analysisItems=analysisListQuery.data?.items||data.analyses;
  const analysisTotal=analysisListQuery.data?.total??data.analyses.length;
  const cvIds=resumeIds??active.filter(e=>e.status!=="planned"&&e.kind!=="milestone").map(e=>e.id);
  const scopeEntries=exportScope==="whole"?active:exportFormat==="markdown"?selected:active.filter(e=>cvIds.includes(e.id));
  const resumeProfile=exportIntro?profile:{...emptyPersonalProfile(),email:profile.email,phone:profile.phone,website:profile.website,city:profile.city};
  const exportData=exportFormat==="resume"?JSON.stringify(resumeData(resumeProfile,scopeEntries,contacts),null,2):exportScope==="whole"?personalArchiveText(profile,active)+"\n\n## 个人目标\n"+goals.map(g=>g.title+"："+g.description+"\n下一步："+g.nextStep).join("\n\n"):contextQuery.data?.text||"";
  const canRemove=entryDraft?active.some(e=>e.id===entryDraft.id):goalDraft?goals.some(g=>g.id===goalDraft.id):false;
  const formButtons=<div className="pf-form-actions">{canRemove?<Button variant="danger" disabled={writes.isPending} onClick={()=>edit&&edit.type!=="profile"&&void remove(edit.draft.id,edit.type==="goal",true)}>移入回收站</Button>:null}<DialogCloseButton disabled={writes.isPending}/><Button type="submit" variant="primary" loading={writes.isPending} disabled={!!conflict}>保存</Button></div>;
  const entryList=<div className="pf-entry-list" ref={listScroll.attach} onScroll={listScroll.onScroll}>{list.map(entry=><button key={entry.id} type="button" className="pf-entry-row" aria-current={selectedEntry?.id===entry.id?"true":undefined} onClick={()=>chooseEntry(entry.id)}><div><span className="pf-type-label">{profileKinds[entry.kind]}</span><span className="pf-muted">{statusLabel(entry)}</span></div><strong>{entry.title}</strong><p>{entry.organization}</p><small>{experiencePeriod(entry)}</small>{entry.tags.length>0&&<div className="pf-tags">{entry.tags.slice(0,3).map(tag=><span key={tag}>{tag}</span>)}</div>}</button>)}{!list.length&&<EmptyState icon={CalendarDays} title={query?"没有匹配的经历":"从一段最近的经历开始"} description="教育、工作、学习、项目、成果和里程碑都可以记录。" action={<Button onClick={event=>newEntry(kind in profileKinds?kind as ProfileKind:"work",event.currentTarget)}><Plus size={15}/>添加经历</Button>}/>}</div>;
  const entryReader=selectedEntry?<article className="pf-entry-reader">
    <div className="pf-reader-toolbar">{!wide&&<Button size="small" onClick={()=>chooseEntry()}><ArrowLeft size={15}/>返回经历列表</Button>}<span className="pf-badge">{profileKinds[selectedEntry.kind]}</span><span className="pf-muted">{statusLabel(selectedEntry)}</span><Button size="small" disabled={writes.isPending||selectedEntry.removed} onClick={event=>editEntry(selectedEntry,event.currentTarget)}><Pencil size={14}/>编辑</Button></div>
    <h2>{selectedEntry.title}</h2><p className="pf-entry-meta">{selectedEntry.organization} · {experiencePeriod(selectedEntry)}</p>
    {selectedEntry.removed&&<><InlineError message="此条目已在回收站，恢复后可以继续编辑。"/><Button disabled={writes.isPending} onClick={()=>void remove(selectedEntry.id,false,false)}>恢复条目</Button></>}
    <dl className="pf-entry-fields">{[[selectedEntry.degree,"学历 / 学位"],[selectedEntry.major,"专业"],[selectedEntry.position,"岗位"],[selectedEntry.role,"个人角色"],[selectedEntry.focus,"学习方向"]].filter(([value])=>value).map(([value,label])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {selectedEntry.parentId&&<p className="pf-muted">归属经历：<button onClick={()=>chooseEntry(selectedEntry.parentId)}>{data.entries.find(e=>e.id===selectedEntry.parentId)?.title||"原经历不可用"}</button></p>}
    <section><h3>经历与个人贡献</h3><p>{selectedEntry.description||"尚未填写，可以先保留标题和时间。"}</p></section>
    <section className="pf-outcome"><h3>留下的成果</h3><p>{selectedEntry.result||"暂未补充成果；有依据时再填写，不需要编造数字。"}</p></section>
    <section><h3>来源与依据</h3><p>{selectedEntry.sourceNote||"本人填写，尚未补充其他依据。"}</p><ul className="pf-evidence-list">{selectedEntry.sources.map(source=><li key={source.kind+source.targetId+source.url}>{personalSourceHref(source)?<a href={personalSourceHref(source)!} target="_blank" rel="noopener noreferrer"><Link2 size={14}/>{source.title||"外部资料"}</a>:<span>{source.title||"原始来源"} · 已删除或不可用</span>}</li>)}</ul>{safeProfileUrl(selectedEntry.sourceUrl)&&<a href={safeProfileUrl(selectedEntry.sourceUrl)!} target="_blank" rel="noopener noreferrer">查看外部依据（新标签页）</a>}</section>
    {selectedEntry.tags.length>0&&<div className="pf-tags">{selectedEntry.tags.map(tag=><span key={tag}>{tag}</span>)}</div>}
    <div className="pf-reader-footer"><span>{selectedEntry.aiAllowed?"允许选入背景说明":"不选入背景说明"}</span>{!["achievement","milestone","certificate"].includes(selectedEntry.kind)&&!selectedEntry.removed&&<Button size="small" onClick={event=>newEntry("achievement",event.currentTarget,selectedEntry.id)}><Plus size={14}/>记录关联成果</Button>}</div>
    {data.entries.some(e=>!e.removed&&e.parentId===selectedEntry.id)&&<section><h3>关联成果与里程碑</h3>{data.entries.filter(e=>!e.removed&&e.parentId===selectedEntry.id).map(e=><Button key={e.id} variant="ghost" onClick={()=>chooseEntry(e.id)}>{e.title}</Button>)}</section>}
  </article>:<EmptyState icon={UserRound} title="选择一段经历" description="详情中可以查看贡献、成果和关联资料。"/>;
  return <div className="pf-page" data-profile-detail={(tab==="timeline"&&!!entryId&&!wide||tab==="analyses"&&!!reportId&&mobile)||undefined}>
    <div className="pf-page-header">
    <WorkspaceHeader icon={UserRound} title="个人档案" description="记录经历与成果，连接过去与未来。"/>
    <div className="pf-top-actions"><ReadingActions label="个人档案操作" actions={[
      {id:"edit",variant:"primary",label:"编辑概况",icon:<Pencil size={15}/>,disabled:writes.isPending,onSelect:button=>begin({type:"profile",draft:structuredClone(profile),base:structuredClone(profile),revision:data.revision},button)},
      {id:"import",label:"导入 JSON 简历",icon:<Upload size={15}/>,onSelect:button=>{origin.current=button;fileInput.current?.click();}},
      {id:"export",label:"导出资料",icon:<Download size={15}/>,onSelect:button=>{origin.current=button;setExportScope("selected");setExportFormat("markdown");setContacts(false);setResumeIds(null);setExportIntro(true);setPanel("export");}},
      {id:"trash",label:"回收站 ("+(data.entries.filter(e=>e.removed).length+data.goals.filter(g=>g.removed).length)+")",icon:<Trash2 size={15}/>,onSelect:button=>{origin.current=button;setPanel("trash");setError("");}}
    ]}><Button asChild variant="ghost"><Link to="/settings" search={{tab:"export"}}>备份与迁移</Link></Button></ReadingActions></div>
    </div>
    <div className="pf-status-bar"><span><Cloud size={14}/>{data.updatedAt?"已保存至当前服务器 · "+new Date(data.updatedAt).toLocaleString():"从空档案开始，保存后可跨设备查看"}</span><Button size="small" variant="ghost" loading={dataQuery.isFetching} onClick={()=>void dataQuery.refetch().then(()=>client.invalidateQueries({queryKey:["personalContext",server]}))}><RotateCcw size={14}/>刷新</Button></div>
    {dataQuery.isError&&<InlineError message={"无法刷新，当前显示上次读取的档案。"+api.getErrorMessage(dataQuery.error)} onRetry={()=>void dataQuery.refetch()}/>}
    {!edit&&!importDraft&&error&&<InlineError message={error} onRetry={()=>{setError("");void dataQuery.refetch();}}/>}
    <input ref={fileInput} className="sr-only" aria-label="导入简历 JSON 文件" type="file" accept=".json,application/json" onChange={event=>{const file=event.target.files?.[0];if(file)void importFile(file);}}/>
    <Tabs value={tab} onValueChange={value=>onTabChange(value as ProfileView)}><TabsList className="pf-tabs" aria-label="个人档案视图">{Object.entries(viewLabels).map(([value,label])=><TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList>
      <TabsContent value="overview">
        {isNew&&<div className="pf-start">
          <section className="pf-welcome"><div><span className="pf-kicker">个人资料库</span><h2>每一段经历，都值得留下来</h2><p>记录你的背景、经历与成果。需要规划学习或整理简历时，就从这里开始。</p></div><Button variant="primary" onClick={event=>newEntry("education",event.currentTarget)}><Plus size={16}/>记录第一段经历</Button></section>
          <div className="pf-start-grid">
            <section><span className="pf-step">01</span><h3>介绍现在的你</h3><p>补充称呼、关注方向和学习偏好，让资料有一个清晰的起点。</p><Button variant="ghost" onClick={event=>begin({type:"profile",draft:structuredClone(profile),base:structuredClone(profile),revision:data.revision},event.currentTarget)}><Pencil size={14}/>填写个人概况</Button></section>
            <section><span className="pf-step">02</span><h3>积累经历与成果</h3><p>从教育、工作或一个项目开始，保留贡献、结果和支持它的记录。</p><Button variant="ghost" onClick={()=>onTabChange("timeline")}><CalendarDays size={14}/>浏览经历与成果</Button></section>
            <section><span className="pf-step">03</span><h3>明确下一步方向</h3><p>建立一个有明确结果的目标，再把它拆成可以开始的行动。</p><Button variant="ghost" onClick={()=>onTabChange("goals")}><Target size={14}/>设置个人目标</Button></section>
          </div>
          <p className="pf-start-note"><Cloud size={14}/>保存后同步至当前服务器，也可从上方导入已有 JSON 简历。</p>
        </div>}
        {!isNew&&<>
        <div className="pf-overview-grid"><section className="pf-card pf-identity"><div className="pf-identity-heading"><span className="pf-avatar" aria-hidden="true">{Array.from(profile.name)[0]||"我"}</span><div><h2>{profile.name||"我的档案"}</h2><p className="pf-direction">{profile.direction||"关注方向待补充"}</p>{profile.city&&<p className="pf-location"><MapPin size={13}/>{profile.city}</p>}</div></div><p className="pf-bio">{profile.bio||"个人简介可以之后再写，先把真实经历保存下来。"}</p><dl className="pf-profile-facts"><dt>已取得学历</dt><dd>{education.map(e=>[e.degree||e.title,e.major].filter(Boolean).join(" · ")).join("；")||"尚未记录"}</dd><dt>当前在读</dt><dd>{current.filter(e=>e.kind==="education").map(e=>[e.organization,e.degree||e.title].filter(Boolean).join(" · ")).join("；")||"未记录在读经历"}</dd><dt>当前工作</dt><dd>{current.filter(e=>e.kind==="work").map(e=>[e.organization,e.position||e.title].filter(Boolean).join(" · ")).join("；")||"未记录在职经历"}</dd></dl>{profile.skills.length>0&&<div className="pf-tags">{profile.skills.map(skill=><span key={skill}>{skill}</span>)}</div>}<p className="pf-muted">依据本人保存的状态汇总，不等同于独立认证。</p></section>
          <div className="pf-overview-side"><section className="pf-card"><div className="pf-section-heading"><Target size={18}/><h2>当前目标</h2><Button size="small" variant="ghost" onClick={()=>onTabChange("goals")}>管理目标</Button></div>{goals.filter(g=>g.status==="active").slice(0,3).map(goal=><div className="pf-goal-brief" key={goal.id}><strong>{goal.title}</strong><p>{goal.nextStep||goal.description||"下一步待补充"}</p></div>)}{!goals.some(g=>g.status==="active")&&<p>{profile.goal||"还没有活动目标。可以先定一个有明确结果的小目标。"}</p>}{profile.preference&&<div className="pf-soft-box"><strong>学习偏好与安排</strong><p>{profile.preference}</p></div>}</section><section className="pf-card"><div className="pf-section-heading"><BriefcaseBusiness size={18}/><h2>正在进行</h2></div>{current.slice(0,4).map(e=><button className="pf-current-row" key={e.id} onClick={()=>chooseEntry(e.id)}><span className="pf-dot"/><span><strong>{e.title}</strong><small>{statusLabel(e)} · {experiencePeriod(e)}</small></span></button>)}{!current.length&&<p className="pf-muted">进行中的工作、学习与项目会显示在这里。</p>}</section></div></div>
        <section className="pf-card pf-recent"><div className="pf-section-heading"><GraduationCap size={18}/><h2>成果与里程碑</h2><Button size="small" onClick={event=>newEntry("achievement",event.currentTarget)}><Plus size={14}/>记录成果</Button></div><div className="pf-recent-grid">{active.filter(e=>["achievement","milestone","certificate"].includes(e.kind)).slice(0,4).map(e=><button key={e.id} onClick={()=>chooseEntry(e.id)}><span className="pf-muted">{profileKinds[e.kind]} · {e.start||"日期待补充"}</span><strong>{e.title}</strong><p>{e.result||e.description}</p></button>)}</div>{!active.some(e=>["achievement","milestone","certificate"].includes(e.kind))&&<p className="pf-muted">完成作品、获得认证或进入新阶段时，留下成果并关联支持它的记录。</p>}</section>
        </>}
      </TabsContent>
      <TabsContent value="timeline">
        <section className="pf-library-header"><div><h2>经历与成果</h2><p>按时间浏览，保留贡献、结果和依据。</p></div><Button id="profile-add-entry" variant="primary" onClick={event=>newEntry(kind in profileKinds?kind as ProfileKind:"work",event.currentTarget)}><Plus size={16}/>添加条目</Button></section>
        <div className="pf-library-filters"><label><span className="sr-only">经历类型</span><SelectField aria-label="经历类型" className="ui-field" value={kind} onValueChange={event=>onFilter(event,query)}><SelectItem value="all">全部类型 ({active.length})</SelectItem>{Object.entries(profileKinds).map(([type,label])=><SelectItem key={type} value={type}>{label} ({active.filter(e=>e.kind===type).length})</SelectItem>)}</SelectField></label><label className="pf-search"><Search size={15}/><Input aria-label="搜索经历" placeholder="搜索标题、组织、成果或标签…" value={query} onChange={event=>onFilter(kind,event.target.value)}/></label></div>
        <div className={"pf-explorer"+(entryId?" pf-explorer-detail":"")}>{wide&&list.length>0?<ResponsiveSplit workspace="profile" first={entryList} second={entryReader}/>:entryId?entryReader:entryList}</div>
      </TabsContent>
      <TabsContent value="goals">
        <section className="pf-library-header"><div><h2>个人目标</h2><p>关联主题或项目，为下一步行动保留方向。</p></div><Button variant="primary" onClick={event=>{const draft={...newPersonalGoal(),id:newClientId()};begin({type:"goal",draft,base:structuredClone(draft),revision:data.revision},event.currentTarget);}}><Plus size={16}/>添加目标</Button></section>
        <div className="pf-goal-grid">{goals.map(goal=><section className="pf-card" key={goal.id}><div className="pf-section-heading"><span className="pf-badge">{goalLabels[goal.status]}</span><IconButton label={"编辑目标"+goal.title} variant="ghost" onClick={event=>begin({type:"goal",draft:structuredClone(goal),base:structuredClone(goal),revision:data.revision},event.currentTarget)}><Pencil size={15}/></IconButton></div><h3>{goal.title}</h3><p>{goal.description}</p>{goal.targetDate&&<p className="pf-muted">期望日期：{goal.targetDate}{goal.status==="active"&&(profileDateBounds(goal.targetDate)?.[1]??Infinity)<(profileDateBounds(today)?.[0]??0)?" · 已超过期望日期":""}</p>}{goal.spaceId&&<p className="pf-muted">关联空间：{goal.spaceTitle||"空间已不可用"}{!goal.spaceAvailable?"（已归档或不可用）":""}</p>}<div className="pf-soft-box"><strong>下一步</strong><p>{goal.nextStep||"补充一个可以开始的具体动作。"}</p></div><div className="pf-goal-actions"><span className="pf-muted">{goal.aiAllowed?"允许选入背景":"不选入背景"}</span>{goal.status==="active"&&<Button size="small" disabled={writes.isPending} onClick={()=>void writes.mutateAsync(()=>api.savePersonalGoal(data.revision,{...goal,status:"completed"})).catch(handleError)}><Check size={14}/>标记完成</Button>}</div></section>)}</div>
        {!goals.length&&<EmptyState icon={Target} title="添加一个有明确结果的目标" description="例如完成作品、准备考试或进入新的学习阶段。目标与经历事实分开保存。"/>}
      </TabsContent>
      <TabsContent value="context">
        <section className="pf-card pf-context-workspace" aria-label="背景编排">
          <header className="pf-context-header">
            <div><h2><Sparkles size={18}/>编排本次背景</h2><p className="pf-muted">选择本次需要的资料，检查预览后再复制、导出或分析。</p></div>
            <label className="workbench-field pf-context-purpose"><span>背景用途</span><SelectField aria-label="背景用途" className="ui-field" value={purpose} onValueChange={value=>changePurpose(value as BackgroundPurpose)}>{Object.entries(purposeLabels).map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectField></label>
          </header>
          <div className="pf-context-grid pf-context-columns">
            <section className="pf-context-selection" aria-label="选择本次背景">
              <div className="pf-context-heading"><h3>选择资料</h3><p className="pf-muted">切换用途会重新推荐。新条目默认不允许使用。</p></div>
              <div className="pf-context-source-list">
                <fieldset><legend>个人概况</legend><label className="pf-check"><Checkbox checked={includeProfile} onChange={event=>setIncludeProfile(event.target.checked)}/><span>{purpose==="resume"?"个人介绍与技能自述":"个人介绍、当前愿望与偏好"}<small>不含联系方式</small></span></label></fieldset>
                <fieldset><legend>经历与成果 <span className="pf-muted">{active.length}</span></legend>
                  {active.length ? active.map(entry=><div key={entry.id} className="pf-background-item"><label className="pf-check"><Checkbox disabled={!entry.aiAllowed} checked={entry.aiAllowed&&chosenIds.includes(entry.id)} onChange={event=>setSelectedIds(event.target.checked?[...chosenIds,entry.id]:chosenIds.filter(id=>id!==entry.id))}/><span><strong>{entry.title}</strong><small>{profileKinds[entry.kind]} · {statusLabel(entry)}{!entry.aiAllowed?" · 未允许选入背景":""}</small></span></label><IconButton label={"设置背景使用 "+entry.title} variant="ghost" onClick={event=>editEntry(entry,event.currentTarget)}><Pencil size={15}/></IconButton></div>) : <p className="pf-muted pf-context-empty">尚未记录经历。可以先使用个人概况，之后再补充资料。</p>}
                </fieldset>
                {goals.length>0&&<fieldset><legend>个人目标 <span className="pf-muted">{goals.length}</span></legend>{goals.map(goal=><label key={goal.id} className="pf-check"><Checkbox disabled={!goal.aiAllowed} checked={goal.aiAllowed&&goalIds.includes(goal.id)} onChange={event=>setGoalIds(ids=>event.target.checked?[...ids,goal.id]:ids.filter(id=>id!==goal.id))}/><span>{goal.title}<small>{goal.aiAllowed?"允许选入背景":"未允许选入背景"}</small></span></label>)}</fieldset>}
              </div>
              <footer className="pf-context-selection-footer"><Button size="small" variant="ghost" onClick={()=>changePurpose(purpose)}><RotateCcw size={14}/>恢复推荐范围</Button></footer>
            </section>
            <section className="pf-context-result" aria-label="服务端背景预览">
              <div className="pf-context-heading"><h3>背景预览</h3><p className="pf-muted">{selected.length} 段经历 · {selectedGoals.length} 个目标</p></div>
              {contextQuery.isError&&<InlineError message={api.getErrorMessage(contextQuery.error)} onRetry={()=>void dataQuery.refetch().then(()=>client.invalidateQueries({queryKey:["personalContext",server]}))}/>}
              <Textarea className="pf-context-preview" aria-label="背景说明预览" readOnly value={contextQuery.isError?"当前背景已失效，请刷新档案后重新编排。":!hasContext?"先选择一份概况、经历或目标。":contextQuery.isFetching&&!contextQuery.data?"正在编排背景…":contextQuery.data?.text||""}/>
              <footer className="pf-preview-actions"><Button disabled={!contextQuery.data||contextQuery.isFetching||contextQuery.isError} onClick={()=>void copyText(contextQuery.data!.text).then(()=>toast.success("已复制所选背景")).catch(()=>toast.error("复制失败，可在预览中选择文字复制"))}><Copy size={14}/>复制所选背景</Button><Button disabled={!contextQuery.data||contextQuery.isFetching||contextQuery.isError} onClick={event=>{origin.current=event.currentTarget;setExportScope("selected");setExportFormat("markdown");setPanel("export");}}><Download size={14}/>导出所选背景</Button></footer>
            </section>
          </div>
        </section>
        <section className="pf-card pf-context-analysis" aria-label="个人分析提问">
          <div className="pf-context-heading"><h2>基于这份资料分析</h2><p className="pf-muted">当前预览与问题会发送给设置中的 AI 服务。结果独立保存，资料变化后会标明旧结果。</p></div>
          <ProfileTextarea label="希望 AI 分析的问题" value={question} onChange={setQuestion} help="例如：结合当前目标和经历，帮我制定四周学习计划，并说明依据和不足。"/>
          <div className="pf-context-analysis-actions"><p className="pf-muted">发起前，请检查上方资料范围。</p><Button variant="primary" loading={analysis.isPending} disabled={!question.trim()||question.length>2000||!contextQuery.data||contextQuery.isFetching||contextQuery.isError} onClick={()=>{setError("");analysis.mutate();}}><Sparkles size={15}/>生成个人分析</Button></div>
          {analysis.isPending&&<p role="status" className="pf-muted">正在生成，可以稍后在分析记录中查看。</p>}
        </section>
      </TabsContent>
      <TabsContent value="analyses">
        {analysisTotal===0?
          <section className="pf-card pf-analysis-empty">
            {analysisListQuery.isPending?<p role="status" className="pf-muted">正在读取分析记录…</p>:analysisListQuery.isError?
              <InlineError message={api.getErrorMessage(analysisListQuery.error)} onRetry={()=>void analysisListQuery.refetch()}/>:
              <EmptyState icon={Sparkles} title="从一个具体问题开始" description="选择你愿意使用的背景，再提出学习、工作或成长中的问题。分析将独立保存，方便之后回顾。" action={<Button variant="primary" onClick={()=>onTabChange("context")}>选择背景，开始分析</Button>}/>}
          </section>:
          <div className="pf-analysis-layout" data-report-selected={!!reportId}>
            <section className="pf-card pf-analysis-list">
              <div className="pf-section-heading"><h2>分析记录</h2><span className="pf-muted">{analysisTotal} 条</span></div>
              <p className="pf-muted">保留建议与当时的背景，方便回看。</p>
              <div className="pf-analysis-items">{analysisItems.map(item=><button key={item.id} aria-current={reportId===item.id?"true":undefined} onClick={()=>selectReport(item.id)}><strong>{item.question}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.status==="completed"?"已完成":item.status==="running"?"生成中":"未完成"}</small></button>)}</div>
              {analysisListQuery.isError&&<InlineError message={api.getErrorMessage(analysisListQuery.error)} onRetry={()=>void analysisListQuery.refetch()}/>}
              {(analysisPage>1||analysisListQuery.data?.hasMore)&&<nav className="pf-history-pagination" aria-label="分析记录分页"><Button size="small" disabled={analysisPage===1} onClick={()=>setAnalysisPage(page=>page-1)}>上一页</Button><span className="pf-muted">第 {analysisPage} 页</span><Button size="small" disabled={!analysisListQuery.data?.hasMore} onClick={()=>setAnalysisPage(page=>page+1)}>下一页</Button></nav>}
            </section>
            <section className="pf-card pf-analysis-reader">
              {mobile&&reportId&&<div className="pf-reader-toolbar"><Button size="small" onClick={()=>selectReport(null)}><ArrowLeft size={15}/>返回分析列表</Button></div>}
              {reportQuery.isPending&&reportId&&<p role="status">正在读取分析…</p>}
              {reportQuery.isError&&<InlineError message={api.getErrorMessage(reportQuery.error)} onRetry={()=>void reportQuery.refetch()}/>}
              {report&&<><h2>{report.question}</h2><p className="pf-muted">{new Date(report.createdAt).toLocaleString()} · {report.model||"模型待返回"} · 用量与费用未记录</p>{report.outdated&&<div className="pf-note">这是基于较早资料或迁移前资料的分析。查看当时背景后，再决定是否重新生成。</div>}{report.status==="failed"&&<InlineError message={report.error||"分析未完成，请重新发起。"} onRetry={()=>{setQuestion(report.question);onTabChange("context");}}/>}{report.status==="running"&&<p role="status">分析仍在生成中…</p>}{report.content&&<Suspense fallback={<p role="status">正在加载阅读器…</p>}><MarkdownContent content={report.content}/></Suspense>}<details className="pf-history-context"><summary>查看发起时的背景</summary><pre>{report.contextText||"没有保留背景快照。"}</pre></details></>}
              {!reportId&&<EmptyState title="选择一份分析" description="查看建议、材料依据和发起时的背景。"/>}
            </section>
          </div>}
      </TabsContent>
    </Tabs>
    {edit&&<ProfileModal title={edit.type==="profile"?"编辑个人概况":edit.type==="entry"?"编辑经历与成果":"编辑个人目标"} onClose={closeEdit} origin={origin.current} dirty={dirty} busy={writes.isPending}>{error&&<InlineError message={error}/>} {conflictPanel}<form noValidate className="pf-form" onSubmit={event=>{event.preventDefault();
        const invalid=event.currentTarget.querySelector<HTMLInputElement|HTMLTextAreaElement>("input:invalid,textarea:invalid");
        if(invalid){const label=invalid.getAttribute("aria-label")||invalid.closest("label")?.querySelector("span")?.textContent||"必填项";setError(invalid.validity.valueMissing?"请填写"+label:invalid.validity.typeMismatch&&invalid instanceof HTMLInputElement&&invalid.type==="email"?"请填写有效的邮箱地址":"请检查"+label+"的填写内容");invalid.focus();return;}
        void saveEdit();}}><fieldset disabled={writes.isPending}>
      {profileDraft&&<><div className="pf-form-grid"><Field label="称呼" maxLength={60} value={profileDraft.name} onChange={event=>patchProfile({name:event.target.value})}/><Field label="城市（可选）" maxLength={100} value={profileDraft.city} onChange={event=>patchProfile({city:event.target.value})}/></div><Field label="关注方向" maxLength={200} value={profileDraft.direction} onChange={event=>patchProfile({direction:event.target.value})}/><ProfileTextarea label="个人简介" value={profileDraft.bio} onChange={bio=>patchProfile({bio})}/><ProfileTextarea label="当前愿望（可选）" value={profileDraft.goal} onChange={goal=>patchProfile({goal})}/><ProfileTextarea label="学习偏好与时间安排" value={profileDraft.preference} onChange={preference=>patchProfile({preference})}/><Field label="技能自述" value={skillsText} onChange={event=>setSkillsText(event.target.value)} help="以逗号或换行分隔。仅记录自述，不从复习成绩推断能力。"/><details className="pf-contact-fields"><summary>联系方式 · 默认不发送给 AI</summary><Field label="邮箱" type="email" maxLength={254} value={profileDraft.email} onChange={event=>patchProfile({email:event.target.value})}/><Field label="电话" maxLength={64} value={profileDraft.phone} onChange={event=>patchProfile({phone:event.target.value})}/><Field label="个人网站" maxLength={2000} placeholder="https://" value={profileDraft.website} onChange={event=>patchProfile({website:event.target.value})}/></details></>}
      {entryDraft&&<><div className="pf-form-grid"><label className="workbench-field"><span>条目类型</span><SelectField aria-label="条目类型" className="ui-field" value={entryDraft.kind} onValueChange={event=>{const type=event as ProfileKind;patchEntry({kind:type,status:type==="achievement"||type==="milestone"?"completed":"planned",parentId:""});}}>{Object.entries(profileKinds).map(([type,label])=><SelectItem key={type} value={type}>{label}</SelectItem>)}</SelectField></label><label className="workbench-field"><span>经历状态</span><SelectField aria-label="经历状态" className="ui-field" value={entryDraft.status} onValueChange={event=>patchEntry({status:event as PersonalEntry["status"]})}>{statusChoices[entryDraft.kind].map(([status,label])=><SelectItem key={status} value={status}>{label}</SelectItem>)}</SelectField></label></div><Field label="标题" required maxLength={200} value={entryDraft.title} onChange={event=>patchEntry({title:event.target.value})}/><Field label={entryDraft.kind==="education"?"学校":"组织 / 项目 / 学习主题"} maxLength={200} value={entryDraft.organization} onChange={event=>patchEntry({organization:event.target.value})}/>
        {entryDraft.kind==="achievement"&&<label className="workbench-field"><span>成果分类</span><SelectField aria-label="成果分类" className="ui-field" value={entryDraft.achievementType||"output"} onValueChange={event=>patchEntry({achievementType:event as PersonalEntry["achievementType"]})}><SelectItem value="output">作品 / 交付成果</SelectItem><SelectItem value="award">奖项</SelectItem><SelectItem value="publication">文章 / 发表</SelectItem></SelectField></label>}
        {entryDraft.kind==="education"&&<div className="pf-form-grid"><Field label="学历 / 学位" maxLength={100} value={entryDraft.degree} onChange={event=>patchEntry({degree:event.target.value})}/><Field label="专业" maxLength={200} value={entryDraft.major} onChange={event=>patchEntry({major:event.target.value})}/></div>}{entryDraft.kind==="work"&&<Field label="岗位" maxLength={200} value={entryDraft.position} onChange={event=>patchEntry({position:event.target.value})}/>} {entryDraft.kind==="project"&&<Field label="个人角色" maxLength={200} value={entryDraft.role} onChange={event=>patchEntry({role:event.target.value})}/>} {entryDraft.kind==="learning"&&<Field label="学习方向" maxLength={500} value={entryDraft.focus} onChange={event=>patchEntry({focus:event.target.value})}/>}
        {["achievement","milestone","certificate"].includes(entryDraft.kind)&&<label className="workbench-field"><span>归属经历（可选）</span><SelectField aria-label="归属经历" className="ui-field" value={entryDraft.parentId} onValueChange={event=>patchEntry({parentId:event})}><SelectItem value="">独立条目</SelectItem>{active.filter(e=>!["achievement","milestone","certificate"].includes(e.kind)).map(e=><SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}</SelectField></label>}
        <div className="pf-form-grid"><Field label={["achievement","milestone","certificate"].includes(entryDraft.kind)?"发生日期（可选）":"开始时间（可选）"} maxLength={10} placeholder="2026 / 2026-07 / 2026-07-12" value={entryDraft.start} onChange={event=>patchEntry({start:event.target.value})}/>{!["achievement","milestone","certificate"].includes(entryDraft.kind)&&<Field label="结束时间（可选）" maxLength={10} placeholder={entryDraft.status==="active"?"至今":"未知可留空"} disabled={entryDraft.status==="active"} value={entryDraft.status==="active"?"":entryDraft.end} onChange={event=>patchEntry({end:event.target.value})}/>}</div><ProfileTextarea label="经历 / 个人贡献" value={entryDraft.description} onChange={description=>patchEntry({description})}/><ProfileTextarea label="成果（可选）" value={entryDraft.result} onChange={result=>patchEntry({result})}/><Field label="标签" value={tagText} onChange={event=>setTagText(event.target.value)}/>
        <SourcePicker value={entryDraft.sources} onChange={sources=>patchEntry({sources})}/><ProfileTextarea label="依据说明（可选）" value={entryDraft.sourceNote} onChange={sourceNote=>patchEntry({sourceNote})}/><Field label="外部来源链接（可选）" maxLength={2000} placeholder="https://" value={entryDraft.sourceUrl} onChange={event=>patchEntry({sourceUrl:event.target.value})}/><label className="pf-check"><Checkbox type="checkbox" checked={entryDraft.aiAllowed} onChange={event=>patchEntry({aiAllowed:event.target.checked})}/>允许选入背景说明</label></>}
      {goalDraft&&<><Field label="目标标题" required maxLength={200} value={goalDraft.title} onChange={event=>patchGoal({title:event.target.value})}/><ProfileTextarea label="目标说明" value={goalDraft.description} onChange={description=>patchGoal({description})}/><div className="pf-form-grid"><label className="workbench-field"><span>目标状态</span><SelectField aria-label="目标状态" className="ui-field" value={goalDraft.status} onValueChange={event=>patchGoal({status:event as PersonalGoal["status"]})}>{Object.entries(goalLabels).map(([status,label])=><SelectItem value={status} key={status}>{label}</SelectItem>)}</SelectField></label><Field label="期望完成日期（可选）" maxLength={10} placeholder="年份、年月或日期" value={goalDraft.targetDate} onChange={event=>patchGoal({targetDate:event.target.value})}/></div><ProfileTextarea label="下一步行动" value={goalDraft.nextStep} onChange={nextStep=>patchGoal({nextStep})}/><SourcePicker onlySpaces single value={goalDraft.spaceId?[{kind:"space",targetId:goalDraft.spaceId,title:goalDraft.spaceTitle,date:"",url:"",available:goalDraft.spaceAvailable}]:[]} onChange={sources=>patchGoal({spaceId:sources[0]?.targetId||"",spaceTitle:sources[0]?.title||"",spaceAvailable:sources[0]?.available||false})}/><label className="pf-check"><Checkbox type="checkbox" checked={goalDraft.aiAllowed} onChange={event=>patchGoal({aiAllowed:event.target.checked})}/>允许选入背景说明</label></>}
      </fieldset>{formButtons}</form></ProfileModal>}
    {panel==="trash"&&<ProfileModal title="个人档案回收站" onClose={()=>setPanel(null)} origin={origin.current} busy={writes.isPending}><p className="pf-muted">恢复条目会保留原 ID 和关联。已移除的资料不会进入新的背景说明。</p>{error&&<InlineError message={error}/>}<div className="pf-trash-list">{data.entries.filter(e=>e.removed).map(e=><div key={e.id}><span><strong>{e.title}</strong><small>{profileKinds[e.kind]}</small></span><Button size="small" disabled={writes.isPending} onClick={()=>void remove(e.id,false,false)}>恢复经历</Button></div>)}{data.goals.filter(g=>g.removed).map(g=><div key={g.id}><span><strong>{g.title}</strong><small>个人目标</small></span><Button size="small" disabled={writes.isPending} onClick={()=>void remove(g.id,true,false)}>恢复目标</Button></div>)}{!data.entries.some(e=>e.removed)&&!data.goals.some(g=>g.removed)&&<EmptyState title="回收站为空"/>}</div></ProfileModal>}
    {panel==="export"&&<ProfileModal title="导出个人资料" onClose={()=>setPanel(null)} origin={origin.current} description="先确认范围。正式备份与迁移请使用设置中的完整迁移包。"><div className="pf-form"><fieldset className="pf-export-scope"><legend>资料范围</legend><label className="pf-check"><Radio type="radio" name="scope" checked={exportScope==="selected"} onChange={()=>setExportScope("selected")}/>{exportFormat==="markdown"?"所选背景 · "+selected.length+" 段经历":"自选简历资料 · "+scopeEntries.length+" 条"}</label><label className="pf-check"><Radio type="radio" name="scope" checked={exportScope==="whole"} onChange={()=>setExportScope("whole")}/>完整档案 · {active.length} 段经历</label></fieldset>{exportScope==="whole"&&<div className="pf-note">完整档案包含未允许选入背景的经历。Markdown 不含分析报告，所有数据的完整副本在备份迁移包中。</div>}<label className="workbench-field"><span>导出格式</span><SelectField aria-label="导出格式" className="ui-field" value={exportFormat} onValueChange={event=>setExportFormat(event as typeof exportFormat)}><SelectItem value="markdown">Markdown 资料</SelectItem><SelectItem value="resume">JSON Resume 简历数据</SelectItem><SelectItem value="print">简历预览 / 打印 PDF</SelectItem></SelectField></label>{exportFormat!=="markdown"&&<>{exportScope==="selected"&&<div className="pf-export-entries"><p className="pf-muted">本地简历输出与 AI 使用许可独立，可选择未允许发送给 AI 的条目。</p>{active.filter(e=>e.status!=="planned").map(e=><label className="pf-check" key={e.id}><Checkbox type="checkbox" checked={cvIds.includes(e.id)} onChange={event=>setResumeIds(event.target.checked?[...cvIds,e.id]:cvIds.filter(id=>id!==e.id))}/>{e.title}</label>)}</div>}<label className="pf-check"><Checkbox type="checkbox" checked={exportIntro} onChange={event=>setExportIntro(event.target.checked)}/>包含姓名、方向、简介与技能自述</label><label className="pf-check"><Checkbox type="checkbox" checked={contacts} onChange={event=>setContacts(event.target.checked)}/>包含联系方式与城市</label><p className="pf-muted">计划中条目不进入简历；来源笔记和个人分析不进入简历输出。</p></>}{exportFormat==="print"?<div className="pf-resume-preview"><ResumeDocument profile={resumeProfile} entries={scopeEntries} contacts={contacts}/></div>:<Textarea aria-label="导出内容预览" className="ui-textarea pf-export-preview" readOnly value={exportData}/>}<div className="pf-form-actions"><DialogCloseButton/>{exportFormat==="print"?<Button variant="primary" onClick={()=>window.print()}><Printer size={15}/>打印 / 保存 PDF</Button>:<Button variant="primary" disabled={exportScope==="selected"&&exportFormat==="markdown"&&(!contextQuery.data||contextQuery.isFetching)} onClick={()=>{downloadText(exportData,exportFormat==="resume"?"resume.json":"personal-profile.md",exportFormat==="resume"?"application/json;charset=utf-8":"text/markdown;charset=utf-8");setPanel(null);toast.success("资料已导出");}}><Download size={15}/>下载资料</Button>}</div></div></ProfileModal>}
    {panel==="export"&&exportFormat==="print"&&createPortal(<div className="profile-print-copy"><ResumeDocument profile={resumeProfile} entries={scopeEntries} contacts={contacts}/></div>,document.body)}
    {importDraft&&<ProfileModal title="预览 JSON 简历导入" onClose={()=>{setImportDraft(null);setError("");}} origin={origin.current} busy={importMutation.isPending} description="只填补当前概况的空白字段；完全相同的经历会跳过。状态需本人核对后确认。">{error&&<InlineError message={error}/>}<div className="pf-form"><p>文件称呼：{importDraft.profile.name||"未填写"} · {importDraft.entries.length} 条可识别经历</p>{profile.name&&importDraft.profile.name&&profile.name!==importDraft.profile.name&&<label className="pf-check pf-note"><Checkbox type="checkbox" checked={confirmedOwner} onChange={event=>setConfirmedOwner(event.target.checked)}/>文件姓名不同，我确认这些资料属于本人并导入当前档案</label>}<div className="pf-import-list">{importDraft.entries.map(entry=><div key={entry.id}><label className="pf-check"><Checkbox type="checkbox" checked={importDraft.selected.includes(entry.id)} onChange={event=>setImportDraft(value=>value?{...value,selected:event.target.checked?[...value.selected,entry.id]:value.selected.filter(id=>id!==entry.id)}:value)}/><span><strong>{entry.title}</strong><small>{entry.organization} · {experiencePeriod(entry)}</small></span></label><SelectField aria-label={"导入状态 "+entry.title} className="ui-field" value={entry.status} onValueChange={event=>setImportDraft(value=>value?{...value,entries:value.entries.map(e=>e.id===entry.id?{...e,status:event as PersonalEntry["status"]}:e)}:value)}>{statusChoices[entry.kind].map(([status,label])=><SelectItem key={status} value={status}>{label}</SelectItem>)}</SelectField></div>)}</div><label className="pf-check"><Checkbox type="checkbox" checked={importAllowed} onChange={event=>setImportAllowed(event.target.checked)}/>允许导入的条目选入背景说明（此操作不会发送给 AI）</label>{importDraft.revision!==data.revision&&<Button onClick={()=>setImportDraft(value=>value?{...value,revision:data.revision}:value)}>已刷新档案，按最新版本重试导入</Button>}<div className="pf-form-actions"><DialogCloseButton disabled={importMutation.isPending}/><Button variant="primary" loading={importMutation.isPending} disabled={!!profile.name&&!!importDraft.profile.name&&profile.name!==importDraft.profile.name&&!confirmedOwner} onClick={()=>importMutation.mutate()}>确认保存选中资料</Button></div></div></ProfileModal>}
    {blocker.status==="blocked"&&<ProfileModal title="离开个人档案？" onClose={()=>blocker.reset()} origin={origin.current} description="当前表单还有未保存的修改。"><div className="pf-form-actions"><Button onClick={()=>blocker.reset()}>留在此页继续编辑</Button><Button variant="danger" onClick={()=>blocker.proceed()}>放弃修改并离开</Button></div></ProfileModal>}
    {dialog}
  </div>;
}
import * as Dialog from "@radix-ui/react-dialog";
function DialogCloseButton({disabled=false}:{disabled?:boolean}){return <Dialog.Close asChild><Button disabled={disabled}>取消</Button></Dialog.Close>;}
