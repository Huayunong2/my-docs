import { Input, Textarea } from "../ui/reading-surface";
import { SelectField, SelectItem } from "../ui/select";
import { useDeferredValue, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Check, Link2, Search, X } from "lucide-react";
import * as api from "../../lib/api";
import type { PersonalSource } from "../../lib/personalProfile";
import { Button, IconButton } from "../ui/button";
import { InlineError } from "../ui/Feedback";

export function ProfileModal({title,description="保存后会同步到当前服务器。",children,onClose,origin,dirty=false,busy=false}:{
  title:string;description?:string;children:ReactNode;onClose:()=>void;origin:HTMLElement|null;dirty?:boolean;busy?:boolean;
}){
  const [discard,setDiscard]=useState(false);
  return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy){if(dirty)setDiscard(true);else onClose();}}}>
    <Dialog.Portal><Dialog.Overlay className="ui-overlay fixed inset-0 z-[80]"/>
      <Dialog.Content className="ui-modal-surface pf-modal" onCloseAutoFocus={event=>{event.preventDefault();const target=origin?.isConnected&&!origin.hasAttribute("disabled")?origin:document.getElementById("profile-add-entry")||document.getElementById("profile-edit")||document.querySelector<HTMLButtonElement>(".pf-top-actions button");target?.focus({preventScroll:true});}}>
        <header className="pf-modal-header"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><IconButton label="关闭面板" disabled={busy} variant="ghost"><X size={18}/></IconButton></Dialog.Close></header>
        <Dialog.Description className="pf-muted">{description}</Dialog.Description>
        {discard&&<div className="pf-discard" role="alert"><p>当前修改尚未保存，确定放弃吗？</p><Button autoFocus onClick={()=>setDiscard(false)}>继续编辑</Button><Button variant="danger" onClick={onClose}>放弃修改</Button></div>}
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
export function ProfileTextarea({label,value,onChange,help}:{label:string;value:string;onChange:(value:string)=>void;help?:string}){
  return <label className="workbench-field"><span>{label}</span><Textarea aria-label={label} className="ui-textarea" rows={3} maxLength={20000} value={value} onChange={event=>onChange(event.target.value)}/>{help&&<small>{help}</small>}</label>;
}
const sourceNames={article:"今日记录",knowledge:"知识条目",space:"空间",external:"外部资料"};
export function SourcePicker({value,onChange,onlySpaces=false,single=false}:{value:PersonalSource[];onChange:(value:PersonalSource[])=>void;onlySpaces?:boolean;single?:boolean}){
  const [open,setOpen]=useState(false);
  const [kind,setKind]=useState<"article"|"knowledge"|"space">(onlySpaces?"space":"article");
  const [q,setQ]=useState("");
  const query=useDeferredValue(q);
  const server=api.getServerUrl();
  const result=useQuery({queryKey:["personalSources",server,kind,query],queryFn:({signal})=>api.searchPersonalSources(kind,query,{signal}),enabled:open,staleTime:15000});
  const toggle=(source:PersonalSource)=>{
    const found=value.some(item=>item.kind===source.kind&&item.targetId===source.targetId);
    onChange(found?value.filter(item=>item.kind!==source.kind||item.targetId!==source.targetId):single?[source]:[...value,source]);
  };
  return <details className="pf-source-picker" onToggle={event=>setOpen(event.currentTarget.open)}><summary><Link2 size={15}/>{onlySpaces?"关联已有空间":"关联已有记录、知识或空间"}<span>{value.length} 项</span></summary>
    <div className="pf-source-controls">{!onlySpaces&&<SelectField className="ui-field" aria-label="来源类型" value={kind} onValueChange={event=>setKind(event as typeof kind)}>{(["article","knowledge","space"] as const).map(type=><SelectItem value={type} key={type}>{sourceNames[type]}</SelectItem>)}</SelectField>}<label className="pf-source-search"><Search size={14}/><Input aria-label="搜索来源" value={q} onChange={event=>setQ(event.target.value)} maxLength={200} placeholder="按标题或日期搜索"/></label></div>
    {result.isPending&&<p role="status" className="pf-muted">正在读取来源…</p>}
    {result.isError&&<InlineError message={api.getErrorMessage(result.error)} onRetry={()=>void result.refetch()}/>}
    <div className="pf-source-results">{result.data?.map(source=>{
      const selected=value.some(item=>item.kind===source.kind&&item.targetId===source.targetId);
      return <button type="button" key={source.kind+source.targetId} className="pf-source-option" aria-pressed={selected} onClick={()=>toggle(source)}><span><strong>{source.title||source.date||"未命名资料"}</strong><small>{sourceNames[source.kind]} {source.date}</small></span>{selected&&<Check size={16}/>}</button>;
    })}</div>
    {result.data?.length===0&&<p className="pf-muted">没有匹配的资料。可以保留手工依据说明，之后再关联。</p>}
    {!!value.length&&<div className="pf-source-selected">{value.map(source=><Button size="small" key={source.kind+source.targetId+source.url} onClick={()=>onChange(value.filter(item=>item!==source))}>{source.title||"已关联来源"}<X size={12}/></Button>)}</div>}
  </details>;
}
