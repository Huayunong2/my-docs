import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Folder } from "lucide-react";
import type { KnowledgeProject } from "../../lib/api";
import { cn } from "../../lib/utils";

type SpaceAutocompleteProps = {
  spaces: KnowledgeProject[];
  value: string;
  onChange: (value: string) => void;
  onSelect?: (name: string) => void;
  onEnter?: () => void;
  onComma?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlurCommit?: () => void;
  placeholder?: string;
  ariaLabel: string;
  inputClassName?: string;
  containerClassName?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  allowCustom?: boolean;
  showIcon?: boolean;
};

function spaceMatches(space: KnowledgeProject, query: string) {
  if (!query) return true;
  return space.name.toLocaleLowerCase().includes(query);
}

export default function SpaceAutocomplete({
  spaces,
  value,
  onChange,
  onSelect,
  onEnter,
  onComma,
  onKeyDown,
  onBlurCommit,
  placeholder = "选择空间",
  ariaLabel,
  inputClassName,
  containerClassName,
  disabled,
  autoFocus,
  allowCustom = true,
  showIcon = true,
}: SpaceAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedId = useId();
  const listId = `space-options-${generatedId.replace(/:/g, "")}`;
  const query = value.trim().toLocaleLowerCase();
  const suggestions = useMemo(() => {
    return spaces
      .filter((space) => space.status !== "archived" && spaceMatches(space, query))
      .sort((a, b) => {
        if (!query) return 0;
        const aName = a.name.toLocaleLowerCase();
        const bName = b.name.toLocaleLowerCase();
        const aStarts = aName.startsWith(query) ? 0 : 1;
        const bStarts = bName.startsWith(query) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name, "zh-CN");
      })
      .slice(0, 7);
  }, [query, spaces]);
  const exactMatch = spaces.some((space) => space.status !== "archived" && space.name.toLocaleLowerCase() === query);
  const showList = open && (suggestions.length > 0 || (allowCustom && !!query));

  const selectSpace = (name: string) => {
    onChange(name);
    onSelect?.(name);
    setHighlightedIndex(0);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const highlighted = suggestions[highlightedIndex];
      if (open && highlighted) {
        selectSpace(highlighted.name);
      } else {
        onEnter?.();
      }
      return;
    }
    if (event.key === "," || event.key === "，") {
      event.preventDefault();
      onComma?.();
    }
  };

  return (
    <div className={cn("relative min-w-0", containerClassName)}>
      <div className="relative">
        {showIcon && <Folder className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-text-subtle)]" size={14} />}
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => {
              setOpen(false);
              onBlurCommit?.();
            }, 120);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "w-full min-w-0 pr-9",
            inputClassName || "ui-field h-10 pl-9 text-xs",
          )}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={showList ? listId : undefined}
          aria-expanded={showList}
          aria-activedescendant={showList && suggestions[highlightedIndex] ? `${listId}-${highlightedIndex}` : undefined}
          role="combobox"
          disabled={disabled}
          autoFocus={autoFocus}
        />
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ui-text-subtle)] transition-transform",
            showList && "rotate-180",
          )}
          size={14}
        />
      </div>
      {showList && (
        <div id={listId} role="listbox" className="ui-floating-surface absolute left-0 right-0 top-full z-[95] mt-1 max-h-60 overflow-y-auto rounded-xl p-1.5 shadow-lg">
          <div className="px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-[var(--ui-text-subtle)]">
            {query ? "匹配空间" : "快速选择空间"}
          </div>
          {suggestions.map((space, index) => (
            <button
              key={space.name}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSpace(space.name)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                index === highlightedIndex ? "bg-[var(--ui-surface-selected)] text-[var(--ui-accent-text)]" : "text-[var(--ui-text)] hover:bg-[var(--ui-surface-hover)]",
              )}
            >
              <span className="ui-status-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
                <Folder size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{space.name}</span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--ui-text-subtle)]">
                  {space.kind === "project" ? "项目" : "主题"} · {space.count} 张卡片
                </span>
              </span>
              {index === highlightedIndex && <Check size={14} className="shrink-0" />}
            </button>
          ))}
          {allowCustom && query && !exactMatch && (
            <div className="mt-1 border-t border-[var(--ui-border)] px-2.5 py-2 text-[10px] leading-4 text-[var(--ui-text-subtle)]">
              未找到同名空间；按 Enter 可使用“{value.trim()}”，建议先从上方选取已有空间。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
