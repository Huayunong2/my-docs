import type { Page } from "../App";

export const pageShortcuts: Record<string, Page> = {
  "1": "today",
  "2": "history",
  "3": "archive",
  "4": "search",
  "5": "stats",
  "6": "reviews",
  "7": "knowledge",
  "8": "settings",
  "9": "review",
};
export const shortcutForPage: Partial<Record<Page, string>> = {
  today: "1",
  history: "2",
  search: "4",
  stats: "5",
  reviews: "6",
  knowledge: "7",
  settings: "8",
  review: "9",
};
export function navigationIndex(
  key: string,
  index: number,
  count: number,
): number | null {
  if (!count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (index + 1 + count) % count;
  if (key === "ArrowUp") return (index - 1 + count) % count;
  return null;
}
export function isInteractionBlocked(
  event: Pick<KeyboardEvent, "target" | "isComposing" | "defaultPrevented">,
): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  if (typeof Element === "undefined") return false;
  return (
    event.target instanceof Element &&
    !!event.target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .cm-editor',
    )
  );
}
