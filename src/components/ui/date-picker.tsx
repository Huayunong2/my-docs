import { useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export default function DatePickerPopover({
  value,
  open,
  onOpenChange,
  onChange,
  label,
  className = "",
}: {
  value: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onChange: (date: string) => void;
  label?: string;
  className?: string;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = open ?? uncontrolledOpen;
  const [viewDate, setViewDate] = useState(() => parseDate(value));
  const selectedDate = useMemo(() => parseDate(value), [value]);

  useEffect(() => {
    if (isOpen) setViewDate(selectedDate);
  }, [isOpen, selectedDate]);

  const setOpen = (nextOpen: boolean) => {
    if (!isControlled) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: firstDay.getDay() }, () => ""),
    ...Array.from({ length: daysInMonth }, (_, index) => formatDate(new Date(year, month, index + 1))),
  ];

  return (
    <div className={`relative min-w-0 ${label ? "sm:w-[168px]" : ""} ${className}`}>
      <Popover open={isOpen} onOpenChange={setOpen}>
        {label && <div className="mb-1 text-xs text-[var(--ui-text-subtle)]">{label}</div>}
        <PopoverTrigger asChild>
          <button
            type="button"
            className="ui-field relative flex h-11 w-full items-center justify-center rounded-lg px-3 py-0 font-mono text-xs font-semibold sm:h-9"
            aria-label={label || "选择日期"}
          >
            <span className="truncate text-center">{value.replace(/-/g, "/")}</span>
            <CalendarRange size={13} className="absolute right-3 text-[var(--ui-text-subtle)]" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} aria-label="日期选择器" className="w-[280px] p-3">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              className="ui-icon-button h-10 w-10 sm:h-8 sm:w-8"
              aria-label="上个月"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="text-sm font-semibold text-[var(--ui-text)]">{year} 年 {month + 1} 月</div>
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              className="ui-icon-button h-10 w-10 sm:h-8 sm:w-8"
              aria-label="下个月"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-[var(--ui-text-subtle)]">
            {weekdays.map((day) => <div key={day} className="py-1">{day}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 justify-items-center gap-1">
            {cells.map((cell, index) => (
              cell ? (
                <button
                  key={cell}
                  type="button"
                  onClick={() => {
                    onChange(cell);
                    setOpen(false);
                  }}
                  className={[
                    "inline-flex h-10 w-10 items-center justify-center rounded-lg text-xs font-medium transition-colors sm:h-8 sm:w-8",
                    cell === value
                      ? "ui-button-primary ui-date-picker-day-selected px-0 text-xs"
                      : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-text)]",
                  ].join(" ")}
                >
                  {Number(cell.slice(-2))}
                </button>
              ) : (
                <div key={`blank-${index}`} className="h-10 w-10 sm:h-8 sm:w-8" aria-hidden="true" />
              )
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
