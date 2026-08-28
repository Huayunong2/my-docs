import { type ReactNode, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Eye,
  EyeOff,
  Gauge,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import * as api from "../../lib/api";
import AIRoutingPanel from "./AIRoutingPanel";
import { Card, Input, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone, TextArea } from "./shared";

type AIForm = {
  baseUrl: string;
};

const DEFAULT_FORM: AIForm = {
  baseUrl: "https://api.openai.com/v1",
};

function formFromConfig(config: api.AiConfig): AIForm {
  return {
    baseUrl: config.base_url,
  };
}

export default function AIPanel() {
  const [testContent, setTestContent] = useState("");
  const [testResult, setTestResult] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.healthCheck>> | null>(null);
  const [healthError, setHealthError] = useState("");

  const [config, setConfig] = useState<api.AiConfig | null>(null);
  const [form, setForm] = useState<AIForm>(DEFAULT_FORM);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [configMessage, setConfigMessage] = useState("");
  const [configTone, setConfigTone] = useState<Tone>("neutral");
  const [configSaving, setConfigSaving] = useState(false);
  const [validationError, setValidationError] = useState("");

  const loadHealth = async () => {
    try {
      setHealth(await api.healthCheck());
      setHealthError("");
    } catch (e) {
      setHealthError(api.getErrorMessage(e));
    }
  };

  const loadConfig = async () => {
    setConfigLoading(true);
    setConfigError("");
    try {
      const next = await api.getAiConfig();
      setConfig(next);
      setForm(formFromConfig(next));
      setApiKey("");
      setClearApiKey(false);
      setConfigMessage("");
      setValidationError("");
    } catch (e) {
      setConfigError(api.getErrorMessage(e));
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    void loadHealth();
    void loadConfig();
  }, []);

  const updateForm = (field: keyof AIForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setValidationError("");
    setConfigMessage("");
  };

  const saveConfig = async () => {
    if (!config) return;
    setConfigMessage("");
    setConfigTone("neutral");
    setValidationError("");
    const baseUrl = form.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/\S+$/i.test(baseUrl)) {
      setValidationError("API 地址必须是 http:// 或 https:// 开头的兼容接口地址。示例：https://api.openai.com/v1");
      return;
    }
    if (clearApiKey && apiKey.trim()) {
      setValidationError("清除 API Key 时不要同时填写新的 API Key。");
      return;
    }

    const payload: api.UpdateAiConfigPayload = {
      base_url: baseUrl,
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.max_tokens,
      timeout_secs: config.timeout_secs,
      retries: config.retries,
      min_interval_ms: config.min_interval_ms,
    };
    if (clearApiKey) {
      payload.clear_api_key = true;
    } else if (apiKey.trim()) {
      payload.api_key = apiKey.trim();
    }

    setConfigSaving(true);
    try {
      const next = await api.updateAiConfig(payload);
      setConfig(next);
      setForm(formFromConfig(next));
      setApiKey("");
      setClearApiKey(false);
      setConfigMessage("AI 配置已保存，下一次 AI 请求会立即使用新设置。服务端无需重启。");
      setConfigTone("good");
      await loadHealth();
    } catch (e) {
      setConfigMessage(api.getErrorMessage(e));
      setConfigTone("bad");
    } finally {
      setConfigSaving(false);
    }
  };

  const test = async () => {
    if (!testContent.trim()) return;
    setLoading(true);
    setTestResult("");
    setTone("neutral");
    try {
      const d = await api.summarizeWithAI({ content: testContent });
      setTestResult(d.summary);
      setTone("good");
    } catch (e) {
      setTestResult(api.getErrorMessage(e));
      setTone("bad");
    }
    setLoading(false);
  };

  const maxTokens = health?.ai_config?.max_tokens;
  const maxTokenLabel = !maxTokens || maxTokens === "0" || maxTokens === "unlimited" ? "不主动限制" : `${maxTokens} tokens`;
  const keySourceLabel = config?.api_key_source === "settings"
    ? "设置页"
    : config?.api_key_source === "environment"
      ? "环境变量"
      : "未配置";
  const configStatus = config?.api_key_configured ? "已配置" : "未配置";

  return (
    <div className="grid w-full max-w-3xl gap-4">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle desc="所有模型档案共用 API 地址和 API Key；模型选择与生成参数在下方档案中维护。">连接与凭证</SectionTitle>
          {config && (
            <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${config.api_key_configured ? "ui-status-success" : "ui-status-warning"}`}>
              {config.api_key_configured ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
              {configStatus}
            </span>
          )}
        </div>

        {configLoading ? (
          <div className="grid gap-3">
            <div className="ui-skeleton h-20 rounded-xl sm:col-span-2" />
            <div className="ui-skeleton h-20 rounded-xl" />
            <div className="ui-skeleton h-20 rounded-xl" />
          </div>
        ) : configError ? (
          <div className="grid gap-3">
            <StatusBox tone="bad" message={`加载 AI 配置失败：${configError}`} />
            <SecondaryBtn onClick={() => void loadConfig()} className="sm:w-auto">
              <RotateCcw size={15} /> 重试
            </SecondaryBtn>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfigField
                id="ai-base-url"
                label="兼容 API 地址"
                description="填写 Base URL，服务端会自动请求 /chat/completions。"
                className="sm:col-span-2"
              >
                <Input
                  id="ai-base-url"
                  value={form.baseUrl}
                  onChange={(event) => updateForm("baseUrl", event.target.value)}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="h-11 font-mono text-xs sm:text-sm"
                />
              </ConfigField>
              <ConfigField id="ai-api-key" label="API Key" description={`当前来源：${keySourceLabel}。留空表示保持现有 Key 不变。`} className="sm:max-w-2xl">
                <div className="relative">
                  <Input
                    id="ai-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      if (event.target.value.trim()) setClearApiKey(false);
                      setConfigMessage("");
                    }}
                    placeholder={config?.api_key_configured ? "已配置，留空保持不变" : "粘贴 API Key"}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-11 pr-11 font-mono text-sm"
                    disabled={clearApiKey}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    className="ui-icon-button absolute right-1 top-1 h-9 w-9"
                    disabled={clearApiKey}
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {config?.api_key_configured && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-[var(--ui-text-muted)]">
                    <input
                      type="checkbox"
                      checked={clearApiKey}
                      onChange={(event) => setClearApiKey(event.target.checked)}
                      className="accent-[var(--ui-accent-solid)]"
                    />
                    清除当前 API Key
                  </label>
                )}
              </ConfigField>
            </div>

            <StatusBox
              tone={validationError ? "bad" : configTone}
              message={validationError || configMessage}
            />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <SecondaryBtn onClick={() => void loadConfig()} disabled={configSaving}>
                <RefreshCw size={15} /> 重新加载
              </SecondaryBtn>
              <PrimaryBtn onClick={saveConfig} disabled={configSaving}>
                <Save size={15} /> {configSaving ? "保存中..." : "保存 AI 配置"}
              </PrimaryBtn>
            </div>
          </>
        )}
      </Card>

      <AIRoutingPanel />

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle desc="这里显示未命中任务路由时使用的默认配置；具体任务以模型路由为准。">AI 状态</SectionTitle>
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
            <AIMetric icon={Cpu} label="默认模型" value={health?.ai_config?.model || "未知"} />
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

function ConfigField({
  id,
  label,
  description,
  className = "",
  children,
}: {
  id: string;
  label: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="block text-sm font-semibold text-[var(--ui-text)]">{label}</label>
      <div className="mt-2">{children}</div>
      <p id={`${id}-description`} className="mt-2 text-xs leading-5 text-[var(--ui-text-subtle)]">{description}</p>
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
