import { type ReactNode, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  ChevronDown,
  Eye,
  EyeOff,
  Gauge,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import * as api from "../../lib/api";
import { useConfirmDialog } from "../ui/Feedback";
import AIRoutingPanel from "./AIRoutingPanel";
import { Card, Input, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone, TextArea } from "./shared";

type AIForm = {
  baseUrl: string;
  model: string;
};

const DEFAULT_FORM: AIForm = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

const TEST_SAMPLE = "今天完成了设置页的连接流程，并记录了一个需要在下周复查的设计决策。";

function formFromConfig(config: api.AiConfig): AIForm {
  return {
    baseUrl: config.base_url,
    model: config.model,
  };
}

export default function AIPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [testContent, setTestContent] = useState("");
  const [testResult, setTestResult] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
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
  const [routingOpen, setRoutingOpen] = useState(false);
  const [routingMounted, setRoutingMounted] = useState(false);
  const [routingDirty, setRoutingDirty] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  const loadHealth = async () => {
    setHealthLoading(true);
    try {
      setHealth(await api.healthCheck());
      setHealthError("");
    } catch (e) {
      setHealthError(api.getErrorMessage(e));
    } finally {
      setHealthLoading(false);
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

  const configDirty = Boolean(config && (
    form.baseUrl.trim().replace(/\/+$/, "") !== config.base_url
    || form.model.trim() !== config.model
    || apiKey.trim()
    || clearApiKey
  ));
  const overallDirty = Boolean(configDirty || routingDirty);

  useEffect(() => {
    onDirtyChange?.(overallDirty);
  }, [onDirtyChange, overallDirty]);

  const reloadConfig = async () => {
    if (configDirty) {
      const ok = await confirm({
        title: "放弃未保存的 AI 配置？",
        message: "重新加载会丢弃当前页面上的 API 地址、默认模型和 API Key 修改。继续？",
        confirmText: "放弃并重新加载",
        danger: true,
      });
      if (!ok) return;
    }
    await loadConfig();
  };

  const saveConfig = async () => {
    if (!config) return;
    setConfigMessage("");
    setConfigTone("neutral");
    setValidationError("");
    const baseUrl = form.baseUrl.trim().replace(/\/+$/, "");
    const model = form.model.trim();
    if (!/^https?:\/\/\S+$/i.test(baseUrl)) {
      setValidationError("API 地址必须是 http:// 或 https:// 开头的兼容接口地址。示例：https://api.openai.com/v1");
      return;
    }
    if (!model) {
      setValidationError("默认模型 ID 不能为空，请填写服务商提供的模型名称。");
      return;
    }
    if (model.length > 160) {
      setValidationError("默认模型 ID 不能超过 160 个字符。");
      return;
    }
    if (clearApiKey && apiKey.trim()) {
      setValidationError("清除 API Key 时不要同时填写新的 API Key。");
      return;
    }

    const payload: api.UpdateAiConfigPayload = {
      base_url: baseUrl,
      model,
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
    if (!testContent.trim() || overallDirty) return;
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
    <div className="grid w-full max-w-4xl gap-4">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle desc="填写 API 地址、Key 和默认模型即可开始使用；只有需要按任务区分模型时才需要展开高级路由。">AI 连接</SectionTitle>
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
            <StatusBox
              tone="bad"
              message={configError.includes("令牌")
                ? "无法读取 AI 配置。请先到“连接服务”保存有效的服务器令牌。"
                : `加载 AI 配置失败：${configError}`}
            />
            <SecondaryBtn onClick={() => void reloadConfig()} className="sm:w-auto">
              <RotateCcw size={15} /> 重试
            </SecondaryBtn>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfigField
                id="ai-base-url"
                label="API 地址"
                description="填写服务商提供的兼容接口根地址，例如 https://api.openai.com/v1。"
                className="sm:col-span-2"
              >
                <Input
                  id="ai-base-url"
                  value={form.baseUrl}
                  onChange={(event) => updateForm("baseUrl", event.target.value)}
                  placeholder="https://api.openai.com/v1"
                  aria-describedby="ai-base-url-description"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={configSaving}
                  className="h-11 font-mono text-xs sm:text-sm"
                />
              </ConfigField>
              <ConfigField
                id="ai-model"
                label="默认模型 ID"
                description="填写服务商提供的模型名称，例如 gpt-4o-mini 或 deepseek-chat；已保存高级路由的任务会以对应模型档案为准。"
              >
                <Input
                  id="ai-model"
                  value={form.model}
                  onChange={(event) => updateForm("model", event.target.value)}
                  placeholder="例如：gpt-4o-mini"
                  aria-describedby="ai-model-description"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={configSaving}
                  className="h-11 font-mono text-xs sm:text-sm"
                />
              </ConfigField>
              <ConfigField id="ai-api-key" label="服务商 API Key" description={`当前来源：${keySourceLabel}。留空表示保持现有 Key 不变。`} className="sm:max-w-2xl">
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
                    aria-describedby="ai-api-key-description"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-11 pr-11 font-mono text-sm"
                    disabled={clearApiKey || configSaving}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    className="ui-icon-button absolute right-1 top-1 h-9 w-9"
                    disabled={clearApiKey || configSaving}
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {config?.api_key_configured && config.api_key_source === "settings" && (
                  <label className="mt-2 flex min-h-10 items-center gap-2 text-xs text-[var(--ui-text-muted)]">
                    <input
                      type="checkbox"
                      checked={clearApiKey}
                      onChange={(event) => {
                        setClearApiKey(event.target.checked);
                        setConfigMessage("");
                      }}
                      className="accent-[var(--ui-accent-solid)]"
                      disabled={configSaving}
                    />
                    清除当前 API Key
                  </label>
                )}
                {config?.api_key_configured && config.api_key_source === "environment" && (
                  <p className="mt-2 text-xs leading-5 text-[var(--ui-text-subtle)]">
                    当前 Key 来自服务端环境变量；如需停用或更换，请修改服务端配置，或在此处填写新的 Key 覆盖它。
                  </p>
                )}
              </ConfigField>
            </div>

            <StatusBox
              tone={validationError ? "bad" : configTone}
              message={validationError || configMessage}
            />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              {configDirty && <span className="text-xs text-[var(--ui-text-muted)] sm:mr-auto" role="status">有未保存的更改</span>}
              <SecondaryBtn onClick={() => void reloadConfig()} disabled={configSaving}>
                <RefreshCw size={15} /> 重新加载
              </SecondaryBtn>
              <PrimaryBtn onClick={saveConfig} disabled={configSaving}>
                <Save size={15} /> {configSaving ? "保存中..." : "保存 AI 配置"}
              </PrimaryBtn>
            </div>
          </>
        )}
      </Card>

      <details
        className="group"
        open={routingOpen}
        onToggle={(event) => {
          const open = event.currentTarget.open;
          setRoutingOpen(open);
          if (open) setRoutingMounted(true);
        }}
      >
        <summary className="ui-panel-muted flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40 sm:p-5">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--ui-text)]">高级路由与模型档案</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--ui-text-muted)]">仅在需要为每日总结、知识条目提取或周期回顾使用不同模型时展开；否则无需设置。</span>
          </span>
          <ChevronDown size={17} className={`shrink-0 text-[var(--ui-text-subtle)] transition-transform ${routingOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </summary>
        {routingMounted && (
          <div className="mt-3">
            <AIRoutingPanel
              onSaved={() => void loadHealth()}
              onDirtyChange={setRoutingDirty}
            />
          </div>
        )}
      </details>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle desc="这里显示服务端已保存的全局默认配置；单项任务可能通过高级路由使用另一套模型。">默认配置状态</SectionTitle>
          <SecondaryBtn onClick={() => void loadHealth()} disabled={healthLoading || configSaving} aria-busy={healthLoading || configSaving} className="shrink-0 px-3 sm:w-auto">
            <RefreshCw size={14} className={healthLoading ? "animate-spin" : ""} /> {healthLoading ? "刷新中…" : "刷新状态"}
          </SecondaryBtn>
        </div>
        {healthError ? (
          <StatusBox
            tone="bad"
            message={healthError.includes("令牌")
              ? "无法读取 AI 连接状态。请先到“连接服务”保存有效的服务器令牌。"
              : healthError}
          />
        ) : healthLoading && !health ? (
          <p className="text-sm text-[var(--ui-text-subtle)]" role="status">正在读取服务端默认配置状态...</p>
        ) : !health ? (
          <p className="text-sm text-[var(--ui-text-subtle)]" role="status">暂无默认配置状态，请刷新重试。</p>
        ) : (
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <AIMetric
              icon={health?.ai_config?.configured ? CheckCircle2 : AlertTriangle}
              label="配置状态"
              value={health?.ai_config?.configured ? "已配置" : "未配置"}
              tone={health?.ai_config?.configured ? "good" : "warn"}
            />
            <AIMetric icon={Cpu} label="全局默认模型" value={health?.ai_config?.model || "未知"} />
            <AIMetric icon={Clock} label="超时" value={`${health?.ai_config?.timeout_secs || "45"} 秒`} />
            <AIMetric icon={Gauge} label="输出上限" value={maxTokenLabel} />
            <AIMetric icon={Sparkles} label="温度" value={health?.ai_config?.temperature || "0.2"} />
            <AIMetric icon={Bot} label="重试 / 间隔" value={`${health?.ai_config?.retries || "2"} 次 · ${health?.ai_config?.min_interval_ms || "1200"} ms`} />
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle desc="测试只使用服务器上已保存的 AI 配置，并调用每日总结路由；不要粘贴密码、令牌、客户资料或其他敏感内容。">测试 AI 连接</SectionTitle>
        <p id="ai-test-description" className="text-xs leading-5 text-[var(--ui-text-muted)]">默认合成样例只验证每日总结路由和服务端代理；知识条目提取、周复盘和月复盘路由需要分别配置后再验证。</p>
        {overallDirty && <p className="mt-2 text-xs text-[var(--ui-warning-text)]" role="status">当前有未保存的 AI 设置，请先保存后再测试，避免测试到旧配置。</p>}
        <TextArea
          value={testContent}
          onChange={(event) => {
            setTestContent(event.target.value);
            setTestResult("");
          }}
          placeholder="粘贴一段不含敏感信息的内容，或使用下方合成样例"
          maxLength={12_000}
          aria-describedby="ai-test-description"
          className="mt-3 h-28"
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <SecondaryBtn onClick={() => { setTestContent(TEST_SAMPLE); setTestResult(""); }} disabled={loading}>
            填入合成样例
          </SecondaryBtn>
          <PrimaryBtn onClick={() => void test()} disabled={loading || !testContent.trim() || overallDirty} aria-busy={loading}>
            {loading ? "请求中..." : overallDirty ? "先保存 AI 设置" : "测试每日总结"}
          </PrimaryBtn>
        </div>
        {testResult && <div className="mt-3"><StatusBox message={testResult} tone={tone} /></div>}
      </Card>
      {dialog}
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
