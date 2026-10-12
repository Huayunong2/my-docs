import { useCallback, useEffect, useRef, type UIEvent } from "react";
type BrowsePosition = { resetKey:string; top:number; selected:string|null };
// UI navigation state only: one last browsing context per server, never record content.
const browsePositions = new Map<string,BrowsePosition>();
/** Preserve a responsive viewport; optional scope also survives a route remount. */
export function useReadingScroll(resetKey:string, scope?:string, ready=true) {
  const saved=scope ? browsePositions.get(scope) : undefined;
  const ref=useRef<HTMLDivElement|null>(null);
  const position=useRef(saved?.resetKey===resetKey ? saved.top : 0);
  const previous=useRef({resetKey,scope});
  if(previous.current.resetKey!==resetKey || previous.current.scope!==scope) {
    previous.current={resetKey,scope}; position.current=saved?.resetKey===resetKey ? saved.top : 0;
  }
  const attach=useCallback((node:HTMLDivElement|null)=>{
    ref.current=node;
    if(node) {const top=position.current;node.scrollTop=top;requestAnimationFrame(()=>{if(ref.current===node)node.scrollTop=top;});}
  },[]);
  const onScroll=useCallback((event:UIEvent<HTMLDivElement>)=>{
    if(!ready) return;
    position.current=event.currentTarget.scrollTop;
    if(scope) {const existing=browsePositions.get(scope);browsePositions.set(scope,{resetKey,top:position.current,selected:existing?.resetKey===resetKey ? existing.selected : null});}
  },[resetKey,scope,ready]);
  useEffect(()=>{if(ready)ref.current?.scrollTo({top:position.current});},[resetKey,scope,ready]);
  const rememberSelection=(id:string,targetScope=scope)=>{if(targetScope){const existing=browsePositions.get(targetScope);browsePositions.set(targetScope,{resetKey,top:existing?.resetKey===resetKey ? existing.top : position.current,selected:id});}};
  return {ref,attach,onScroll,rememberSelection,selected:saved?.resetKey===resetKey ? saved.selected : null};
}
