import { useId, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { useMobileLayout } from "../../lib/useMobileLayout";

export default function ReadingActions({ children, label = "阅读操作", reading = true }: { children: ReactNode; label?: string; reading?: boolean }) {
  const mobile = useMobileLayout();
  const [open, setOpen] = useState(false);
  const contentId = useId();
  if (!mobile || !reading) return <div className="reading-actions-content">{children}</div>;
  return <details className="reading-actions" onToggle={event => setOpen(event.currentTarget.open)} onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  }}>
    <summary role="button" aria-label={label} aria-expanded={open} aria-controls={contentId}><MoreHorizontal size={20}/><span>操作</span></summary>
    <div id={contentId} className="reading-actions-content">{children}</div>
  </details>;
}
