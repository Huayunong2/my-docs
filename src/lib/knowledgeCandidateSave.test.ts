import {afterEach,expect,it,vi} from "vitest";
import {knowledgeCandidateRequestId,saveKnowledgeCandidateDrafts} from "./api";

afterEach(()=>vi.unstubAllGlobals());
it("batch candidates keep similar drafts and retry partial saves without changing request IDs",async()=>{
  vi.stubGlobal("window",{__TAURI_INTERNALS__:{}});
  vi.stubGlobal("localStorage",{getItem:(key:string)=>key==="server_url"?"https://summary.test/api":null});
  const receipts=new Map<string,unknown>();let fail=true;const ids:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(_url:string,options:RequestInit)=>{
    const body=JSON.parse(String(options.body));ids.push(body.request_id);
    if(body.card.content==="second"&&fail){fail=false;return new Response("模拟保存失败",{status:500});}
    if(!receipts.has(body.request_id))receipts.set(body.request_id,{...body.card,id:body.request_id,tags:[],projects:[],related_ids:[],declared_related_ids:[],source_article_id:"",source_review_id:"",source_date:"",source_excerpt:"",created_at:"2026-10-09",updated_at:"2026-10-09"});
    return new Response(JSON.stringify(receipts.get(body.request_id)),{status:200,headers:{"Content-Type":"application/json"}});
  }));
  const candidates=[{candidate_key:"task:0",card_type:"concept" as const,title:"相似标题",content:"first"},{candidate_key:"task:1",card_type:"concept" as const,title:"相似标题",content:"second"}];
  await expect(saveKnowledgeCandidateDrafts(candidates)).rejects.toThrow("已保存 1 个草稿");
  const result=await saveKnowledgeCandidateDrafts(candidates);
  expect(result.imported).toBe(2);expect(result.skipped).toBe(0);expect(receipts.size).toBe(2);expect(ids[0]).toBe(ids[2]);expect(ids[1]).toBe(ids[3]);
  expect(await knowledgeCandidateRequestId("task:0:confirmed:new")).not.toBe(ids[0]);
});
