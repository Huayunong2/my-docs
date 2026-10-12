import { useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Button } from "./button";

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
  disabled = false,
  hideLabel = false,
  clearable = false,
  id,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: {
  value: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onChange: (date: string) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  clearable?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
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
        {label && !hideLabel && <div className="mb-2 text-xs text-[var(--ui-text-subtle)]">{label}</div>}
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="ui-field relative flex h-11 w-full items-center justify-center rounded-lg px-3 py-0 font-mono text-xs font-semibold sm:h-9"
            aria-label={label || "选择日期"}
          >
            <span className="truncate text-center">{value ? value.replace(/-/g, "/") : "选择日期"}</span>
            <CalendarRange size={13} className="absolute right-3 text-[var(--ui-text-subtle)]" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} aria-label="日期选择器" className="ui-calendar w-[320px] max-w-[calc(100vw-32px)] p-3">
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
          <div className="ui-calendar-grid mt-1 grid grid-cols-7 gap-1">
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
                    "ui-calendar-day inline-flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors",
                    cell === value
                      ? "ui-button-primary ui-date-picker-day-selected px-0 text-xs"
                      : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-text)]",
                  ].join(" ")}
                >
                  {Number(cell.slice(-2))}
                </button>
              ) : (
                <div key={`blank-${index}`} className="h-11 w-full" aria-hidden="true" />
              )
            ))}
          </div>
          {clearable && value && <Button variant="ghost" className="mt-3 w-full" onClick={() => { onChange(""); setOpen(false); }}><X size={14}/>清除日期</Button>}
        </PopoverContent>
      </Popover>
    </div>
  );
}
