import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export default function MonthPicker({
  year,
  month,
  onChange,
}: {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(year);
  const grid = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 3,
      ArrowUp: -3,
    };
    let next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 11
          : moves[event.key] !== undefined
            ? (index + moves[event.key] + 12) % 12
            : null;
    if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    grid.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (value) setVisibleYear(year);
        setOpen(value);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ft-month-select"
          aria-label="选择统计月份"
        >
          {year} 年 {month} 月<ChevronDown size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="ix-month-picker"
        align="end"
        sideOffset={10}
        aria-label="选择统计月份"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() =>
            grid.current
              ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
              ?.focus(),
          );
        }}
      >
        <header>
          <button
            type="button"
            className="shell-icon"
            aria-label="上一年"
            disabled={visibleYear <= 1}
            onClick={() => setVisibleYear((value) => value - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <strong>{visibleYear} 年</strong>
          <button
            type="button"
            className="shell-icon"
            aria-label="下一年"
            disabled={visibleYear >= 9999}
            onClick={() => setVisibleYear((value) => value + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </header>
        <div className="ix-month-grid" ref={grid}>
          {Array.from({ length: 12 }, (_, index) => (
            <button
              type="button"
              key={index}
              aria-label={`${visibleYear} 年 ${index + 1} 月`}
              aria-pressed={year === visibleYear && month === index + 1}
              onKeyDown={(event) => move(event, index)}
              onClick={() => {
                onChange(visibleYear, index + 1);
                setOpen(false);
              }}
            >
              {index + 1} 月
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
