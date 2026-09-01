import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FileArchive, FileJson, Upload } from "lucide-react";
import * as api from "../../lib/api";
import { normalizeTags, parseTags } from "../../lib/tags";
import { useConfirmDialog } from "../ui/Feedback";
import { Card, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone } from "./shared";

type ArticleImport = {
  date: string;
  title: string;
  content: string;
  mood: string;
  tags: string[];
};

type ImportPreview = {
  kind: "full" | "articles";
  fileName: string;
  sizeBytes: number;
  version: string;
  articleCount: number;
  reviewCount: number;
  knowledgeCount: number;
  dateRange: string;
  data: unknown;
  articles?: ArticleImport[];
};

type MessageScope = "export" | "import";

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeArticle(value: unknown): ArticleImport | null {
  if (!isRecord(value)) return null;
  const date = readString(value.date);
  const content = readString(value.content);
  if (!date || !content.trim()) return null;
  const rawTags = value.tags;
  const tags = Array.isArray(rawTags)
    ? normalizeTags(rawTags.filter((tag): tag is string => typeof tag === "string"))
    : parseTags(typeof rawTags === "string" ? rawTags : "");
  return {
    date,
    title: readString(value.title),
    content,
    mood: readString(value.mood),
    tags,
  };
}

function formatDateRange(articles: ArticleImport[]) {
  const dates = articles.map((article) => article.date).filter(Boolean).sort();
  if (!dates.length) return "未标注日期";
  if (dates[0] === dates[dates.length - 1]) return dates[0];
  return `${dates[0]} — ${dates[dates.length - 1]}`;
}

function buildImportPreview(data: unknown, file: File): ImportPreview {
  if (isRecord(data) && Array.isArray(data.articles) && Array.isArray(data.reviews)) {
    const articles = data.articles.map(normalizeArticle).filter((article): article is ArticleImport => article !== null);
    const reviewCount = data.reviews.length;
    const knowledgeCount = Array.isArray(data.knowledge_cards) ? data.knowledge_cards.length : 0;
    if (!articles.length && reviewCount === 0 && knowledgeCount === 0) {
      throw new Error("完整归档中没有可导入的数据");
    }
    return {
      kind: "full",
      fileName: file.name,
      sizeBytes: file.size,
      version: data.version == null ? "未标注" : String(data.version),
      articleCount: Array.isArray(data.articles) ? data.articles.length : articles.length,
      reviewCount,
      knowledgeCount,
      dateRange: formatDateRange(articles),
      data,
    };
  }

  const source = Array.isArray(data) ? data : [data];
  const articles = source.map(normalizeArticle).filter((article): article is ArticleImport => article !== null);
  if (!articles.length) throw new Error("文件中没有可导入的记录；请选择 JSON 记录或完整归档。");
  return {
    kind: "articles",
    fileName: file.name,
    sizeBytes: file.size,
    version: "记录 JSON",
    articleCount: articles.length,
    reviewCount: 0,
    knowledgeCount: 0,
    dateRange: formatDateRange(articles),
    data: articles,
    articles,
  };
}

async function loadAllArticleIds() {
  const pageSize = 100;
  const ids: string[] = [];
  for (let page = 1; page <= 10_000; page += 1) {
    const response = await api.listArticles(page, pageSize);
    ids.push(...response.items.map((article) => article.id));
    if (!response.has_more) return ids;
  }
  throw new Error("记录数量超出单次导出的安全范围，请使用完整归档下载。");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ExportPanel({
  onBackupCreated,
  onDirtyChange,
}: {
  onBackupCreated?: (backup: api.BackupMeta) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const [messageScope, setMessageScope] = useState<MessageScope>("export");
  const [pendingImport, setPendingImport] = useState<ImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => {
    onDirtyChange?.(pendingImport !== null);
  }, [onDirtyChange, pendingImport]);

  const exportSelectedArticles = async (kind: "markdown" | "json") => {
    if (busy) return;
    setMessageScope("export");
    setBusy(kind);
    setMsg(kind === "markdown" ? "正在准备 Markdown 文件包…" : "正在生成服务器端 JSON…");
    setTone("neutral");
    try {
      const ids = await loadAllArticleIds();
      if (!ids.length) throw new Error("没有可导出的记录");
      if (ids.length > 500) {
        throw new Error(`当前有 ${ids.length} 条记录；Markdown 文件包和 JSON 单次最多处理 500 条，请下载完整归档。`);
      }
      if (kind === "markdown") {
        await api.downloadMarkdownZip(ids);
        setMsg(`Markdown 文件包已开始下载（${ids.length} 条记录）。`);
      } else {
        await api.downloadJson(ids, `daily-summary-${new Date().toISOString().slice(0, 10)}.json`);
        setMsg(`JSON 文件已开始下载（${ids.length} 条记录）。`);
      }
      setTone("good");
    } catch (e) {
      setMsg(`导出失败：${api.getErrorMessage(e)}`);
      setTone("bad");
    } finally {
      setBusy(null);
    }
  };

  const exportFull = async () => {
    if (busy) return;
    setMessageScope("export");
    setBusy("full");
    setMsg("正在生成完整归档…");
    setTone("neutral");
    try {
      const data = await api.exportFullBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `daily-summary-full-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMsg(`完整归档已下载（${data.articles?.length || 0} 条记录、${data.reviews?.length || 0} 篇周期回顾、${data.knowledge_cards?.length || 0} 个知识条目）。`);
      setTone("good");
    } catch (e) {
      setMsg(`导出失败：${api.getErrorMessage(e)}`);
      setTone("bad");
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessageScope("import");
    setBusy("read");
    setMsg("正在读取文件，尚未写入服务器…");
    setTone("neutral");
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error("文件超过 10 MB；请先拆分后分批导入，避免在确认后才因服务端请求限制失败。");
      const data = JSON.parse(await file.text()) as unknown;
      setPendingImport(buildImportPreview(data, file));
      setMsg("文件已读取，请检查导入预览。");
      setTone("neutral");
    } catch (e) {
      setPendingImport(null);
      setMsg(`读取失败：${api.getErrorMessage(e)}`);
      setTone("bad");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const importPreview = async () => {
    if (!pendingImport || busy) return;
    setMessageScope("import");
    const summary = `${pendingImport.articleCount} 条记录、${pendingImport.reviewCount} 篇周期回顾、${pendingImport.knowledgeCount} 个知识条目`;
    const ok = await confirm({
      title: "确认导入数据",
      message: `将导入 ${summary}。

导入前会先创建一个服务器快照作为恢复点；已有内容会按服务端导入规则合并或更新。继续？`,
      confirmText: "创建快照并导入",
      danger: true,
    });
    if (!ok) return;

    setBusy("import");
    setMsg("正在创建导入前快照…");
    setTone("neutral");
    try {
      const snapshot = await api.createBackup();
      onBackupCreated?.(snapshot);
      setMsg(`已创建导入前快照：${snapshot.name}，正在导入…`);
      if (pendingImport.kind === "full") {
        const result = await api.importFullBackup(pendingImport.data);
        setMsg(`导入完成：${result.imported_articles} 条记录、${result.imported_reviews} 篇周期回顾、${result.imported_knowledge_cards || 0} 个知识条目。导入前快照：${snapshot.name}`);
      } else {
        const result = await api.importArticles(pendingImport.articles || []);
        setMsg(`导入完成：${result.imported} 条记录，跳过 ${result.skipped} 条空记录。导入前快照：${snapshot.name}`);
      }
      setPendingImport(null);
      setTone("good");
    } catch (e) {
      setMsg(`导入失败：${api.getErrorMessage(e)}\n如已创建导入前快照，请从服务器快照中恢复。`);
      setTone("bad");
    } finally {
      setBusy(null);
    }
  };

  const busyLabel = busy === "full" ? "生成中…" : busy === "markdown" ? "准备中…" : busy === "json" ? "生成中…" : busy === "import" ? "导入中…" : "";

  return (
    <div className="settings-panel-stack flex min-w-0 flex-col gap-5">
      <Card className="settings-export-card">
        <SectionTitle desc="完整归档适合迁移或长期保存；Markdown 和 JSON 适合单独处理记录，不包含完整复习状态。">文件导出</SectionTitle>
        {messageScope === "export" && msg && <div className="mb-4"><StatusBox message={msg} tone={tone} /></div>}
        <div className="settings-export-list" role="list">
          <div className="settings-export-row settings-export-row-featured" role="listitem">
            <span className="settings-export-row-icon settings-export-row-icon-accent" aria-hidden="true"><FileArchive size={17} /></span>
            <div className="settings-export-row-copy min-w-0">
              <p className="text-sm font-semibold text-[var(--ui-text)]">下载完整归档</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">包含今日记录、周期回顾、知识条目及复习数据，适合迁移或长期保存。</p>
            </div>
            <PrimaryBtn onClick={() => void exportFull()} disabled={busy !== null} className="settings-action-button shrink-0">
              <FileArchive size={15} /> {busy === "full" ? busyLabel : "下载完整归档"}
            </PrimaryBtn>
          </div>
          <div className="settings-export-row" role="listitem">
            <span className="settings-export-row-icon" aria-hidden="true"><Download size={16} /></span>
            <div className="settings-export-row-copy min-w-0">
              <p className="text-sm font-semibold text-[var(--ui-text)]">Markdown 记录</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">把今日记录下载为 Markdown ZIP；单次最多 500 条。</p>
            </div>
            <SecondaryBtn onClick={() => void exportSelectedArticles("markdown")} disabled={busy !== null} aria-label="下载 Markdown ZIP" title="下载 Markdown ZIP" className="settings-action-button shrink-0">
              <Download size={15} /> {busy === "markdown" ? busyLabel : "下载 ZIP"}
            </SecondaryBtn>
          </div>
          <div className="settings-export-row" role="listitem">
            <span className="settings-export-row-icon" aria-hidden="true"><FileJson size={16} /></span>
            <div className="settings-export-row-copy min-w-0">
              <p className="text-sm font-semibold text-[var(--ui-text)]">JSON 记录</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">下载到当前设备，适合脚本处理；单次最多 500 条。</p>
            </div>
            <SecondaryBtn onClick={() => void exportSelectedArticles("json")} disabled={busy !== null} className="settings-action-button shrink-0">
              <FileJson size={15} /> {busy === "json" ? busyLabel : "下载 JSON"}
            </SecondaryBtn>
          </div>
        </div>
      </Card>

      <Card className="settings-import-card">
        <div className="flex items-start justify-between gap-3">
          <SectionTitle desc="选择文件后先查看摘要，确认后才会创建恢复点并写入；恢复已有快照请在“快照列表”中操作。">导入数据</SectionTitle>
          <span className="settings-risk-badge shrink-0">会写入服务器</span>
        </div>
        {messageScope === "import" && msg && <div className="mb-3"><StatusBox message={msg} tone={tone} /></div>}
        <p className="text-sm leading-6 text-[var(--ui-text-muted)]">建议优先使用完整归档；单次 JSON 文件请控制在 10 MB 以内，大文件先拆分后分批导入。导入前会自动创建服务器快照，结果不符合预期时可以恢复该保护点。</p>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={(event) => void handleImport(event)} className="hidden" />
        <div className="settings-import-trigger mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <SecondaryBtn onClick={() => fileRef.current?.click()} disabled={busy !== null} className="settings-action-button shrink-0">
            <Upload size={15} /> {busy === "read" ? "读取中…" : "选择归档或 JSON 文件"}
          </SecondaryBtn>
          <span className="text-xs text-[var(--ui-text-subtle)]">读取文件不会立即写入服务器</span>
        </div>
        {pendingImport && (
          <div className="settings-import-preview mt-5 border-t border-[var(--ui-border)] pt-5">
            <SectionTitle desc="以下只是文件摘要，尚未写入服务器。确认后会先创建一个可恢复的服务器快照。">导入预览</SectionTitle>
            <div className="ui-alert-warn text-sm leading-6">
              导入可能新增或更新已有数据。请确认文件来源可信，并核对数量和日期范围。
            </div>
            <dl className="settings-preview-grid mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
              <PreviewItem label="文件" value={pendingImport.fileName} />
              <PreviewItem label="文件大小" value={formatBytes(pendingImport.sizeBytes)} />
              <PreviewItem label="格式 / 版本" value={pendingImport.version} />
              <PreviewItem label="记录日期" value={pendingImport.dateRange} />
              <PreviewItem label="今日记录" value={`${pendingImport.articleCount} 条`} />
              <PreviewItem label="周期回顾" value={`${pendingImport.reviewCount} 篇`} />
              <PreviewItem label="知识条目" value={`${pendingImport.knowledgeCount} 个`} />
            </dl>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <SecondaryBtn onClick={() => setPendingImport(null)} disabled={busy !== null}>取消导入</SecondaryBtn>
              <PrimaryBtn onClick={() => void importPreview()} disabled={busy !== null}>
                <Upload size={15} /> {busy === "import" ? "导入中…" : "创建快照并导入"}
              </PrimaryBtn>
            </div>
          </div>
        )}
      </Card>

      {dialog}
    </div>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-preview-item min-w-0">
      <dt className="text-xs text-[var(--ui-text-subtle)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-[var(--ui-text)]">{value}</dd>
    </div>
  );
}
