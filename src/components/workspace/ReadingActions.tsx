import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { useMobileLayout } from "../../lib/useMobileLayout";
import { Button, IconButton } from "../ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "../ui/sheet";

export interface ReadingAction { id: string; label: string; icon?: ReactNode; onSelect: (origin: HTMLButtonElement | null) => void; disabled?: boolean; variant?: "secondary" | "danger" | "primary"; }
export default function ReadingActions({ children, actions = [], label = "阅读操作", reading = true }: { children?: ReactNode; actions?: ReadingAction[]; label?: string; reading?: boolean }) {
  const mobile = useMobileLayout();
  const [open, setOpen] = useState(false);
  const [viewport,setViewport]=useState({height:window.visualViewport?.height || innerHeight,bottom:0});
  useEffect(()=>{if(!open) return;const update=()=>{const view=window.visualViewport;setViewport({height:view?.height || innerHeight,bottom:view ? Math.max(0,innerHeight-view.height-view.offsetTop) : 0});};update();window.visualViewport?.addEventListener("resize",update);window.visualViewport?.addEventListener("scroll",update);window.addEventListener("resize",update);return()=>{window.visualViewport?.removeEventListener("resize",update);window.visualViewport?.removeEventListener("scroll",update);window.removeEventListener("resize",update);};},[open]);
  const pending = useRef<(() => void) | null>(null);
  const panel=useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const commands = (close: boolean) => actions.map(action => <Button key={action.id} variant={action.variant || "ghost"} disabled={action.disabled} onClick={event => { const origin=close ? trigger.current : event.currentTarget; if (close) { pending.current=()=>action.onSelect(origin);setOpen(false); } else action.onSelect(origin); }}>{action.icon}{action.label}</Button>);
  if (!mobile || !reading) return <div className="reading-actions-content">{commands(false)}{children}</div>;
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button ref={trigger} className="reading-actions-trigger" aria-label={label} aria-expanded={open}><MoreHorizontal size={20}/><span>操作</span></Button></SheetTrigger>
    <SheetContent ref={panel} style={{maxHeight:viewport.height-20,bottom:viewport.bottom}} className="reading-actions-sheet" overlayClassName="reading-actions-overlay" onOpenAutoFocus={event => { event.preventDefault(); panel.current?.focus(); }} onCloseAutoFocus={event => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus({preventScroll:true}); } const command=pending.current;pending.current=null;if(command) window.setTimeout(command,0); }}>
      <SheetHeader><div className="reading-actions-heading"><SheetTitle>{label}</SheetTitle><IconButton label="关闭操作面板" onClick={() => setOpen(false)}><X size={18}/></IconButton></div><SheetDescription>按需操作，关闭后继续阅读。</SheetDescription></SheetHeader>
      <div className="reading-actions-sheet-body"><div className="reading-actions-commands">{commands(true)}</div>{children && <div className="reading-actions-controls">{children}</div>}</div>
    </SheetContent>
  </Sheet>;
}
