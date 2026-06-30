const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;

export function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
}

export function normalizeTags(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= MAX_TAGS) break;
  }
  return result;
}

export function parseTags(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeTags(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return [];
  }
}

export function stringifyTags(tags: string[]): string {
  return JSON.stringify(normalizeTags(tags));
}

