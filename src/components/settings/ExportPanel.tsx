import { useRef, useState } from "react";
import { Download, FileArchive, FileJson, Upload } from "lucide-react";
import * as api from "../../lib/api";
import { normalizeTags, parseTags } from "../../lib/tags";
import { Card, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone } from "./shared";

export default function ExportPanel() {
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadIds = async () => {
    const all = await api.listArticles(1, 9999);
    if (!all.length) throw new Error("没有可导出的记录");
    return all.map((a) => a.id);
  };

  const exportZip = async () => {
    setLoading(true); setMsg(""); setTone("neutral");
    try { await api.downloadMarkdownZip(await loadIds()); setMsg("Markdown ZIP 已开始下载。"); setTone("good"); } catch (e) { setMsg(`导出失败：${api.getErrorMessage(e)}`); setTone("bad"); }
    setLoading(false);
  };

  const exportJson = async () => {
    setLoading(true); setMsg(""); setTone("neutral");
    try { const path = await api.exportJson(await loadIds()); setMsg(`JSON 已导出到服务器：\n${path}`); setTone("good"); } catch (e) { setMsg(`导出失败：${api.getErrorMessage(e)}`); setTone("bad"); }
    setLoading(false);
  };

  const exportFull = async () => {
    setLoading(true); setMsg(""); setTone("neutral");
    try {
      const data = await api.exportFullBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `daily-summary-full-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      setMsg(`完整备份已下载（${data.articles?.length||0} 篇记录 + ${data.reviews?.length||0} 篇复盘 + ${data.knowledge_cards?.length||0} 张知识卡片）`); setTone("good");
    } catch (e) { setMsg(`导出失败：${api.getErrorMessage(e)}`); setTone("bad"); }
    setLoading(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setLoading(true); setMsg(""); setTone("neutral");
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      // Full backup format: { version, articles, reviews }
      if (data.articles && data.reviews) {
        const result = await api.importFullBackup(data);
        setMsg(`导入 ${result.imported_articles} 篇记录 + ${result.imported_reviews} 篇复盘 + ${result.imported_knowledge_cards || 0} 张知识卡片`);
        setTone("good");
      } else {
        // Plain article array
        const articles = (Array.isArray(data) ? data : [data]).map((item: any) => ({
          date: item.date || "", title: item.title || "", content: item.content || "",
          mood: item.mood || "",
          tags: Array.isArray(item.tags) ? normalizeTags(item.tags) : parseTags(item.tags),
        })).filter((a: any) => a.date && a.content);
        if (!articles.length) throw new Error("文件中没有可导入的记录");
        const result = await api.importArticles(articles);
        setMsg(`导入 ${result.imported} 条，跳过 ${result.skipped} 条空记录`);
        setTone("good");
      }
    } catch (e: any) {
      setMsg(`导入失败：${e.message || e}`);
      setTone("bad");
    }
    setLoading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <SectionTitle desc="导出每日记录或完整备份（含 AI 复盘），可迁移到另一台服务器。">导出与备份</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PrimaryBtn onClick={exportZip} disabled={loading}><Download size={15} /> 下载 Markdown ZIP</PrimaryBtn>
          <SecondaryBtn onClick={exportJson} disabled={loading}><FileJson size={15} /> 导出 JSON 到服务器</SecondaryBtn>
          <PrimaryBtn onClick={exportFull} disabled={loading}><FileArchive size={15} /> 下载完整备份</PrimaryBtn>
          <SecondaryBtn onClick={() => fileRef.current?.click()} disabled={loading}><Upload size={15} /> 导入完整备份</SecondaryBtn>
        </div>
      </Card>

      <input ref={fileRef} type="file" accept=".json" onChange={handleImport} className="hidden" />

      {msg && <StatusBox message={msg} tone={tone} />}
    </div>
  );
}
