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
      setTestResult(api.getErrorMessage(e)); setTone("bad");
    }
    setLoading(false);
  };

  const maxTokens = health?.ai_config?.max_tokens;
  const maxTokenLabel = !maxTokens || maxTokens === "0" || maxTokens === "unlimited" ? "不主动限制" : `${maxTokens} tokens`;

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle desc="服务端只暴露非敏感配置，API Key 不会返回到前端。">AI 状态</SectionTitle>
          <SecondaryBtn onClick={loadHealth} className="shrink-0 px-3 sm:w-auto">
            <RefreshCw size={14} /> 刷新
          </SecondaryBtn>
        </div>
        {healthError ? (
          <StatusBox tone="bad" message={healthError} />
        ) : (
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <AIMetric
              icon={health?.ai_config?.configured ? CheckCircle2 : AlertTriangle}
              label="配置状态"
              value={health?.ai_config?.configured ? "已配置" : "未配置"}
              tone={health?.ai_config?.configured ? "good" : "warn"}
            />
            <AIMetric icon={Cpu} label="模型" value={health?.ai_config?.model || "未知"} />
            <AIMetric icon={Clock} label="超时" value={`${health?.ai_config?.timeout_secs || "45"} 秒`} />
            <AIMetric icon={Gauge} label="输出上限" value={maxTokenLabel} />
            <AIMetric icon={Sparkles} label="温度" value={health?.ai_config?.temperature || "0.2"} />
            <AIMetric icon={Bot} label="重试 / 间隔" value={`${health?.ai_config?.retries || "2"} 次 · ${health?.ai_config?.min_interval_ms || "1200"} ms`} />
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle desc="粘贴一段内容测试当前模型、Prompt 和服务端代理是否正常。">测试总结</SectionTitle>
        <TextArea value={testContent} onChange={(e) => setTestContent(e.target.value)} placeholder="粘贴内容..." className="h-24" />
        <PrimaryBtn onClick={test} disabled={loading || !testContent.trim()} className="mt-3 sm:w-auto">
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
    neutral: "ui-status-muted",
    good: "ui-status-success",
    warn: "ui-status-warning",
  }[tone];
  return (
    <div className="ui-panel-muted min-w-0 rounded-lg p-3">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon size={15} />
        </span>
        <span className="text-xs text-[var(--ui-text-subtle)]">{label}</span>
      </div>
      <div className="mt-2 break-words text-sm font-semibold leading-5 text-[var(--ui-text)]">{value}</div>
    </div>
  );
}
