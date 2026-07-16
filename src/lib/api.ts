// API layer — 桌面端和浏览器统一走服务器 HTTP，同源部署默认使用 /api。
import { normalizeTags, parseTags } from "./tags";

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

function getBaseUrl(): string {
  const configured = normalizeBaseUrl(localStorage.getItem("server_url") || "");
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
  const configured = localStorage.getItem("server_url");
  if (configured && (!isTauri() || configured.startsWith("http"))) return configured;
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (isTauri()) return "";
  return "/api";
}

export function setServerUrl(url: string) {
  const normalized = normalizeBaseUrl(url);
  if (normalized && normalized !== "/api") {
    localStorage.setItem("server_url", normalized);
  } else {
    localStorage.removeItem("server_url");
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
  const current = localStorage.getItem("server_token") || "";
  if (current) return current;
  const legacy = localStorage.getItem("api_token") || "";
  if (legacy) {
    localStorage.setItem("server_token", legacy);
    localStorage.removeItem("api_token");
  }
  return legacy;
}

export function setApiToken(token: string) {
  const trimmed = token.trim();
  if (trimmed) {
    localStorage.setItem("server_token", trimmed);
    localStorage.removeItem("api_token");
  } else {
    localStorage.removeItem("server_token");
    localStorage.removeItem("api_token");
  }
}

// ── Articles ────────────────────────────────────────

export interface Article {
  id: string; date: string; title: string; content: string;
  mood: string; tags: string[]; word_count: number; created_at: string; updated_at: string;
}

export interface ArticleSummary {
  id: string; date: string; title: string; mood: string; tags: string[]; word_count: number; preview: string;
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
  return { ...value, tags: readTagList(value.tags) };
}

export function createArticle(payload: { date: string; title: string; content: string; mood: string; tags?: string[] }) {
  return httpRequest<Article>("/articles", { method: "POST", body: JSON.stringify(payload) }).then(mapArticle);
}

export function updateArticle(id: string, payload: { title: string; content: string; mood: string; tags?: string[] }) {
  return httpRequest<Article>(`/articles/${id}`, { method: "PUT", body: JSON.stringify(payload) }).then(mapArticle);
}

export function importArticles(articles: Array<{ date: string; title: string; content: string; mood: string; tags?: string[] }>) {
  return httpRequest<{ imported: number; skipped: number }>("/articles/import", { method: "POST", body: JSON.stringify(articles) });
}

export function exportFullBackup() {
  return httpRequest<{ version: number; articles: any[]; reviews: any[]; knowledge_cards?: any[] }>("/export/full", { method: "POST", body: "{}" });
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

export function searchArticles(query: string) {
  return httpRequest<ArticleSummary[]>(`/articles/search?q=${encodeURIComponent(query)}`).then((items) => items.map(mapArticle));
}

// ── Knowledge cards ─────────────────────────────────

export type KnowledgeCardType = "fact" | "method" | "concept" | "decision" | "case" | "quote" | "principle";
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
}

function mapKnowledgeCard(card: KnowledgeCard): KnowledgeCard {
  return { ...card, tags: readTagList(card.tags) };
}

export function listKnowledgeCards(filters: { card_type?: string; status?: string; q?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.card_type) params.set("card_type", filters.card_type);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const query = params.toString();
  return httpRequest<KnowledgeCard[]>(`/knowledge-cards${query ? `?${query}` : ""}`).then((items) => items.map(mapKnowledgeCard));
}

export function createKnowledgeCard(payload: {
  card_type: KnowledgeCardType;
  status?: KnowledgeCardStatus;
  title: string;
  content: string;
  tags?: string[];
  source_article_id?: string;
  source_review_id?: string;
  source_date?: string;
  source_excerpt?: string;
}) {
  return httpRequest<KnowledgeCard>("/knowledge-cards", { method: "POST", body: JSON.stringify(payload) }).then(mapKnowledgeCard);
}

export function extractKnowledgeCards(payload: {
  content: string;
  source_article_id?: string;
  source_review_id?: string;
  source_date?: string;
  max_cards?: number;
}) {
  return httpRequest<KnowledgeCard[]>("/knowledge-cards/extract", { method: "POST", body: JSON.stringify(payload) }).then((items) => items.map(mapKnowledgeCard));
}

export function updateKnowledgeCard(id: string, payload: Partial<{
  card_type: KnowledgeCardType;
  status: KnowledgeCardStatus;
  title: string;
  content: string;
  tags: string[];
  source_article_id: string;
  source_review_id: string;
  source_date: string;
  source_excerpt: string;
}>) {
  return httpRequest<KnowledgeCard>(`/knowledge-cards/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }).then(mapKnowledgeCard);
}

export function deleteKnowledgeCard(id: string) {
  return httpRequest<void>(`/knowledge-cards/${encodeURIComponent(id)}`, { method: "DELETE" });
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

export function healthCheck() {
  const base = localStorage.getItem("server_url") || (isTauri() ? "http://115.191.3.251:8080/api" : "/api");
  const root = base.replace(/\/api\/?$/, "");
  return fetch(`${root}/health`).then(r => r.json()) as Promise<{
    version: string;
    build: string;
    features: Record<string, boolean>;
    ai_config?: {
      configured: boolean;
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
  }>;
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
