import { Checkbox } from "../ui/checkbox";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FileArchive, FileJson, Upload } from "lucide-react";
import * as api from "../../lib/api";
import { normalizeTags, parseTags } from "../../lib/tags";
import { readFullPackageManifest, validateFullPackageManifest } from "../../lib/fullPackage";
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
  kind: "full" | "articles" | "package";
  fileName: string;
  sizeBytes: number;
  version: string;
  articleCount: number;
  reviewCount: number;
  knowledgeCount: number;
  profileEntryCount?: number;
  profileGoalCount?: number;
  hasPersonalProfile?: boolean;
  dateRange: string;
  data: unknown;
  articles?: ArticleImport[];
  packageFile?: File;
  wallpaperAssetCount?: number;
  wallpaperPresetCount?: number;
};

type MessageScope = "export" | "import";

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PACKAGE_FILE_BYTES = 512 * 1024 * 1024;

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
    const personal=isRecord(data.personal_profile)?data.personal_profile:undefined;
    if (!articles.length && reviewCount === 0 && knowledgeCount === 0 && !personal) {
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
      profileEntryCount: personal && Array.isArray(personal.entries)?personal.entries.length:0,
      profileGoalCount: personal && Array.isArray(personal.goals)?personal.goals.length:0,
      hasPersonalProfile: !!personal,
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
  onWallpaperImported,
}: {
  onBackupCreated?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onWallpaperImported?: () => Promise<boolean>;
}) {
  const queryClient=useQueryClient();
  const [replaceProfile,setReplaceProfile]=useState(false);
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
    setMsg("正在逐步打包完整数据与壁纸…");
    setTone("neutral");
    try {
      const blob = await api.downloadFullPackage();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `daily-summary-full-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMsg("完整迁移包已开始下载，包含记录、复盘、知识、个人档案、壁纸图片、分配和保存方案。");
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
    setReplaceProfile(false);
    setMsg("正在读取文件，尚未写入服务器…");
    setTone("neutral");
    try {
      if (file.name.toLowerCase().endsWith(".zip")) {
        if (file.size > MAX_PACKAGE_FILE_BYTES) throw new Error("完整迁移包不能超过 512 MiB。");
        const manifest = validateFullPackageManifest(await readFullPackageManifest(file));
        setPendingImport({
          kind: "package",
          fileName: file.name,
          sizeBytes: file.size,
          version: "完整 ZIP v1",
          articleCount: manifest.summary.articleCount,
          reviewCount: manifest.summary.reviewCount,
          knowledgeCount: manifest.summary.knowledgeCount,
          profileEntryCount: manifest.summary.profileEntryCount || 0,
          profileGoalCount: manifest.summary.profileGoalCount || 0,
          hasPersonalProfile: !!manifest.summary.hasPersonalProfile,
          dateRange: manifest.summary.dateRange,
          data: null,
          packageFile: file,
          wallpaperAssetCount: manifest.assets.length,
          wallpaperPresetCount: manifest.presets.length,
        });
      } else {
        if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error("JSON 文件超过 10 MB；请使用完整 ZIP 迁移包，或拆分后分批导入。");
        const data = JSON.parse(await file.text()) as unknown;
        setPendingImport(buildImportPreview(data, file));
      }
      setMsg("文件已读取，请检查导入预览。读取过程没有写入服务器。");
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
    const packageSummary = pendingImport.kind === "package"
      ? `，以及 ${pendingImport.wallpaperAssetCount ?? 0} 张壁纸和 ${pendingImport.wallpaperPresetCount ?? 0} 组壁纸方案。完整迁移包会替换服务器壁纸图库、分配和方案；业务数据按现有导入规则处理。`
      : "。";
    let profileRevision:number|undefined;
    try {if(replaceProfile)profileRevision=(await api.getPersonalProfile()).revision;}
    catch(error){setMsg("无法确认当前档案版本："+api.getErrorMessage(error));setTone("bad");return;}
    const ok = await confirm({
      title: "确认导入数据",
      message: `将导入 ${summary}${packageSummary}

服务器会在任何数据写入前创建可恢复快照。继续？`,
      confirmText: "创建快照并导入",
      danger: true,
    });
    if (!ok) return;

    setBusy("import");
    setMsg(pendingImport.kind === "package" ? "正在上传并校验迁移包…" : "正在创建导入前快照…");
    setTone("neutral");
    try {
      if (pendingImport.kind === "package") {
        const currentWallpaperState = await api.getWallpaperSnapshot();
        const result = await api.importFullPackage(
          pendingImport.packageFile!,
          currentWallpaperState.revision,
          replaceProfile,
          profileRevision,
        );
        onBackupCreated?.();
        await onWallpaperImported?.();
        setMsg(`导入完成：${result.importedArticles} 条记录、${result.importedReviews} 篇周期回顾、${result.importedKnowledgeCards} 个知识条目、${result.wallpaperAssets} 张壁纸、${result.wallpaperPresets} 组方案。导入前快照：${result.snapshotName}`);
      } else {
        const snapshot = await api.createBackup();
        onBackupCreated?.();
        setMsg(`已创建导入前快照：${snapshot.name}，正在导入…`);
        if (pendingImport.kind === "full") {
          const result = await api.importFullBackup(pendingImport.data,replaceProfile,profileRevision);
          setMsg(`导入完成：${result.imported_articles} 条记录、${result.imported_reviews} 篇周期回顾、${result.imported_knowledge_cards || 0} 个知识条目。导入前快照：${snapshot.name}`);
        } else {
          const result = await api.importArticles(pendingImport.articles || []);
          setMsg(`导入完成：${result.imported} 条记录，跳过 ${result.skipped} 条空记录。导入前快照：${snapshot.name}`);
        }
      }
      await queryClient.invalidateQueries({queryKey:["personalProfile"]});
      setPendingImport(null);
      setTone("good");
    } catch (e) {
      if (pendingImport.kind === "package") onBackupCreated?.();
      setMsg(`导入失败：${api.getErrorMessage(e)}\n完整 ZIP 导入若已通过服务端校验，导入前快照会保留在服务器快照列表中。`);
      setTone("bad");
    } finally {
      setBusy(null);
    }
  };

  const busyLabel = busy === "full" ? "生成中…" : busy === "markdown" ? "准备中…" : busy === "json" ? "生成中…" : busy === "import" ? "导入中…" : "";

  return (
    <div className="settings-panel-stack flex min-w-0 flex-col gap-5">
      <Card className="settings-export-card">
        <SectionTitle desc="完整 ZIP 迁移包包含业务数据与壁纸；Markdown 和 JSON 适合单独处理记录。">文件导出</SectionTitle>
        {messageScope === "export" && msg && <div className="mb-4"><StatusBox message={msg} tone={tone} /></div>}
        <div className="settings-export-list" role="list">
          <div className="settings-export-row settings-export-row-featured" role="listitem">
            <span className="settings-export-row-icon settings-export-row-icon-accent" aria-hidden="true"><FileArchive size={17} /></span>
            <div className="settings-export-row-copy min-w-0">
              <p className="text-sm font-semibold text-[var(--ui-text)]">完整迁移包</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">包含今日记录、周期回顾、知识条目、复习数据、壁纸图片、组件分配和保存方案。</p>
            </div>
            <PrimaryBtn onClick={() => void exportFull()} disabled={busy !== null} className="settings-action-button shrink-0">
              <FileArchive size={15} /> {busy === "full" ? busyLabel : "下载 ZIP"}
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
          <SectionTitle desc="JSON 与 ZIP 都会先展示摘要；确认后创建恢复点并导入。完整 ZIP 会同时迁移壁纸。">导入数据</SectionTitle>
          <span className="settings-risk-badge shrink-0">会写入服务器</span>
        </div>
        {messageScope === "import" && msg && <div className="mb-3"><StatusBox message={msg} tone={tone} /></div>}
        <p className="text-sm leading-6 text-[var(--ui-text-muted)]">完整 ZIP 可包含壁纸与方案，最大 512 MiB；旧 JSON 归档继续支持，最大 10 MiB。确认导入后服务器会先创建可恢复快照。</p>
        <input ref={fileRef} type="file" accept="application/zip,.zip,application/json,.json" onChange={(event) => void handleImport(event)} className="hidden" />
        <div className="settings-import-trigger mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <SecondaryBtn onClick={() => fileRef.current?.click()} disabled={busy !== null} className="settings-action-button shrink-0">
            <Upload size={15} /> {busy === "read" ? "读取中…" : "选择 ZIP 迁移包或 JSON 文件"}
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
              {pendingImport.hasPersonalProfile && <PreviewItem label="个人档案" value={(pendingImport.profileEntryCount||0)+" 条经历 · "+(pendingImport.profileGoalCount||0)+" 个目标"}/>}
              {pendingImport.kind === "package" && <PreviewItem label="壁纸与方案" value={`${pendingImport.wallpaperAssetCount ?? 0} 张 · ${pendingImport.wallpaperPresetCount ?? 0} 组`} />}
            </dl>
            {pendingImport.hasPersonalProfile && <label className="mt-4 flex items-start gap-2 text-sm leading-6"><Checkbox type="checkbox" checked={replaceProfile} onChange={event=>setReplaceProfile(event.target.checked)} disabled={busy!==null}/><span>明确替换服务器已有个人档案（含经历、目标与分析）。未勾选时，不同档案会拒绝导入，旧文件缺少档案字段时会保留当前档案。</span></label>}
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
