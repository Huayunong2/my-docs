import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Grip, Sparkles } from "lucide-react";
import { readLocalStorage, writeLocalStorage } from "../../lib/storage";

type Point = { left: number; top: number };
const positionKey = "ai-usage-launcher-position-v1";

function savedPosition(): Point | null {
  try {
    const point = JSON.parse(readLocalStorage(positionKey) || "null");
    return Number.isFinite(point?.left) && Number.isFinite(point?.top) ? point : null;
  } catch {
    return null;
  }
}

function fit(point: Point, width: number, height: number): Point {
  return {
    left: Math.min(Math.max(point.left, 8), Math.max(8, innerWidth - width - 8)),
    top: Math.min(Math.max(point.top, 8), Math.max(8, innerHeight - height - 8)),
  };
}

export default function AiTaskLauncher({ running, open, onOpen }: { running: number; open: boolean; onOpen: () => void }) {
  const [position, setPosition] = useState<Point | null>(() => {
    const saved = savedPosition();
    return saved ? (innerWidth < 768 ? saved : fit(saved, 148, 44)) : null;
  });
  const currentPosition = useRef<Point | null>(position);
  const button = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const clampSavedPosition = () => {
      if (innerWidth < 768) return;
      setPosition((current) => {
        if (!current || !button.current) return current;
        const next = fit(current, button.current.offsetWidth, button.current.offsetHeight);
        currentPosition.current = next;
        if (next.left !== current.left || next.top !== current.top) {
          writeLocalStorage(positionKey, JSON.stringify(next));
        }
        return next;
      });
    };
    window.addEventListener("resize", clampSavedPosition);
    clampSavedPosition();
    return () => window.removeEventListener("resize", clampSavedPosition);
  }, []);

  return createPortal((
    <button
      id="ai-task-launcher"
      ref={button}
      type="button"
      data-running={running > 0}
      className={`ko-task-launcher${drag.current?.moved ? " is-dragging" : ""}`}
      style={position ? { left: position.left, top: position.top, right: "auto", bottom: "auto" } : undefined}
      aria-label={`AI 使用情况与任务${running ? `，${running} 项正在运行` : ""}${innerWidth >= 768 ? "；可拖动，按 Alt+方向键微调位置" : ""}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="ai-task-panel"
      title={innerWidth >= 768 ? "点击打开；拖动或使用 Alt+方向键调整位置" : "查看进行中的 AI 任务"}
      onPointerDown={(event) => {
        if (event.button !== 0 || innerWidth < 768) return;
        const rect = event.currentTarget.getBoundingClientRect();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event: PointerEvent<HTMLButtonElement>) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 5) return;
        start.moved = true;
        const next = fit({ left: start.left + dx, top: start.top + dy }, event.currentTarget.offsetWidth, event.currentTarget.offsetHeight);
        currentPosition.current = next;
        setPosition(next);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        if (start.moved && currentPosition.current) {
          writeLocalStorage(positionKey, JSON.stringify(currentPosition.current));
          suppressClick.current = true;
          window.setTimeout(() => { suppressClick.current = false; }, 0);
        }
        drag.current = null;
      }}
      onPointerCancel={() => { drag.current = null; }}
      onClick={() => { if (!suppressClick.current) onOpen(); }}
      onKeyDown={(event) => {
        if (innerWidth < 768 || !event.altKey || !event.key.startsWith("Arrow")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const origin = position ?? { left: rect.left, top: rect.top };
        const step = event.shiftKey ? 48 : 16;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        event.preventDefault();
        event.stopPropagation();
        const next = fit({ left: origin.left + dx, top: origin.top + dy }, rect.width, rect.height);
        currentPosition.current = next;
        setPosition(next);
        writeLocalStorage(positionKey, JSON.stringify(next));
      }}
    >
      <Grip size={14} aria-hidden="true" />
      <Sparkles size={16} aria-hidden="true" />
      <span>AI 用量</span>
      {running > 0 && <b aria-hidden="true">{running}</b>}
    </button>
  ), document.body);
}
