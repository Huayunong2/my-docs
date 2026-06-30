import { useState } from "react";
import * as api from "../../lib/api";
import { Card, PrimaryBtn, SectionTitle, StatusBox, type Tone } from "./shared";
import { TextArea } from "./shared";

export default function AIPanel() {
  const [testContent, setTestContent] = useState("");
  const [testResult, setTestResult] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const [loading, setLoading] = useState(false);

  const test = async () => {
    if (!testContent.trim()) return;
    setLoading(true); setTestResult(""); setTone("neutral");
    try {
      const d = await api.summarizeWithAI({ content: testContent });
      setTestResult(d.summary); setTone("good");
    } catch (e) {
      setTestResult("❌ " + api.getErrorMessage(e)); setTone("bad");
    }
    setLoading(false);
  };

  return (
    <div className="grid gap-4 max-w-3xl">
      <Card>
        <SectionTitle desc="AI 每日总结使用服务端预设 Prompt，周/月复盘有独立 Prompt。可在今日页直接点击「AI 总结」。">AI 状态</SectionTitle>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          AI 功能通过服务端 <code className="bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-xs">DAILY_SUMMARY_AI_API_KEY</code> 环境变量配置。
          去设置 → 连接 → 服务端诊断查看是否已配置。
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Prompt 模板管理功能即将支持。当前使用内置 Prompt：
        </p>
        <ul className="mt-2 space-y-1 text-xs text-gray-400 dark:text-gray-500 list-disc pl-4">
          <li>日总结：3-5 句，纯文本，提炼事实</li>
          <li>周复盘：模式发现 + 经验沉淀</li>
          <li>月复盘：主线 + 进展 + 反复问题</li>
        </ul>
      </Card>

      <Card>
        <SectionTitle desc="粘贴一段内容测试 AI 总结效果。">测试总结</SectionTitle>
        <TextArea value={testContent} onChange={(e) => setTestContent(e.target.value)} placeholder="粘贴内容..." className="h-24" />
        <PrimaryBtn onClick={test} disabled={loading || !testContent.trim()} className="mt-3">{loading ? "请求中..." : "测试 AI 总结"}</PrimaryBtn>
        {testResult && <StatusBox message={testResult} tone={tone} />}
      </Card>
    </div>
  );
}
