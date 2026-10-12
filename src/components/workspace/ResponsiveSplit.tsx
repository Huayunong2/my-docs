import { useEffect, useState, type ComponentType, type ReactNode } from "react";
type Props = { workspace:"knowledge" | "today" | "profile"; first:ReactNode; second:ReactNode };
let LoadedSplit: ComponentType<Props> | null = null;
let pending: Promise<ComponentType<Props>> | null = null;
// The bridge loads only when a wide split is mounted. Never initialize an editor in a Suspense fallback.
function loadSplit() {
  pending ??= import("./WorkbenchSplit").then(module => LoadedSplit = module.default).catch(error => { pending=null; throw error; });
  return pending;
}
export function preloadSplit() { if (window.matchMedia("(min-width: 1280px)").matches) void loadSplit().catch(()=>{ /* The mounted split keeps its fallback usable. */ }); }
export default function ResponsiveSplit(props:Props) {
  const [Component,setComponent]=useState(()=>LoadedSplit);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{let current=true;if(!Component)void loadSplit().then(component=>{if(current)setComponent(()=>component);}).catch(()=>{if(current)setFailed(true);});return()=>{current=false;};},[Component]);
  if(Component) return <Component {...props}/>;
  if(failed) return <div className="workbench-split-fallback">{props.first}{props.second}</div>;
  return <div className="workbench-split-loading" role="status" aria-label="正在准备分栏"><div className="ui-skeleton"/><div className="ui-skeleton"/></div>;
}
