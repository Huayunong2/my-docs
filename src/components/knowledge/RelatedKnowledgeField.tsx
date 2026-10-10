import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import * as api from "../../lib/api";
export default function RelatedKnowledgeField({ids,onChange,exclude}:{ids:string[];onChange:(ids:string[])=>void;exclude?:string}){
  const [query,setQuery]=useState("");
  const labels=useQuery({queryKey:api.knowledgeQueryKeys.labels(ids),queryFn:()=>api.getKnowledgeCardLabels(ids),enabled:ids.length>0,staleTime:60_000});
  const results=useQuery({queryKey:["organizeRelations",query],queryFn:({signal})=>api.queryKnowledgeCards({q:query,summary:true,page_size:8},{signal}),enabled:query.trim().length>0,staleTime:30_000});
  return <section className="ko-relations"><label>关联知识<input className="ui-field" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索已有知识的标题或正文"/></label><div className="ko-actions">{ids.map(id=><button className="ui-button-ghost" key={id} onClick={()=>onChange(ids.filter(v=>v!==id))}>{labels.data?.find(v=>v.id===id)?.title||"关联知识"} ×</button>)}</div>{results.isError&&<p className="ui-alert-warn" role="alert">读取失败，请重新搜索。</p>}{query&&<div className="ko-similar">{results.data?.cards.filter(c=>c.id!==exclude&&!ids.includes(c.id)).map(c=><button className="ko-match" key={c.id} onClick={()=>{onChange([...ids,c.id]);setQuery("");}}>{c.title}</button>)}</div>}</section>;
}
