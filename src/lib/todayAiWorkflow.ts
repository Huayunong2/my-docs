export function matchesAiSource(
  a: { date: string; content: string },
  b: { date: string; content: string },
): boolean {
  return !!a.date && a.date === b.date && a.content === b.content;
}
export function validKnowledgeCandidate(value: {
  title: string;
  content: string;
}): boolean {
  return value.title.trim().length > 0 && value.content.trim().length > 0;
}
