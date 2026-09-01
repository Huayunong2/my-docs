import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  FileText,
  GitBranch,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import * as api from "../../lib/api";
import { useConfirmDialog } from "../ui/Feedback";
import { Card, Input, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone } from "./shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type ProfileDraft = {
  id: string;
  name: string;
  model: string;
  temperature: string;
  maxTokens: string;
  timeoutSecs: string;
  retries: string;
  minIntervalMs: string;
};

type RoutingDraft = {
  profiles: ProfileDraft[];
  routes: Partial<Record<api.AiTaskId, string>>;
  fallbackProfile: string;
};

const TASKS: Array<{
  id: api.AiTaskId;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { id: "daily_summary", label: "每日总结", description: "整理当天记录，生成可复习的简短总结", icon: CalendarDays },
  { id: "knowledge_extract", label: "知识条目提取", description: "从文档、记录或周期回顾中提炼知识条目候选", icon: BookOpen },
  { id: "weekly_review", label: "周复盘", description: "归纳一周的主题、事实与可复用沉淀", icon: BarChart3 },
  { id: "monthly_review", label: "月复盘", description: "梳理跨周脉络，提炼长期复习材料", icon: FileText },
];

const MAX_PROFILES = 8;
const FALLBACK_ROUTE = "__fallback__";

function profileToDraft(profile: api.AiModelProfile): ProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    model: profile.model,
    temperature: String(profile.temperature),
    maxTokens: String(profile.max_tokens),
    timeoutSecs: String(profile.timeout_secs),
    retries: String(profile.retries),
    minIntervalMs: String(profile.min_interval_ms),
  };
}

function routingToDraft(routing: api.AiRoutingConfig): RoutingDraft {
  const routes = TASKS.reduce<Partial<Record<api.AiTaskId, string>>>((result, task) => {
    const profileId = routing.routes[task.id];
    if (profileId) result[task.id] = profileId;
    return result;
  }, {});
  return {
    profiles: routing.profiles.map(profileToDraft),
    routes,
    fallbackProfile: routing.fallback_profile,
  };
}

function draftToRouting(draft: RoutingDraft): api.AiRoutingConfig {
  return {
    profiles: draft.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      model: profile.model,
      temperature: Number(profile.temperature),
      max_tokens: Number(profile.maxTokens),
      timeout_secs: Number(profile.timeoutSecs),
      retries: Number(profile.retries),
      min_interval_ms: Number(profile.minIntervalMs),
    })),
    routes: draft.routes,
    fallback_profile: draft.fallbackProfile,
  };
}

function createProfile(id: string, source?: ProfileDraft): ProfileDraft {
  return {
    id,
    name: "新模型档案",
    model: source?.model || "your-model-name",
    temperature: source?.temperature || "0.2",
    maxTokens: source?.maxTokens || "0",
    timeoutSecs: source?.timeoutSecs || "45",
    retries: source?.retries || "2",
    minIntervalMs: source?.minIntervalMs || "1200",
  };
}

function validateDraft(draft: RoutingDraft): string {
  if (draft.profiles.length < 1 || draft.profiles.length > MAX_PROFILES) {
    return `模型档案数量必须是 1–${MAX_PROFILES} 个。`;
  }
  const ids = new Set<string>();
  for (const profile of draft.profiles) {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(profile.id)) {
      return "模型档案内部 ID 格式无效，请重新加载后再试。";
    }
    if (ids.has(profile.id)) {
      return "模型档案内部 ID 不能重复，请重新加载后再试。";
    }
    ids.add(profile.id);
    if (!profile.name.trim()) return "模型档案名称不能为空。";
    if (profile.name.trim().length > 40) return "模型档案名称不能超过 40 个字符。";
    if (!profile.model.trim()) return `“${profile.name || "未命名档案"}”的模型 ID 不能为空。`;
    if (profile.model.trim().length > 160) return "模型 ID 不能超过 160 个字符。";

    const temperature = Number(profile.temperature);
    const maxTokens = Number(profile.maxTokens);
    const timeoutSecs = Number(profile.timeoutSecs);
    const retries = Number(profile.retries);
    const minIntervalMs = Number(profile.minIntervalMs);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      return `“${profile.name || "未命名档案"}”的温度必须是 0–2 之间的数字。`;
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 0 || maxTokens > 1_000_000) {
      return `“${profile.name || "未命名档案"}”的输出上限必须是 0–1,000,000 之间的整数。`;
    }
    if (!Number.isInteger(timeoutSecs) || timeoutSecs < 1 || timeoutSecs > 600) {
      return `“${profile.name || "未命名档案"}”的超时必须是 1–600 秒之间的整数。`;
    }
    if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
      return `“${profile.name || "未命名档案"}”的重试次数必须是 0–10 之间的整数。`;
    }
    if (!Number.isInteger(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 60_000) {
      return `“${profile.name || "未命名档案"}”的请求间隔必须是 0–60,000 毫秒之间的整数。`;
    }
  }
  if (!ids.has(draft.fallbackProfile)) return "默认模型档案必须指向一个已存在的档案。";
  for (const task of TASKS) {
    const profileId = draft.routes[task.id];
    if (profileId && !ids.has(profileId)) return `${task.label}没有选择有效的模型档案。`;
  }
  return "";
}

export default function AIRoutingPanel({
  onSaved,
  onDirtyChange,
}: {
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [routing, setRouting] = useState<RoutingDraft | null>(null);
  const [savedRouting, setSavedRouting] = useState<RoutingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const { confirm, dialog } = useConfirmDialog();
  const isDirty = useMemo(
    () => Boolean(routing && savedRouting && JSON.stringify(routing) !== JSON.stringify(savedRouting)),
    [routing, savedRouting],
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const loadRouting = async () => {
    setLoading(true);
    setError("");
    try {
      const next = routingToDraft(await api.getAiRouting());
      setRouting(next);
      setSavedRouting(next);
      setMessage("");
      setTone("neutral");
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRouting();
  }, []);

  const updateProfile = (id: string, field: keyof Omit<ProfileDraft, "id">, value: string) => {
    setRouting((current) => current && {
      ...current,
      profiles: current.profiles.map((profile) => profile.id === id ? { ...profile, [field]: value } : profile),
    });
    setMessage("");
    setTone("neutral");
  };

  const updateRoute = (task: api.AiTaskId, profileId: string) => {
    setRouting((current) => {
      if (!current) return current;
      const routes = { ...current.routes };
      if (profileId === FALLBACK_ROUTE) delete routes[task];
      else routes[task] = profileId;
      return { ...current, routes };
    });
    setMessage("");
    setTone("neutral");
  };

  const addProfile = () => {
    setRouting((current) => {
      if (!current || current.profiles.length >= MAX_PROFILES) return current;
      const baseId = `profile-${Date.now().toString(36)}`;
      let id = baseId;
      let suffix = 2;
      while (current.profiles.some((profile) => profile.id === id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      return { ...current, profiles: [...current.profiles, createProfile(id, current.profiles[0])] };
    });
    setMessage("");
    setTone("neutral");
  };

  const removeProfile = async (id: string) => {
    const profile = routing?.profiles.find((item) => item.id === id);
    if (!routing || !profile || routing.profiles.length <= 1) return;
    const ok = await confirm({
      title: "删除模型档案",
      message: `删除“${profile.name || profile.id}”？使用它的任务会改为跟随默认模型档案。`,
      confirmText: "删除档案",
      danger: true,
    });
    if (!ok) return;
    setRouting((current) => {
      if (!current || current.profiles.length <= 1) return current;
      const profiles = current.profiles.filter((profile) => profile.id !== id);
      const replacement = profiles[0].id;
      const routes = { ...current.routes };
      TASKS.forEach((task) => {
        if (routes[task.id] === id) delete routes[task.id];
      });
      return {
        profiles,
        routes,
        fallbackProfile: current.fallbackProfile === id ? replacement : current.fallbackProfile,
      };
    });
    setMessage("已移除档案，原来使用它的任务现在会跟随默认模型档案。");
    setTone("warn");
  };

  const reloadRouting = async () => {
    if (isDirty) {
      const ok = await confirm({
        title: "放弃未保存的路由设置？",
        message: "重新加载会丢弃当前页面上的模型路由和档案修改。继续？",
        confirmText: "放弃并重新加载",
        danger: true,
      });
      if (!ok) return;
    }
    await loadRouting();
  };

  const saveRouting = async () => {
    if (!routing) return;
    const validationError = validateDraft(routing);
    if (validationError) {
      setMessage(validationError);
      setTone("bad");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const saved = await api.updateAiRouting(draftToRouting(routing));
      const savedDraft = routingToDraft(saved);
      setRouting(savedDraft);
      setSavedRouting(savedDraft);
      setMessage("模型路由已保存，下一次 AI 请求会按任务使用对应档案。");
      setTone("good");
      onSaved?.();
    } catch (e) {
      setMessage(api.getErrorMessage(e));
      setTone("bad");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="ui-status-accent mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <GitBranch size={16} />
          </span>
          <SectionTitle desc="按任务选择模型。没有单独指定的任务会跟随全局默认模型，共用 AI 页的 API 地址和 API Key。">任务路由</SectionTitle>
        </div>
        {routing && (
          <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${isDirty ? "ui-status-warning" : "ui-status-muted"}`}>
            {isDirty ? "有未保存的更改" : `${routing.profiles.length} 个模型档案`}
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3">
          <div className="ui-skeleton h-20 rounded-xl" />
          <div className="ui-skeleton h-40 rounded-xl" />
        </div>
      ) : error ? (
        <div className="grid gap-3">
          <StatusBox tone="bad" message={`加载模型路由失败：${error}`} />
          <SecondaryBtn onClick={() => void loadRouting()} className="sm:w-auto">
            <RefreshCw size={15} /> 重试
          </SecondaryBtn>
        </div>
      ) : routing ? (
        <>
          <div className="ui-panel-muted p-3.5">
            <div className="flex items-start gap-2">
              <GitBranch size={15} className="mt-0.5 shrink-0 text-[var(--ui-accent-text)]" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--ui-text)]">每项任务都有明确的生效模型</p>
                <p className="mt-1 text-xs leading-5 text-[var(--ui-text-subtle)]">
                  任务可以使用不同模型；选择“跟随默认”时，实际使用全局默认模型档案。
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {TASKS.map((task) => {
                const Icon = task.icon;
                const routeProfile = routing.profiles.find((profile) => profile.id === routing.routes[task.id]);
                const fallbackProfile = routing.profiles.find((profile) => profile.id === routing.fallbackProfile);
                const selected = routeProfile?.id || FALLBACK_ROUTE;
                const effectiveProfile = routeProfile || fallbackProfile;
                return (
                  <div key={task.id} className="grid gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(240px,34%)] sm:items-start">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="ui-status-muted mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                        <Icon size={14} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--ui-text)]">{task.label}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">{task.description}</p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <span className="mb-1.5 block text-[11px] font-medium text-[var(--ui-text-subtle)]">使用模型档案</span>
                      <SelectField
                        id={`ai-route-${task.id}`}
                        ariaLabel={`${task.label}使用的模型档案`}
                        value={selected}
                        onChange={(value) => updateRoute(task.id, value)}
                        disabled={saving}
                        options={[
                          { value: FALLBACK_ROUTE, label: `跟随默认 · ${fallbackProfile?.name || "未配置"}` },
                          ...routing.profiles.map((profile) => ({ value: profile.id, label: `${profile.name || "未命名档案"} · ${profile.model}` })),
                        ]}
                      />
                      <p className="mt-1.5 break-words text-[11px] leading-4 text-[var(--ui-text-subtle)]">
                        实际模型：{effectiveProfile?.model || "未配置"}{routeProfile ? " · 任务专用" : " · 跟随默认"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 grid gap-2 border-t border-[var(--ui-border)] pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(240px,34%)] sm:items-start">
              <div>
                <p className="text-xs font-semibold text-[var(--ui-text)]">全局默认模型</p>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--ui-text-subtle)]">用于选择“跟随默认”的任务，以及后续新增的 AI 功能。</p>
              </div>
              <div className="min-w-0">
                <span className="mb-1.5 block text-[11px] font-medium text-[var(--ui-text-subtle)]">默认使用</span>
                <SelectField
                  id="ai-fallback-profile"
                  ariaLabel="全局默认模型档案"
                  value={routing.fallbackProfile}
                  onChange={(value) => {
                    setRouting((current) => current && { ...current, fallbackProfile: value });
                    setMessage("");
                    setTone("neutral");
                  }}
                  disabled={saving}
                  options={routing.profiles.map((profile) => ({ value: profile.id, label: `${profile.name || "未命名档案"} · ${profile.model}` }))}
                />
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-[var(--ui-text)]">模型档案</h4>
                <p className="mt-1 text-xs leading-5 text-[var(--ui-text-subtle)]">模型档案保存模型 ID 和生成策略，API 地址与 Key 统一从 AI 页读取。</p>
              </div>
              <SecondaryBtn onClick={addProfile} disabled={saving || routing.profiles.length >= MAX_PROFILES} className="sm:w-auto">
                <Plus size={15} /> 添加档案
              </SecondaryBtn>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {routing.profiles.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  canRemove={routing.profiles.length > 1}
                  disabled={saving}
                  onChange={updateProfile}
                  onRemove={removeProfile}
                />
              ))}
            </div>
          </div>

          <StatusBox message={message} tone={tone} />
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {isDirty && <span className="text-xs text-[var(--ui-text-muted)] sm:mr-auto">修改尚未保存</span>}
            <SecondaryBtn onClick={() => void reloadRouting()} disabled={saving || loading}>
              <RefreshCw size={15} /> 重新加载
            </SecondaryBtn>
            {isDirty ? (
              <PrimaryBtn onClick={saveRouting} disabled={saving}>
                <Save size={15} /> {saving ? "保存中..." : "保存路由设置"}
              </PrimaryBtn>
            ) : (
              <SecondaryBtn disabled>
                <Save size={15} /> 已保存
              </SecondaryBtn>
            )}
          </div>
        </>
      ) : null}
      {dialog}
    </Card>
  );
}

function ProfileCard({
  profile,
  canRemove,
  disabled,
  onChange,
  onRemove,
}: {
  profile: ProfileDraft;
  canRemove: boolean;
  disabled: boolean;
  onChange: (id: string, field: keyof Omit<ProfileDraft, "id">, value: string) => void;
  onRemove: (id: string) => void | Promise<void>;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-soft)] p-3.5 transition-colors hover:border-[var(--ui-border-strong)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="ui-status-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <span className="text-xs font-bold">{profile.name.trim().slice(0, 1) || "模"}</span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[var(--ui-text)]">{profile.name.trim() || "未命名档案"}</p>
            <p className="mt-0.5 break-all text-[11px] leading-4 text-[var(--ui-text-subtle)]">档案 ID · {profile.id}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onRemove(profile.id)}
          disabled={!canRemove || disabled}
          aria-label={`删除模型档案 ${profile.name || profile.id}`}
          title={disabled ? "保存中…" : canRemove ? "删除模型档案" : "至少保留一个模型档案"}
          className="ui-icon-button ui-icon-button-danger"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="mt-3 grid gap-3">
        <ProfileField label="档案名称" hint="用于路由选择">
          <Input
            value={profile.name}
            onChange={(event) => onChange(profile.id, "name", event.target.value)}
            disabled={disabled}
            placeholder="例如：快速模型"
            maxLength={40}
            className="h-10 text-sm"
          />
        </ProfileField>
        <ProfileField label="模型 ID" hint="供应商定义">
          <Input
            value={profile.model}
            onChange={(event) => onChange(profile.id, "model", event.target.value)}
            disabled={disabled}
            placeholder="例如：deepseek-chat"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="h-10 font-mono text-xs sm:text-sm"
          />
        </ProfileField>
        <div className="grid gap-3 sm:grid-cols-2">
          <ProfileField label="温度" hint="0–2">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={2}
              step={0.1}
              value={profile.temperature}
              onChange={(event) => onChange(profile.id, "temperature", event.target.value)}
              disabled={disabled}
              className="h-10 text-sm"
            />
          </ProfileField>
          <ProfileField label="输出上限" hint="0 = 不限">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={1_000_000}
              step={1}
              value={profile.maxTokens}
              onChange={(event) => onChange(profile.id, "maxTokens", event.target.value)}
              disabled={disabled}
              className="h-10 text-sm"
            />
          </ProfileField>
          <ProfileField label="请求超时" hint="秒">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              step={1}
              value={profile.timeoutSecs}
              onChange={(event) => onChange(profile.id, "timeoutSecs", event.target.value)}
              disabled={disabled}
              className="h-10 text-sm"
            />
          </ProfileField>
          <ProfileField label="失败重试" hint="次">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={10}
              step={1}
              value={profile.retries}
              onChange={(event) => onChange(profile.id, "retries", event.target.value)}
              disabled={disabled}
              className="h-10 text-sm"
            />
          </ProfileField>
          <ProfileField label="最小请求间隔" hint="毫秒" className="sm:col-span-2">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={60_000}
              step={100}
              value={profile.minIntervalMs}
              onChange={(event) => onChange(profile.id, "minIntervalMs", event.target.value)}
              disabled={disabled}
              className="h-10 text-sm"
            />
          </ProfileField>
        </div>
      </div>
    </article>
  );
}

function ProfileField({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block text-xs font-semibold text-[var(--ui-text)]">
        {label} <span className="font-normal text-[var(--ui-text-subtle)]">· {hint}</span>
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function SelectField({
  id,
  ariaLabel,
  value,
  onChange,
  disabled = false,
  options,
}: {
  id: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={ariaLabel} disabled={disabled} className="h-10 w-full min-w-0 text-xs font-medium">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-w-[min(420px,calc(100vw-2rem))]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
