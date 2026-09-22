/** Display helpers only. Stored knowledge and counts remain server-owned. */
export function knowledgeExcerpt(markdown: string, limit = 180): string {
  const plain = markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Strip known HTML markup, not C++ templates or comparison operators.
    .replace(
      /<\/?(?:p|br|div|span|strong|em|a|img|blockquote|h[1-6]|ul|ol|li|pre|code)(?:\s[^>]*)?\s*\/?>/gi,
      " ",
    )
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[*`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(plain);
  const length = Math.max(0, Math.floor(limit));
  return characters.length > length
    ? `${characters.slice(0, length).join("")}…`
    : plain;
}

export function knowledgeDate(value?: string): string {
  if (!value) return "未记录";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : "未记录";
}

export function isKnowledgeShortcut(
  event: Pick<
    KeyboardEvent,
    "target" | "isComposing" | "ctrlKey" | "metaKey" | "altKey"
  >,
): boolean {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
    return false;
  const target = event.target;
  if (typeof Element === "undefined" || !(target instanceof Element))
    return true;
  return !target.closest(
    'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .cm-editor',
  );
}
