/** Client-side guidance only; the server remains the authority for imports. */
export function importFileError(
  file: { name: string; size: number },
  mode: "ai" | "manual",
): string {
  if (
    !/\.(md|markdown|txt|json)$/i.test(file.name) ||
    (mode === "ai" && /\.json$/i.test(file.name))
  ) {
    return "请选择受支持的文本文件。";
  }
  if (file.size > 8_000_000) return "文件不能超过 8 MB，请拆分后再导入。";
  return "";
}

export function hasIncompleteImportCandidates(
  cards: ReadonlyArray<{ title: string; content: string }>,
): boolean {
  return cards.some((card) => !card.title.trim() || !card.content.trim());
}
