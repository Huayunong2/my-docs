import type { ReviewKind } from "./api";

function cleanJson(raw: string) {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function text(value: any, key: string) {
  return typeof value?.[key] === "string" ? value[key].trim() : "";
}

function items(value: any, key: string) {
  const arr = Array.isArray(value?.[key]) ? value[key] : [];
  return arr
    .map((item: any) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      const body = typeof item.text === "string" ? item.text.trim() : typeof item.content === "string" ? item.content.trim() : "";
      const dates = Array.isArray(item.source_dates) ? item.source_dates.filter(Boolean).join("、") : "";
      return body && dates ? `${body}（${dates}）` : body;
    })
    .filter(Boolean);
}

function list(lines: string[], empty: string) {
  return lines.length ? lines.map((line) => `- ${line}`).join("\n\n") : empty;
}

function unescapeJsonString(value: string) {
  return value
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\\/g, "\\")
    .trim();
}

function recoverLegacyJson(raw: string) {
  const cleaned = cleanJson(raw);
  if (!cleaned.startsWith("{") || !cleaned.includes("\"overview\"")) return null;
  const overview = cleaned.match(/"overview"\s*:\s*"([\s\S]*?)"\s*,\s*"facts"/)?.[1] || "";
  const readSection = (name: string, nextNames: string[]) => {
    const next = nextNames.map((key) => `"${key}"\\s*:`).join("|");
    const re = new RegExp(`"${name}"\\s*:\\s*\\[([\\s\\S]*?)\\]\\s*,\\s*(?:${next})`);
    return cleaned.match(re)?.[1] || "";
  };
  const readItems = (section: string) => {
    const result: string[] = [];
    const re = /"text"\s*:\s*"([\s\S]*?)"\s*,\s*"source_dates"\s*:\s*\[([\s\S]*?)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(section))) {
      const body = unescapeJsonString(match[1]);
      const dates = [...match[2].matchAll(/"([^"]+)"/g)].map((item) => item[1]).join("、");
      if (body) result.push(dates ? `${body}（${dates}）` : body);
    }
    return result;
  };
  const facts = readItems(readSection("facts", ["study_notes", "themes", "distillations", "review_points"]));
  const studyNotes = readItems(readSection("study_notes", ["themes", "distillations", "review_points"]));
  const themes = readItems(readSection("themes", ["distillations", "review_points"]));
  const distillations = readItems(readSection("distillations", ["review_points"]));
  const reviewPoints = readItems(readSection("review_points", []));
  if (!overview && !facts.length && !themes.length && !distillations.length) return null;
  return { overview: unescapeJsonString(overview), facts, studyNotes, themes, distillations, reviewPoints };
}

export function normalizeReviewContent(kind: ReviewKind, title: string, raw: string) {
  let value: any;
  try {
    value = JSON.parse(cleanJson(raw));
  } catch {
    const recovered = recoverLegacyJson(raw);
    if (!recovered) return raw;
    const weekly = kind === "weekly";
    return [
      `## ${title}`,
      `### ${weekly ? "本周" : "本月"}材料概览`,
      recovered.overview || `${weekly ? "本周" : "本月"}材料不足，无法形成稳定概览。`,
      "### 时间线与关键事实",
      list(recovered.facts, `${weekly ? "本周" : "本月"}没有足够明确的事实材料。`),
      "### 概念、方法与工具",
      list(recovered.studyNotes, `${weekly ? "本周" : "本月"}没有明确的概念、方法或工具沉淀。`),
      `### ${weekly ? "主题与模式" : "反复出现的主题"}`,
      list(recovered.themes, `${weekly ? "本周" : "本月"}没有形成明确主题或模式。`),
      "### 可复用沉淀",
      list(recovered.distillations, `${weekly ? "本周" : "本月"}没有可沉淀为文档的稳定结论。`),
      "### 复习要点",
      list(recovered.reviewPoints, `${weekly ? "本周" : "本月"}没有形成可复习的稳定要点。`),
    ].join("\n\n");
  }
  const weekly = kind === "weekly";
  return [
    `## ${title}`,
    `### ${weekly ? "本周" : "本月"}材料概览`,
    text(value, "overview") || `${weekly ? "本周" : "本月"}材料不足，无法形成稳定概览。`,
    "### 时间线与关键事实",
    list(items(value, "facts"), `${weekly ? "本周" : "本月"}没有足够明确的事实材料。`),
    "### 概念、方法与工具",
    list(items(value, "study_notes"), `${weekly ? "本周" : "本月"}没有明确的概念、方法或工具沉淀。`),
    `### ${weekly ? "主题与模式" : "反复出现的主题"}`,
    list(items(value, "themes"), `${weekly ? "本周" : "本月"}没有形成明确主题或模式。`),
    "### 可复用沉淀",
    list(items(value, "distillations"), `${weekly ? "本周" : "本月"}没有可沉淀为文档的稳定结论。`),
    "### 复习要点",
    list(items(value, "review_points"), `${weekly ? "本周" : "本月"}没有形成可复习的稳定要点。`),
  ].join("\n\n");
}
