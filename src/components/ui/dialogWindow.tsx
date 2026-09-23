import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Move } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

type Position = { x: number; y: number };
type BaseBounds = { left: number; top: number; right: number; bottom: number };
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  position: Position;
  bounds: BaseBounds;
};

const CENTER: Position = { x: 0, y: 0 };
const MOVE_STEP = 80;
const VIEWPORT_MARGIN = 16;

function desktopCanMove() {
  return typeof window !== "undefined"
    && window.matchMedia("(min-width: 840px) and (min-height: 520px)").matches;
}

function clampToViewport(position: Position, bounds: BaseBounds): Position {
  const minX = VIEWPORT_MARGIN - bounds.left;
  const maxX = window.innerWidth - VIEWPORT_MARGIN - bounds.right;
  const minY = VIEWPORT_MARGIN - bounds.top;
  const maxY = window.innerHeight - VIEWPORT_MARGIN - bounds.bottom;
  return {
    x: minX <= maxX ? Math.min(maxX, Math.max(minX, position.x)) : 0,
    y: minY <= maxY ? Math.min(maxY, Math.max(minY, position.y)) : 0,
  };
}

export function useDialogWindowMovement(title: string, open: boolean) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<Position>(CENTER);
  const positionRef = useRef(position);
  const [dragging, setDragging] = useState(false);
  const [canMove, setCanMove] = useState(desktopCanMove);

  const commitPosition = useCallback((next: Position) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  const currentBounds = useCallback((): BaseBounds | null => {
    const dialog = dialogRef.current;
    if (!dialog) return null;
    const rect = dialog.getBoundingClientRect();
    const current = positionRef.current;
    return {
      left: rect.left - current.x,
      top: rect.top - current.y,
      right: rect.right - current.x,
      bottom: rect.bottom - current.y,
    };
  }, []);

  const moveTo = useCallback((next: Position) => {
    if (!canMove || !open) return;
    const bounds = currentBounds();
    commitPosition(bounds ? clampToViewport(next, bounds) : next);
  }, [canMove, commitPosition, currentBounds, open]);

  const moveBy = useCallback((x: number, y: number) => {
    moveTo({ x: positionRef.current.x + x, y: positionRef.current.y + y });
  }, [moveTo]);

  const center = useCallback(() => commitPosition(CENTER), [commitPosition]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 840px) and (min-height: 520px)");
    const update = () => {
      setCanMove(media.matches);
      if (!media.matches) commitPosition(CENTER);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [commitPosition]);

  useEffect(() => {
    if (open) center();
    dragRef.current = null;
    setDragging(false);
  }, [center, open]);

  useEffect(() => {
    if (!open || !canMove) return;
    const keepInView = () => moveTo(positionRef.current);
    window.addEventListener("resize", keepInView);
    window.visualViewport?.addEventListener("resize", keepInView);
    return () => {
      window.removeEventListener("resize", keepInView);
      window.visualViewport?.removeEventListener("resize", keepInView);
    };
  }, [canMove, moveTo, open]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!canMove || !open || !event.isPrimary || event.button !== 0) return;
    if (event.target instanceof Element
      && event.target.closest("button, a, input, select, textarea, summary, [contenteditable='true'], [role='menu'], [role='menuitem'], [role='listbox'], [role='option'], [data-radix-popper-content-wrapper], [data-dialog-drag-ignore]")) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    const current = positionRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      position: current,
      bounds: {
        left: rect.left - current.x,
        top: rect.top - current.y,
        right: rect.right - current.x,
        bottom: rect.bottom - current.y,
      },
    };
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, [canMove, open]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    commitPosition(clampToViewport({
      x: drag.position.x + event.clientX - drag.startX,
      y: drag.position.y + event.clientY - drag.startY,
    }, drag.bounds));
  }, [commitPosition]);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!canMove || !open || event.target !== event.currentTarget) return;
    if (event.key === "Home") {
      event.preventDefault();
      center();
      return;
    }
    const step = event.shiftKey ? MOVE_STEP * 2 : MOVE_STEP;
    const delta: Record<string, Position> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const movement = delta[event.key];
    if (!movement) return;
    event.preventDefault();
    moveBy(movement.x, movement.y);
  }, [canMove, center, moveBy, open]);

  const handleProps = {
    role: "group" as const,
    tabIndex: canMove && open ? 0 : -1,
    "aria-label": `${title}窗口移动区域。拖动可移动；聚焦后使用方向键移动，Home 键居中。`,
    "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home",
    "data-dialog-drag-handle": "",
    "data-dragging": dragging ? "true" : undefined,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    onKeyDown,
  };
  const dialogStyle = {
    "--dialog-window-x": `${position.x}px`,
    "--dialog-window-y": `${position.y}px`,
  } as CSSProperties;

  return { dialogRef, dialogStyle, handleProps, canMove, moveBy, center };
}

export function DialogPositionMenu({
  onMove,
  onCenter,
}: {
  onMove: (x: number, y: number) => void;
  onCenter: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="dialog-position-trigger shell-icon" aria-label="移动窗口" title="移动窗口">
          <Move size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="dialog-position-menu" style={{ zIndex: 90 }}>
        <DropdownMenuLabel>调整窗口位置</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onMove(0, -MOVE_STEP)}><ArrowUp />上移</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMove(0, MOVE_STEP)}><ArrowDown />下移</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMove(-MOVE_STEP, 0)}><ArrowLeft />左移</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMove(MOVE_STEP, 0)}><ArrowRight />右移</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCenter}><Move />居中</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
