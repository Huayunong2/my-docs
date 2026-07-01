import { useEffect, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Clock, Cpu, Gauge, RefreshCw, Sparkles } from "lucide-react";
import * as api from "../../lib/api";
import { Card, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone } from "./shared";
import { TextArea } from "./shared";

export default function AIPanel() {
  const [testContent, setTestContent] = useState("");
  const [testResult, setTestResult] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.healthCheck>> | null>(null);
  const [healthError, setHealthError] = useState("");

  const loadHealth = async () => {
    try {
      setHealth(await api.healthCheck());
      setHealthError("");
    } catch (e) {
      setHealthError(api.getErrorMessage(e));
    }
  };

  useEffect(() => { loadHealth(); }, []);

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
        <div className="flex items-start justify-between gap-3">
          <SectionTitle desc="服务端只暴露非敏感配置，API Key 不会返回到前端。">AI 状态</SectionTitle>
          <SecondaryBtn onClick={loadHealth} className="shrink-0 px-3">
            <RefreshCw size={14} /> 刷新
          </SecondaryBtn>
        </div>
        {healthError ? (
          <StatusBox tone="bad" message={healthError} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <AIMetric
              icon={health?.ai_config?.configured ? CheckCircle2 : AlertTriangle}
              label="配置状态"
              value={health?.ai_config?.configured ? "已配置" : "未配置"}
              tone={health?.ai_config?.configured ? "good" : "warn"}
            />
            <AIMetric icon={Cpu} label="模型" value={health?.ai_config?.model || "未知"} />
            <AIMetric icon={Clock} label="超时" value={`${health?.ai_config?.timeout_secs || "45"} 秒`} />
            <AIMetric icon={Gauge} label="输出上限" value={`${health?.ai_config?.max_tokens || "1800"} tokens`} />
            <AIMetric icon={Sparkles} label="温度" value={health?.ai_config?.temperature || "0.2"} />
            <AIMetric icon={Bot} label="重试 / 间隔" value={`${health?.ai_config?.retries || "2"} 次 · ${health?.ai_config?.min_interval_ms || "1200"} ms`} />
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle desc="粘贴一段内容测试当前模型、Prompt 和服务端代理是否正常。">测试总结</SectionTitle>
        <TextArea value={testContent} onChange={(e) => setTestContent(e.target.value)} placeholder="粘贴内容..." className="h-24" />
        <PrimaryBtn onClick={test} disabled={loading || !testContent.trim()} className="mt-3">
          {loading ? "请求中..." : "测试 AI 总结"}
        </PrimaryBtn>
        {testResult && <StatusBox message={testResult} tone={tone} />}
      </Card>
    </div>
  );
}

function AIMetric({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const toneClass = {
    neutral: "text-gray-500 bg-gray-100 dark:bg-white/10 dark:text-gray-300",
    good: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300",
    warn: "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300",
  }[tone];
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.035]">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon size={15} />
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
      </div>
      <div className="mt-2 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{value}</div>
    </div>
  );
}
