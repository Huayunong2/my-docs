import { useMemo, type ReactNode } from "react";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import { readLocalStorage, writeLocalStorage } from "../../lib/storage";
import { getServerUrl } from "../../lib/api";
export default function WorkbenchSplit({ workspace, first, second }: { workspace:"knowledge" | "today"; first:ReactNode; second:ReactNode }) {
  const key = `reading-layout:${encodeURIComponent(getServerUrl())}:${workspace}`;
  const layout = useMemo<Layout | undefined>(() => {
    try { const value=JSON.parse(readLocalStorage(key) || "null"); return value && Number.isFinite(value.first) && Number.isFinite(value.second) && value.first>0 && value.second>0 && Math.abs(value.first+value.second-100)<.1 ? value : undefined; } catch { return undefined; }
  },[key]);
  const knowledge=workspace==="knowledge";
  return <Group key={key} className="workbench-split" id={`${workspace}-split`} orientation="horizontal" defaultLayout={layout} onLayoutChanged={(next,meta)=>{if(meta.isUserInteraction) writeLocalStorage(key,JSON.stringify(meta.requestedLayout || next));}}>
    <Panel id="first" defaultSize={knowledge ? "32%" : "53%"} minSize={knowledge ? 260 : 320} maxSize={knowledge ? 420 : undefined} className="workbench-split-pane">{first}</Panel>
    <Separator className="workbench-separator" aria-label={knowledge ? "调整知识列表与阅读区宽度" : "调整编辑与预览区宽度"}><span aria-hidden="true"/></Separator>
    <Panel id="second" minSize={knowledge ? 480 : 320} className="workbench-split-pane">{second}</Panel>
  </Group>;
}
