import type { KnowledgeCardImportInput, KnowledgeCardType } from "./api";

export const knowledgeCardImportPrompt = `请把下面的内容整理成可复习的知识卡片，并且只输出 JSON，不要输出 Markdown 代码围栏或解释。

要求：
- 每张卡片一个对象，title 是脱离原上下文也成立的知识标题，content 是 2-5 句可复习正文。
- card_type 只能使用 fact、method、concept、decision、case、quote、principle、snippet 之一；不确定时使用 fact。
- tags 和 projects 都是字符串数组；source_excerpt 是支撑卡片的原文片段，没有可靠来源时可以省略。
- 不要把问题编号、寒暄或没有依据的推测写进卡片。

请严格使用这个格式：
{
  "cards": [
    {
      "card_type": "concept",
      "title": "一个独立成立的知识标题",
      "content": "这条知识是什么，以及为什么或如何使用。",
      "tags": ["标签"],
      "projects": ["可选空间"],
      "source_excerpt": "可选的原文依据"
    }
  ]
}

待整理内容：`;

const cardTypes = new Set<KnowledgeCardType>([
  "fact",
  "method",
  "concept",
  "decision",
  "case",
  "quote",
  "principle",
  "snippet",
]);

function charCount(value: string) {
  return [...value].length;
}

const cardTypeAliases: Record<string, KnowledgeCardType> = {
  fact: "fact",
  事实: "fact",
  method: "method",
  方法: "method",
  concept: "concept",
  概念: "concept",
  decision: "decision",
  决策: "decision",
  case: "case",
  案例: "case",
  quote: "quote",
  引用: "quote",
  principle: "principle",
  原则: "principle",
  snippet: "snippet",
  片段: "snippet",
};

export interface KnowledgeCardImportRow {
  index: number;
  card?: KnowledgeCardImportInput;
  error?: string;
}

export interface KnowledgeCardImportParseResult {
  rows: KnowledgeCardImportRow[];
  error?: string;
}

function parseMetadataLine(line: string) {
  const match = line.match(/^\s*(标签|tags?|项目|空间|projects?|source|来源|依据|evidence|source_excerpt|来源片段|来源日期|date|类型|type)\s*[:：]\s*(.*?)\s*$/i);
  if (!match) return null;
  const key = match[1].toLocaleLowerCase();
  const value = match[2].trim();
  if (/^(标签|tag|tags)$/.test(key)) return { kind: "tags" as const, value };
  if (/^(项目|空间|project|projects)$/.test(key)) return { kind: "projects" as const, value };
  if (/^(source|来源|依据|evidence|source_excerpt|来源片段)$/.test(key)) return { kind: "source_excerpt" as const, value };
  if (/^(来源日期|date)$/.test(key)) return { kind: "source_date" as const, value };
  return { kind: "card_type" as const, value };
}

function markdownBlocks(raw: string) {
  const blocks: string[][] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const isFence = /^\s*```/.test(line);
    const isHeading = !inFence && /^\s*#{1,6}\s+\S/.test(line);
    if (isHeading && current.some((item) => item.trim())) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
    if (isFence) inFence = !inFence;
  }
  if (current.some((item) => item.trim())) blocks.push(current);
  return blocks;
}

/** 解析适合手动编写的卡片 Markdown：每个 Markdown 标题代表一张卡片。 */
export function parseKnowledgeCardMarkdownImport(raw: string): KnowledgeCardImportParseResult {
  if (!raw.trim()) return { rows: [], error: "请先粘贴卡片 Markdown。" };
  const blocks = markdownBlocks(raw);
  if (!blocks.some((block) => block.some((line) => /^\s*#{1,6}\s+\S/.test(line)))) {
    return { rows: [], error: "没有发现 Markdown 标题。请用“## 卡片标题”分隔每张卡片。" };
  }
  if (blocks.length > 100) return { rows: [], error: "单次最多导入 100 张卡片，请分批处理。" };

  const rows = blocks.map((block, index): KnowledgeCardImportRow => {
    const headingIndex = block.findIndex((line) => /^\s*#{1,6}\s+\S/.test(line));
    if (headingIndex < 0) return { index, error: "每张卡片都需要一个 Markdown 标题。" };
    const title = block[headingIndex].replace(/^\s*#{1,6}\s+/, "").trim();
    const body: string[] = [];
    let tags: string[] = [];
    let projects: string[] = [];
    let sourceExcerpt = "";
    let sourceDate = "";
    let cardType = "fact";
    let inFence = false;
    for (const line of block.slice(headingIndex + 1)) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        body.push(line);
        continue;
      }
      const metadata = inFence ? null : parseMetadataLine(line);
      if (!metadata) {
        body.push(line);
        continue;
      }
      if (metadata.kind === "tags") tags = readList(metadata.value);
      else if (metadata.kind === "projects") projects = readList(metadata.value);
      else if (metadata.kind === "source_excerpt") sourceExcerpt = metadata.value;
      else if (metadata.kind === "source_date") sourceDate = metadata.value;
      else if (metadata.kind === "card_type") {
        const normalizedType = cardTypeAliases[metadata.value.toLocaleLowerCase()];
        if (normalizedType && cardTypes.has(normalizedType)) cardType = normalizedType;
      }
    }
    const content = body.join("\n").trim();
    if (!title) return { index, error: "标题不能为空。" };
    if (!content) return { index, error: "缺少正文，请在标题下补充内容。" };
    if (charCount(title) > 160) return { index, error: "标题不能超过 160 个字符。" };
    if (charCount(content) > 20000) return { index, error: "正文不能超过 20000 个字符。" };
    return {
      index,
      card: {
        card_type: cardType as KnowledgeCardType,
        title,
        content,
        tags,
        projects,
        source_date: sourceDate,
        source_excerpt: sourceExcerpt,
      },
    };
  });
  return { rows };
}

/** 直接粘贴纯文本时，明确按一张卡片处理，避免系统擅自拆分用户内容。 */
export function parseKnowledgeCardTextImport(raw: string, title: string): KnowledgeCardImportParseResult {
  const content = raw.trim();
  const normalizedTitle = title.trim();
  if (!content) return { rows: [], error: "请先粘贴卡片正文。" };
  if (!normalizedTitle) return { rows: [], error: "请填写这张卡片的标题。" };
  if (charCount(normalizedTitle) > 160) return { rows: [], error: "标题不能超过 160 个字符。" };
  if (charCount(content) > 20000) return { rows: [], error: "正文不能超过 20000 个字符。" };
  return {
    rows: [{
      index: 0,
      card: {
        card_type: "fact",
        title: normalizedTitle,
        content,
        tags: [],
        projects: [],
      },
    }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function readList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  if (typeof value === "string") {
    return value
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

function stripJsonFence(value: string) {
  const trimmed = value.replace(/^\uFEFF/, "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeRow(value: unknown, index: number): KnowledgeCardImportRow {
  if (!isRecord(value)) return { index, error: "必须是一个 JSON 对象" };

  const rawType = readText(value, ["card_type", "type"]);
  if (rawType && !cardTypes.has(rawType as KnowledgeCardType)) {
    return { index, error: `类型“${rawType}”不受支持` };
  }
  const title = readText(value, ["title", "question", "front", "name"]);
  const content = readText(value, ["content", "answer", "back", "explanation"]);
  if (!title) return { index, error: "缺少 title（也可使用 question）" };
  if (!content) return { index, error: "缺少 content（也可使用 answer）" };
  if (charCount(title) > 160) return { index, error: "标题不能超过 160 个字符" };
  if (charCount(content) > 20000) return { index, error: "正文不能超过 20000 个字符" };

  return {
    index,
    card: {
      card_type: (rawType || "fact") as KnowledgeCardType,
      title,
      content,
      tags: readList(value.tags),
      projects: readList(value.projects),
      source_date: readText(value, ["source_date", "date"]),
      source_excerpt: readText(value, ["source_excerpt", "source", "evidence"]),
      source_article_id: readText(value, ["source_article_id"]),
      source_review_id: readText(value, ["source_review_id"]),
    },
  };
}

export function parseKnowledgeCardImport(raw: string): KnowledgeCardImportParseResult {
  if (!raw.trim()) return { rows: [], error: "请先粘贴 AI 输出的 JSON。" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    return { rows: [], error: "JSON 格式无法解析。请让 AI 只输出 JSON，或点击下方提示词重新生成。" };
  }

  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.cards)
      ? parsed.cards
      : null;
  if (!items) {
    return { rows: [], error: "顶层格式应是卡片数组，或包含 cards 数组的对象。" };
  }
  if (items.length === 0) return { rows: [], error: "没有找到可导入的卡片。" };
  if (items.length > 100) return { rows: [], error: "单次最多导入 100 张卡片，请分批处理。" };
  return { rows: items.map(normalizeRow) };
}
