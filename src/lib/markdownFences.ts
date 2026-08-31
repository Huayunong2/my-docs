export type MarkdownFenceIssueKind = "prefixed-fence" | "unclosed-fence";

export interface MarkdownFenceIssue {
  kind: MarkdownFenceIssueKind;
  line: number;
  lineText: string;
  message: string;
}

export interface MarkdownFenceRepairResult {
  fixedContent: string;
  issues: MarkdownFenceIssue[];
}

interface FenceState {
  marker: "`";
  length: number;
  line: number;
}

interface ParsedFenceLine {
  indent: string;
  marker: "`";
  length: number;
  info: string;
  closing: boolean;
}

const STANDARD_FENCE_RE = /^( {0,3})(`{3,})([^`\r\n]*)$/;
const PREFIXED_FENCE_RE = /^( {0,3})(\d+\s*)(`{3,})([^`\r\n]*)$/;

function parseFenceLine(line: string): ParsedFenceLine | null {
  const match = STANDARD_FENCE_RE.exec(line);
  if (!match) return null;

  const marker = match[2];
  const info = match[3].trim();
  return {
    indent: match[1],
    marker: "`",
    length: marker.length,
    info,
    closing: !info,
  };
}

function parsePrefixedFenceLine(line: string): ParsedFenceLine | null {
  const match = PREFIXED_FENCE_RE.exec(line);
  if (!match) return null;

  const marker = match[3];
  const info = match[4].trim();
  return {
    indent: match[1],
    marker: "`",
    length: marker.length,
    info,
    closing: !info,
  };
}

function isClosingFence(line: string, state: FenceState): boolean {
  const match = /^( {0,3})(`{3,})\s*$/.exec(line);
  return Boolean(match && match[2].length >= state.length);
}

function issueForPrefixedFence(lineText: string, line: number): MarkdownFenceIssue {
  return {
    kind: "prefixed-fence",
    line,
    lineText,
    message: "围栏前有行号或其他前缀，Markdown 无法识别代码块。",
  };
}

function issueForUnclosedFence(lineText: string, line: number): MarkdownFenceIssue {
  return {
    kind: "unclosed-fence",
    line,
    lineText,
    message: "代码围栏没有结束标记，后续内容可能被误解析为代码。",
  };
}

function splitContent(content: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const hasFinalNewline = /(?:\r\n|\n)$/.test(content);
  return {
    lines: content.split(/\r\n|\n/),
    newline,
    hasFinalNewline,
  };
}

function scan(content: string): { issues: MarkdownFenceIssue[]; lines: string[] } {
  const { lines } = splitContent(content);
  const issues: MarkdownFenceIssue[] = [];
  let openFence: FenceState | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] || "";
    const line = index + 1;
    const prefixed = parsePrefixedFenceLine(lineText);
    const standard = parseFenceLine(lineText);

    if (openFence) {
      if (isClosingFence(lineText, openFence)) openFence = null;
      continue;
    }

    if (prefixed && !standard) {
      issues.push(issueForPrefixedFence(lineText, line));
      if (!prefixed.closing) {
        openFence = { marker: prefixed.marker, length: prefixed.length, line };
      }
      continue;
    }

    if (!standard || standard.closing) continue;
    openFence = { marker: standard.marker, length: standard.length, line };
  }

  const unclosedFence = openFence;
  if (unclosedFence) {
    const lineText = lines[unclosedFence.line - 1] || "";
    issues.push(issueForUnclosedFence(lineText, unclosedFence.line));
  }

  return { issues, lines };
}

export function inspectMarkdownFences(content: string): MarkdownFenceIssue[] {
  return scan(content).issues;
}

export function repairMarkdownFences(content: string): MarkdownFenceRepairResult {
  const { issues, lines } = scan(content);
  if (!issues.length) return { fixedContent: content, issues };

  const { newline, hasFinalNewline } = splitContent(content);
  const repairedLines = [...lines];

  for (const issue of issues) {
    if (issue.kind !== "prefixed-fence") continue;
    const index = issue.line - 1;
    const match = PREFIXED_FENCE_RE.exec(repairedLines[index] || "");
    if (!match) continue;
    repairedLines[index] = `${match[1]}${match[3]}${match[4]}`;
  }

  const unclosed = issues.find((issue) => issue.kind === "unclosed-fence");
  if (unclosed) {
    if (hasFinalNewline && repairedLines[repairedLines.length - 1] === "") repairedLines.pop();
    const sourceLine = repairedLines[unclosed.line - 1] || "";
    const fence = parseFenceLine(sourceLine) || parsePrefixedFenceLine(sourceLine);
    if (fence && !fence.closing) {
      repairedLines.push(`${fence.marker.repeat(fence.length)}`);
    }
  }

  let fixedContent = repairedLines.join(newline);
  if (hasFinalNewline && !fixedContent.endsWith(newline)) fixedContent += newline;
  if (!hasFinalNewline && fixedContent.endsWith(newline)) fixedContent = fixedContent.slice(0, -newline.length);

  return { fixedContent, issues };
}
