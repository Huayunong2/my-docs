// API layer — 桌面端和浏览器统一走服务器 HTTP，同源部署默认使用 /api。
import { normalizeTags, parseTags } from "./tags";
import { readLocalStorage, removeLocalStorage, writeLocalStorage } from "./storage";

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

export function isDesktopClient(): boolean {
  return isTauri();
}

function toUserMessage(status: number, text: string): string {
  if (status === 0) return "无法连接服务器，请检查服务器地址、网络或服务状态。";
  if (status === 401) return "访问令牌无效或未填写，请在设置页重新保存令牌。";
  if (status === 403) return "当前来源未被服务器允许访问，请检查服务端 CORS 配置。";
  if (status === 404) return "请求的内容不存在。";
  if (status === 502 && text) return text;
  if (status >= 500) return `服务器内部错误：${text || status}`;
  return text || `请求失败：HTTP ${status}`;
}

export class ApiError extends Error {
  status: number;
  rawMessage: string;
  userMessage: string;

  constructor(status: number, rawMessage: string, userMessage?: string) {
    super(userMessage || rawMessage || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.rawMessage = rawMessage;
    this.userMessage = userMessage || toUserMessage(status, rawMessage);
  }
}

type ReadRequestOptions = Pick<RequestInit, "signal">;

function getBaseUrl(): string {
  const configured = normalizeBaseUrl(readLocalStorage("server_url") || "");
  // In Tauri, relative paths are invalid — skip them
  if (configured && (!isTauri() || configured.startsWith("http"))) return configured;
  const envUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || "");
  if (envUrl) return envUrl;
  if (isTauri()) return "";
  return "/api";
}

function buildUrl(path: string): string {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new ApiError(
      0,
      "Desktop client server URL is not configured",
      "桌面端尚未配置服务器地址，请到「设置 -> 连接」填写 http://服务器IP:8080/api 并保存。"
    );
  }
  return `${baseUrl}${path}`;
}

function authHeaders(options?: RequestInit, includeJson = true): Headers {
  const headers = new Headers(options?.headers);
  if (includeJson) headers.set("Content-Type", "application/json");
  const token = getApiToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  const text = await res.text();
  return new ApiError(res.status, text, toUserMessage(res.status, text));
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return String(error || "未知错误");
}

function httpRequest<T>(path: string, options?: RequestInit): Promise<T> {
  return fetch(buildUrl(path), {
    ...options,
    headers: authHeaders(options),
  }).then(async (res) => {
    if (!res.ok) {
      throw await parseErrorResponse(res);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }).catch((e) => {
    if (e instanceof TypeError) throw new ApiError(0, e.message);
    throw e;
  });
}

export function getServerUrl(): string {
  const configured = readLocalStorage("server_url");
  if (configured && (!isTauri() || configured.startsWith("http"))) return configured;
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (isTauri()) return "";
  return "/api";
}

export function setServerUrl(url: string) {
  const normalized = normalizeBaseUrl(url);
  if (normalized && normalized !== "/api") {
    writeLocalStorage("server_url", normalized);
  } else {
    removeLocalStorage("server_url");
  }
}

export function validateServerUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed && isTauri()) return "桌面端必须填写服务器地址，例如 http://服务器IP:8080/api";
  if (!trimmed || trimmed === "/api") return "";
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return "服务器地址必须是 http 或 https";
    if (parsed.protocol === "http:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return "公网 HTTP 可以使用，但记录和令牌不会加密传输";
    }
    return "";
  } catch {
    return "服务器地址格式不正确";
  }
}

export function getApiToken(): string {
  const current = readLocalStorage("server_token") || "";
  if (current) return current;
  const legacy = readLocalStorage("api_token") || "";
  if (legacy) {
    writeLocalStorage("server_token", legacy);
    removeLocalStorage("api_token");
  }
  return legacy;
}

export function setApiToken(token: string) {
  const trimmed = token.trim();
  if (trimmed) {
    writeLocalStorage("server_token", trimmed);
    removeLocalStorage("api_token");
  } else {
    removeLocalStorage("server_token");
    removeLocalStorage("api_token");
  }
}

// ── Articles ────────────────────────────────────────

export interface Article {
  id: string; date: string; title: string; content: string;
  mood: string; tags: string[]; spaces?: string[]; word_count: number; created_at: string; updated_at: string;
}

export interface ArticleSummary {
  id: string; date: string; title: string; mood: string; tags: string[]; spaces?: string[]; word_count: number; preview: string;
}

function readTagList(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeTags(value.filter((item): item is string => typeof item === "string"));
  return typeof value === "string" ? parseTags(value) : [];
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapArticle<T extends Article | ArticleSummary>(value: T): T {
  return { ...value, tags: readTagList(value.tags), spaces: readStringList(value.spaces) };
}

export function createArticle(payload: { date: string; title: string; content: string; mood: string; tags?: string[]; spaces?: string[] }) {
  return httpRequest<Article>("/articles", { method: "POST", body: JSON.stringify(payload) }).then(mapArticle);
}

export function updateArticle(id: string, payload: { title: string; content: string; mood: string; tags?: string[]; spaces?: string[] }) {
  return httpRequest<Article>(`/articles/${id}`, { method: "PUT", body: JSON.stringify(payload) }).then(mapArticle);
}

export function importArticles(articles: Array<{ date: string; title: string; content: string; mood: string; tags?: string[]; spaces?: string[] }>) {
  return httpRequest<{ imported: number; skipped: number }>("/articles/import", { method: "POST", body: JSON.stringify(articles) });
}

export function exportFullBackup() {
  return httpRequest<{ version: number; articles: any[]; reviews: any[]; knowledge_cards?: any[]; knowledge_projects?: string[] }>("/export/full", { method: "POST", body: "{}" });
}

export function importFullBackup(data: any) {
  return httpRequest<{ imported_articles: number; imported_reviews: number; imported_knowledge_cards?: number }>("/articles/import-full", { method: "POST", body: JSON.stringify(data) });
}

export function deleteArticle(id: string) {
  return httpRequest<void>(`/articles/${id}`, { method: "DELETE" });
}

export function getArticle(id: string) {
  return httpRequest<Article>(`/articles/${id}`).then(mapArticle);
}

export function getTodayArticle(date: string) {
  return httpRequest<Article | null>(`/articles/today?date=${encodeURIComponent(date)}`).then((article) => article ? mapArticle(article) : null);
}

export function listArticles(page: number, pageSize: number) {
  return httpRequest<ArticleSummary[]>(`/articles?page=${page}&page_size=${pageSize}`).then((items) => items.map(mapArticle));
}

export function listSpaceArticles(space: string, page = 1, pageSize = 12, options?: ReadRequestOptions) {
  return httpRequest<ArticleSummary[]>(`/spaces/${encodeURIComponent(space)}/articles?page=${page}&page_size=${pageSize}`, options)
    .then((items) => items.map(mapArticle));
}

export function searchArticles(query: string, options?: ReadRequestOptions) {
  return httpRequest<ArticleSummary[]>(`/articles/search?q=${encodeURIComponent(query)}`, options).then((items) => items.map(mapArticle));
}

// ── Knowledge cards ─────────────────────────────────

export type KnowledgeCardType = "fact" | "method" | "concept" | "decision" | "case" | "quote" | "principle" | "snippet";
export type KnowledgeCardStatus = "draft" | "confirmed" | "outdated";

export interface KnowledgeCard {
  id: string;
  card_type: KnowledgeCardType;
  status: KnowledgeCardStatus;
  title: string;
  content: string;
  tags: string[];
  source_article_id: string;
  source_review_id: string;
  source_date: string;
  source_excerpt: string;
  created_at: string;
  updated_at: string;
  content_version?: number;
  review_state?: string;
  review_interval_days?: number;
  review_ease?: number;
  review_count?: number;
  last_reviewed_at?: string;
  next_review_at?: string;
  usage_count?: number;
  last_used_at?: string;
  related_ids?: string[];
  declared_related_ids?: string[];
  first_reviewed_at?: string;
  projects?: string[];
}

/** 外部 AI 批量导入使用的最小卡片格式；服务端会统一按草稿保存。 */
export interface KnowledgeCardImportInput {
  card_type: KnowledgeCardType;
  title: string;
  content: string;
  tags?: string[];
  projects?: string[];
  source_article_id?: string;
  source_review_id?: string;
  source_date?: string;
  source_excerpt?: string;
}

export interface KnowledgeCardCandidate {
  card_type: KnowledgeCardType;
  title: string;
  content: string;
  tags: string[];
  projects: string[];
  source_excerpt: string;
}

export type KnowledgeAnalyzeJobStatus = "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";

export interface KnowledgeAnalyzeJobCreated {
  job_id: string;
  status: KnowledgeAnalyzeJobStatus;
  total_chars: number;
  total_chunks: number;
  max_cards: number;
}

export interface KnowledgeAnalyzeJobChunk {
  index: number;
  start_char: number;
  end_char: number;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  attempts: number;
  card_count: number;
  error?: string | null;
}

export interface KnowledgeAnalyzeJobBatch {
  index: number;
  start_char: number;
  end_char: number;
  cards: KnowledgeCardCandidate[];
}

export interface KnowledgeAnalyzeJob {
  job_id: string;
  status: KnowledgeAnalyzeJobStatus;
  source_name: string;
  total_chars: number;
  total_chunks: number;
  finished_chunks: number;
  completed_chunks: number;
  failed_chunks: number;
  skipped_chunks: number;
  active_chunk?: number | null;
  progress_percent: number;
  max_cards: number;
  cards: KnowledgeCardCandidate[];
  batches: KnowledgeAnalyzeJobBatch[];
  skipped_cards: number;
  model: string;
  error?: string | null;
  chunks: KnowledgeAnalyzeJobChunk[];
}

export interface KnowledgeTagCount {
  tag: string;
  count: number;
}

export type SpaceKind = "topic" | "project";
export type SpaceStatus = "active" | "archived";

/** 统一空间目录：topic 是长期领域，project 是有生命周期的目标。 */
export interface KnowledgeProject {
  name: string;
  count: number;
  /** Knowledge-card count; daily records are tracked separately. */
  article_count?: number;
  total_count?: number;
  kind?: SpaceKind;
  description?: string;
  status?: SpaceStatus;
}

export type ReviewItemType = "basic" | "cloze" | "code" | "compare" | "scenario";
export type ReviewItemStatus = "active" | "suspended" | "stale";

export interface ReviewItem {
  id: string;
  knowledge_card_id: string;
  item_type: ReviewItemType;
  status: ReviewItemStatus;
  prompt: string;
  answer: string;
  hint: string;
  source_version: number;
  created_at: string;
  updated_at: string;
  review_state: string;
  review_interval_days: number;
  review_ease: number;
  review_count: number;
  last_reviewed_at: string;
  next_review_at: string;
  first_reviewed_at: string;
}

/** 复习队列的轻量对象，不包含知识条目全文。 */
export interface ReviewCard {
  id: string;
  knowledge_card_id: string;
  item_type: ReviewItemType;
  item_status: ReviewItemStatus;
  prompt: string;
  answer: string;
  hint: string;
  title: string;
  card_type: KnowledgeCardType;
  card_status: KnowledgeCardStatus;
  tags: string[];
  source_article_id: string;
  source_review_id: string;
  source_date: string;
  source_excerpt: string;
  related_ids: string[];
  projects: string[];
  created_at: string;
  updated_at: string;
  review_state: string;
  review_interval_days: number;
  review_ease: number;
  review_count: number;
  last_reviewed_at: string;
  next_review_at: string;
  first_reviewed_at: string;
}

export interface KnowledgeCardsPage {
  cards: KnowledgeCard[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface KnowledgeSummary {
  total: number;
  draft: number;
  confirmed: number;
  outdated: number;
  missing_source: number;
  missing_project: number;
  missing_tags: number;
  short_content: number;
}

export type KnowledgeCardQuality = "missing_source" | "missing_project" | "missing_tags" | "short_content";

export type KnowledgeCardSort = "updated" | "created" | "usage" | "review";

export interface KnowledgeViewFilters {
  q?: string;
  project?: string;
  tag?: string;
  status?: KnowledgeCardStatus | "all";
  type?: KnowledgeCardType;
  usage?: "never_used";
  sort?: KnowledgeCardSort;
  quality?: KnowledgeCardQuality;
}

export interface KnowledgeSavedView {
  id: string;
  name: string;
  filters: KnowledgeViewFilters;
  created_at: string;
  updated_at: string;
}

export const knowledgeQueryKeys = {
  cards: (filters: Record<string, string>) => ["knowledgeCards", "filtered", filters] as const,
  allCards: ["knowledgeCards", "all"] as const,
  cardsRoot: ["knowledgeCards"] as const,
  card: (id: string) => ["knowledgeCards", "card", id] as const,
  summary: ["knowledgeCards", "summary"] as const,
  tags: ["knowledgeTags"] as const,
  projects: ["knowledgeProjects"] as const,
  spaces: ["knowledgeProjects"] as const,
  savedViews: ["knowledgeSavedViews"] as const,
  reviewItems: (cardId: string) => ["knowledgeReviewItems", cardId] as const,
  search: (scope: "articles" | "cards", query: string, page = 1, pageSize = 24) => ["knowledgeSearch", scope, { query, page, pageSize }] as const,
};

export const reviewQueryKeys = {
  settings: ["reviewSettings"] as const,
  preview: (cardId: string) => ["reviewPreview", cardId] as const,
};

function mapKnowledgeCard(card: KnowledgeCard): KnowledgeCard {
  return {
    ...card,
    tags: readTagList(card.tags),
    projects: readStringList(card.projects),
    related_ids: readStringList(card.related_ids),
    declared_related_ids: readStringList(card.declared_related_ids),
  };
}

function mapKnowledgeCardCandidate(card: KnowledgeCardCandidate): KnowledgeCardCandidate {
  return {
    ...card,
    tags: readTagList(card.tags),
    projects: readStringList(card.projects),
    source_excerpt: typeof card.source_excerpt === "string" ? card.source_excerpt : "",
  };
}

function mapKnowledgeAnalyzeJob(job: KnowledgeAnalyzeJob): KnowledgeAnalyzeJob {
  return {
    ...job,
    cards: Array.isArray(job.cards) ? job.cards.map(mapKnowledgeCardCandidate) : [],
    batches: Array.isArray(job.batches)
      ? job.batches.map((batch) => ({ ...batch, cards: Array.isArray(batch.cards) ? batch.cards.map(mapKnowledgeCardCandidate) : [] }))
      : [],
    chunks: Array.isArray(job.chunks) ? job.chunks : [],
  };
}

function mapReviewCard(card: ReviewCard): ReviewCard {
  return {
    ...card,
    tags: readTagList(card.tags),
    related_ids: readStringList(card.related_ids),
    projects: readStringList(card.projects),
  };
}

export function listKnowledgeCards(filters: { card_type?: string; status?: string; q?: string; usage?: "never_used"; tag?: string; project?: string; quality?: KnowledgeCardQuality } = {}, options?: ReadRequestOptions) {
  const params = new URLSearchParams();
  if (filters.card_type) params.set("card_type", filters.card_type);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.usage) params.set("usage", filters.usage);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.project) params.set("project", filters.project);
  if (filters.quality) params.set("quality", filters.quality);
  const query = params.toString();
  return httpRequest<KnowledgeCard[]>(`/knowledge-cards${query ? `?${query}` : ""}`, options).then((items) => items.map(mapKnowledgeCard));
}

export function getKnowledgeCard(id: string, options?: ReadRequestOptions) {
  return httpRequest<KnowledgeCard>(`/knowledge-cards/${encodeURIComponent(id)}`, options).then(mapKnowledgeCard);
}

export function getKnowledgeSummary(options?: ReadRequestOptions) {
  return httpRequest<KnowledgeSummary>("/knowledge-cards/summary", options);
}

export function listDeletedKnowledgeCards(options?: ReadRequestOptions) {
  return httpRequest<KnowledgeCard[]>("/knowledge-cards/trash", options).then((items) => items.map(mapKnowledgeCard));
}

export function queryKnowledgeCards(filters: {
  card_type?: string;
  status?: string;
  q?: string;
  usage?: "never_used";
  tag?: string;
  project?: string;
  quality?: KnowledgeCardQuality;
  sort?: "updated" | "created" | "usage" | "review";
  page?: number;
  page_size?: number;
} = {}, options?: ReadRequestOptions) {
  const params = new URLSearchParams();
  if (filters.card_type) params.set("card_type", filters.card_type);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.usage) params.set("usage", filters.usage);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.project) params.set("project", filters.project);
  if (filters.quality) params.set("quality", filters.quality);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.page_size) params.set("page_size", String(filters.page_size));
  const query = params.toString();
  return httpRequest<KnowledgeCardsPage>(`/knowledge-cards/query${query ? `?${query}` : ""}`, options).then((result) => ({
    ...result,
    cards: result.cards.map(mapKnowledgeCard),
  }));
}

export function listKnowledgeTags(options?: ReadRequestOptions) {
  return httpRequest<KnowledgeTagCount[]>("/knowledge-cards/tags", options);
}

export function listKnowledgeProjects(options?: ReadRequestOptions) {
  return httpRequest<Array<KnowledgeProject | { tag: string; count: number }>>("/knowledge-cards/projects", options).then((items) =>
    items.map((item) => "name" in item ? mapSpace(item) : { name: item.tag, count: item.count, article_count: 0, total_count: item.count, kind: "project" as const, description: "", status: "active" as const })
  );
}

export function createKnowledgeProject(name: string) {
  return httpRequest<KnowledgeProject>("/knowledge-cards/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  }).then(mapSpace);
}

export function listKnowledgeSavedViews(options?: ReadRequestOptions) {
  return httpRequest<KnowledgeSavedView[]>("/knowledge-cards/views", options);
}

export function createKnowledgeSavedView(name: string, filters: KnowledgeViewFilters) {
  return httpRequest<KnowledgeSavedView>("/knowledge-cards/views", {
    method: "POST",
    body: JSON.stringify({ name, filters }),
  });
}

export function updateKnowledgeSavedView(id: string, payload: Partial<{ name: string; filters: KnowledgeViewFilters }>) {
  return httpRequest<KnowledgeSavedView>(`/knowledge-cards/views/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteKnowledgeSavedView(id: string) {
  return httpRequest<void>(`/knowledge-cards/views/${encodeURIComponent(id)}`, { method: "DELETE" });
}

function mapSpace(space: KnowledgeProject): KnowledgeProject {
  return {
    ...space,
    article_count: typeof space.article_count === "number" ? space.article_count : 0,
    total_count: typeof space.total_count === "number" ? space.total_count : space.count,
    kind: space.kind === "topic" ? "topic" : "project",
    description: typeof space.description === "string" ? space.description : "",
    status: space.status === "archived" ? "archived" : "active",
  };
}

export function listSpaces(options?: ReadRequestOptions, includeArchived = false) {
  const query = includeArchived ? "?include_archived=true" : "";
  return httpRequest<KnowledgeProject[]>(`/spaces${query}`, options).then((items) => items.map(mapSpace));
}

export function createSpace(name: string, kind: SpaceKind = "topic", description = "") {
  return httpRequest<KnowledgeProject>("/spaces", {
    method: "POST",
    body: JSON.stringify({ name, kind, description }),
  }).then(mapSpace);
}

export function updateSpace(currentName: string, payload: { name: string; kind: SpaceKind; description: string }) {
  return httpRequest<KnowledgeProject>(`/spaces/${encodeURIComponent(currentName)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }).then(mapSpace);
}

/** 空间归档是可逆的“删除”：不影响日报、知识条目或复习进度。 */
export function archiveSpace(name: string) {
  return httpRequest<void>(`/spaces/${encodeURIComponent(name)}/archive`, { method: "POST", body: "{}" });
}

export function restoreSpace(name: string) {
  return httpRequest<KnowledgeProject>(`/spaces/${encodeURIComponent(name)}/restore`, {
    method: "POST",
    body: "{}",
  }).then(mapSpace);
}

/** 只接受已归档空间；删除的是空间和归属关系，不删除其中的内容。 */
export function deleteSpacePermanently(name: string) {
  return httpRequest<void>(`/spaces/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function batchKnowledgeCards(payload: {
  ids: string[];
  action: "confirm" | "set_status" | "add_tags" | "remove_tags" | "add_projects" | "set_projects" | "remove_projects" | "delete" | "restore";
  values?: string[];
}) {
  return httpRequest<{ updated: number }>("/knowledge-cards/batch", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function restoreKnowledgeCards(ids: string[]) {
  return batchKnowledgeCards({ ids, action: "restore" });
}

export function createKnowledgeCard(payload: {
  card_type: KnowledgeCardType;
  status?: KnowledgeCardStatus;
  title: string;
  content: string;
  tags?: string[];
  projects?: string[];
  source_article_id?: string;
  source_review_id?: string;
  source_date?: string;
  source_excerpt?: string;
  related_ids?: string[];
}) {
  return httpRequest<KnowledgeCard>("/knowledge-cards", { method: "POST", body: JSON.stringify(payload) }).then(mapKnowledgeCard);
}

export function importKnowledgeCards(cards: KnowledgeCardImportInput[]) {
  return httpRequest<{ cards: KnowledgeCard[]; imported: number; skipped: number }>("/knowledge-cards/import", {
    method: "POST",
    body: JSON.stringify({ cards }),
  }).then((result) => ({ ...result, cards: result.cards.map(mapKnowledgeCard) }));
}

export function analyzeKnowledgeCards(payload: { content: string; source_name?: string; max_cards?: number }) {
  return httpRequest<{ cards: KnowledgeCardCandidate[]; skipped: number; model: string }>("/knowledge-cards/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((result) => ({
    ...result,
    cards: result.cards.map((card) => ({
      ...card,
      tags: readTagList(card.tags),
      projects: readStringList(card.projects),
      source_excerpt: typeof card.source_excerpt === "string" ? card.source_excerpt : "",
    })),
  }));
}

export function createKnowledgeAnalyzeJob(payload: { content: string; source_name?: string; max_cards?: number }) {
  return httpRequest<KnowledgeAnalyzeJobCreated>("/knowledge-cards/analyze-jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getKnowledgeAnalyzeJob(jobId: string, options?: ReadRequestOptions) {
  return httpRequest<KnowledgeAnalyzeJob>(`/knowledge-cards/analyze-jobs/${encodeURIComponent(jobId)}`, options).then(mapKnowledgeAnalyzeJob);
}

export function retryKnowledgeAnalyzeJob(jobId: string) {
  return httpRequest<KnowledgeAnalyzeJob>(`/knowledge-cards/analyze-jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: "{}",
  }).then(mapKnowledgeAnalyzeJob);
}

export function cancelKnowledgeAnalyzeJob(jobId: string) {
  return httpRequest<KnowledgeAnalyzeJob>(`/knowledge-cards/analyze-jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  }).then(mapKnowledgeAnalyzeJob);
}

export function extractKnowledgeCards(payload: {
  content: string;
  source_article_id?: string;
  source_review_id?: string;
  source_date?: string;
  max_cards?: number;
}) {
  return httpRequest<{ cards: KnowledgeCard[]; skipped: number }>("/knowledge-cards/extract", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((res) => ({ ...res, cards: res.cards.map(mapKnowledgeCard) }));
}

export function updateKnowledgeCard(id: string, payload: Partial<{
  card_type: KnowledgeCardType;
  status: KnowledgeCardStatus;
  title: string;
  content: string;
  tags: string[];
  projects: string[];
  source_article_id: string;
  source_review_id: string;
  source_date: string;
  source_excerpt: string;
  related_ids: string[];
}>) {
  return httpRequest<KnowledgeCard>(`/knowledge-cards/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }).then(mapKnowledgeCard);
}

export function deleteKnowledgeCard(id: string) {
  return httpRequest<void>(`/knowledge-cards/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listKnowledgeReviewItems(cardId: string, options?: ReadRequestOptions) {
  return httpRequest<ReviewItem[]>(`/knowledge-cards/${encodeURIComponent(cardId)}/review-items`, options);
}

export function createKnowledgeReviewItem(cardId: string, payload: {
  item_type?: ReviewItemType;
  prompt: string;
  answer: string;
  hint?: string;
  status?: ReviewItemStatus;
}) {
  return httpRequest<ReviewItem>(`/knowledge-cards/${encodeURIComponent(cardId)}/review-items`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateKnowledgeReviewItem(id: string, payload: Partial<{
  item_type: ReviewItemType;
  prompt: string;
  answer: string;
  hint: string;
  status: ReviewItemStatus;
}>) {
  return httpRequest<ReviewItem>(`/review-items/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteKnowledgeReviewItem(id: string) {
  return httpRequest<void>(`/review-items/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Review scheduling ──────────────────────────────

export type ReviewGrade = "again" | "hard" | "good" | "easy";

export interface DueReviewStats {
  due: number;
  due_reviews: number;
  new_cards: number;
  reviewed_today: number;
  total_confirmed: number;
}

export interface DueReviewResponse {
  cards: ReviewCard[];
  stats: DueReviewStats;
}

export interface ReviewSettings {
  new_cards_per_day: number;
  session_limit: number;
}

export interface ReviewGradePreview {
  grade: ReviewGrade;
  interval_days: number;
  next_review_at: string;
}

export interface DailyReviewCount {
  date: string;
  count: number;
}

export interface ReviewStatsResponse {
  total_reviews: number;
  streak_days: number;
  reviewed_today: number;
  due: number;
  total_confirmed: number;
  learning: number;
  mature: number;
  new_cards: number;
  upcoming: DailyReviewCount[];
  daily: DailyReviewCount[];
}

export interface ReviewHistoryEntry {
  grade: string;
  interval_days: number;
  ease: number;
  next_review_at: string;
  reviewed_at: string;
  prompt_snapshot: string;
  answer_snapshot: string;
  review_item_source_version: number;
}

export function getReviewStats() {
  return httpRequest<ReviewStatsResponse>("/review/stats");
}

export function getReviewSettings() {
  return httpRequest<ReviewSettings>("/review/settings");
}

export function updateReviewSettings(payload: ReviewSettings) {
  return httpRequest<ReviewSettings>("/review/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getReviewHistory(cardId: string) {
  return httpRequest<ReviewHistoryEntry[]>(`/review/history/${encodeURIComponent(cardId)}`);
}

export function getReviewHeatmap(days = 365) {
  return httpRequest<DailyReviewCount[]>(`/review/heatmap?days=${days}`);
}

export function getDueReviewCards(limit?: number) {
  const query = typeof limit === "number" ? `?limit=${limit}` : "";
  return httpRequest<DueReviewResponse>(`/review/due${query}`).then((res) => ({
    ...res,
    cards: res.cards.map(mapReviewCard),
  }));
}

export function getReviewPreview(cardId: string, options?: ReadRequestOptions) {
  return httpRequest<ReviewGradePreview[]>(`/review/${encodeURIComponent(cardId)}/preview`, options);
}

export function gradeReviewCard(id: string, grade: ReviewGrade) {
  return httpRequest<ReviewCard>(`/review/${encodeURIComponent(id)}/grade`, {
    method: "POST",
    body: JSON.stringify({ grade }),
  }).then(mapReviewCard);
}

export function touchKnowledgeCard(id: string) {
  return httpRequest<KnowledgeCard>(`/knowledge-cards/${encodeURIComponent(id)}/touch`, {
    method: "POST",
    body: "{}",
  }).then(mapKnowledgeCard);
}

// ── Archive ─────────────────────────────────────────

export interface ArchiveMonth { year: number; month: number; }

export function getArchiveMonths() {
  return httpRequest<ArchiveMonth[]>("/archive/months");
}

export function getArticlesByMonth(year: number, month: number) {
  return httpRequest<ArticleSummary[]>(`/archive/${year}/${month}`).then((items) => items.map(mapArticle));
}

// ── Stats ───────────────────────────────────────────

export interface StatsOverview {
  days_written: number;
  current_streak: number;
  streak_exempted_days: number;
  exempted_days: number;
  missing_days: number;
  total_words: number;
  avg_words: number;
  mood_counts: Record<string, number>;
}

export interface DayExemption {
  date: string;
  reason: string;
  note: string;
  created_at?: string;
  updated_at?: string;
}

export interface MonthDayStats {
  date: string;
  has_article: boolean;
  word_count: number;
  mood: string;
  title: string;
  id: string | null;
  exemption: DayExemption | null;
}

export interface WeekReview {
  from: string;
  to: string;
  days_written: number;
  exempted_days: number;
  missing_days: string[];
  longest_article: ArticleSummary | null;
  total_words: number;
  avg_words: number;
  top_terms: { term: string; count: number }[];
}

export function getStatsOverview(from: string, to: string) {
  return httpRequest<StatsOverview>(`/stats/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export function getMonthStats(year: number, month: number) {
  return httpRequest<MonthDayStats[]>(`/stats/month?year=${year}&month=${month}`);
}

export function getWeekReview(date: string) {
  return httpRequest<WeekReview>(`/stats/week?date=${encodeURIComponent(date)}`).then((review) => ({
    ...review,
    longest_article: review.longest_article ? mapArticle(review.longest_article) : null,
  }));
}

// ── AI reviews ──────────────────────────────────────

export type ReviewKind = "weekly" | "monthly";
export type ReviewStatus = "draft" | "confirmed";

export interface Review {
  id: string;
  kind: ReviewKind;
  period_start: string;
  period_end: string;
  version: number;
  status: ReviewStatus;
  title: string;
  content: string;
  source_article_ids: string[];
  source_review_ids: string[];
  model: string;
  generated_at: string;
  updated_at: string;
}

function mapReview(review: Review): Review {
  return {
    ...review,
    source_article_ids: readStringList(review.source_article_ids),
    source_review_ids: readStringList(review.source_review_ids),
  };
}

export function listReviews(kind: ReviewKind, periodStart: string, periodEnd: string) {
  return httpRequest<Review[]>(
    `/reviews?kind=${encodeURIComponent(kind)}&period_start=${encodeURIComponent(periodStart)}&period_end=${encodeURIComponent(periodEnd)}`
  ).then((items) => items.map(mapReview));
}

export function listAllReviews(kind?: ReviewKind) {
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  return httpRequest<Review[]>(`/reviews${query}`).then((items) => items.map(mapReview));
}

export function getReview(id: string) {
  return httpRequest<Review>(`/reviews/${encodeURIComponent(id)}`).then(mapReview);
}

export function generateReview(payload: { kind: ReviewKind; date: string }) {
  return httpRequest<Review>("/reviews/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(mapReview);
}

export function updateReview(id: string, payload: { title?: string; content?: string; status?: ReviewStatus }) {
  return httpRequest<Review>(`/reviews/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }).then(mapReview);
}

export function deleteReview(id: string) {
  return httpRequest<void>(`/reviews/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface AiConfig {
  configured: boolean;
  api_key_configured: boolean;
  api_key_source: "settings" | "environment" | "none" | string;
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_secs: number;
  retries: number;
  min_interval_ms: number;
}

export interface UpdateAiConfigPayload {
  api_key?: string;
  clear_api_key?: boolean;
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_secs: number;
  retries: number;
  min_interval_ms: number;
}

export function getAiConfig() {
  return httpRequest<AiConfig>("/ai/config");
}

export function updateAiConfig(payload: UpdateAiConfigPayload) {
  return httpRequest<AiConfig>("/ai/config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export type AiTaskId = "daily_summary" | "knowledge_extract" | "weekly_review" | "monthly_review";

export interface AiModelProfile {
  id: string;
  name: string;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_secs: number;
  retries: number;
  min_interval_ms: number;
}

export interface AiRoutingConfig {
  profiles: AiModelProfile[];
  routes: Partial<Record<AiTaskId, string>>;
  fallback_profile: string;
}

export function getAiRouting() {
  return httpRequest<AiRoutingConfig>("/ai/routing");
}

export function updateAiRouting(payload: AiRoutingConfig) {
  return httpRequest<AiRoutingConfig>("/ai/routing", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function healthCheck() {
  return httpRequest<{
    version: string;
    build: string;
    features: Record<string, boolean>;
    ai_config?: {
      configured: boolean;
      api_key_configured?: boolean;
      api_key_source?: string;
      model: string;
      base_url: string;
      temperature: string;
      max_tokens: string;
      timeout_secs: string;
      retries: string;
      min_interval_ms: string;
    };
    db_path?: string;
    db_size?: number;
    last_backup?: string;
    monitoring?: {
      database_integrity: string;
      database_integrity_last_check_unix?: number | null;
      disk_usage_percent?: number | null;
      disk_usage_warning?: boolean;
      last_backup_unix?: number;
      offsite_last_success_unix?: number;
      offsite_verify_last_success_unix?: number;
      ai_consecutive_failures: number;
      ai_last_failure_unix?: number;
      ai_last_success_unix?: number;
    };
  }>("/health");
}

// ── Day exemptions ─────────────────────────────────

export function listDayExemptions(from: string, to: string) {
  return httpRequest<DayExemption[]>(`/day-exemptions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export function setDayExemption(date: string, payload: { reason: string; note?: string }) {
  return httpRequest<DayExemption>(`/day-exemptions/${encodeURIComponent(date)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteDayExemption(date: string) {
  return httpRequest<void>(`/day-exemptions/${encodeURIComponent(date)}`, { method: "DELETE" });
}

// ── Export ──────────────────────────────────────────

export function exportMarkdown(ids: string[]) {
  return httpRequest<string>("/export/md", { method: "POST", body: JSON.stringify({ ids }) });
}

export function exportJson(ids: string[]) {
  return httpRequest<string>("/export/json", { method: "POST", body: JSON.stringify({ ids }) });
}

export async function downloadMarkdownZip(ids: string[], filename = "daily-summary-markdown.zip") {
  const res = await fetch(buildUrl("/export/zip"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Backups ─────────────────────────────────────────

export interface BackupMeta {
  name: string;
  size_bytes: number;
  created_at: string;
}

export function listBackups() {
  return httpRequest<BackupMeta[]>("/backups");
}

export function createBackup() {
  return httpRequest<BackupMeta>("/backups", { method: "POST", body: "{}" });
}

export function deleteBackup(name: string) {
  return httpRequest<void>(`/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function downloadBackup(name: string) {
  const res = await fetch(buildUrl(`/backups/${encodeURIComponent(name)}/download`), {
    headers: authHeaders(undefined, false),
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ── AI ──────────────────────────────────────────────

export function summarizeWithAI(payload: { content: string }) {
  return httpRequest<{ summary: string }>("/ai/summary", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
