import { useEffect, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../../lib/api";
import { Card, Input, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone } from "./shared";

const DEFAULT_SETTINGS: api.ReviewSettings = {
  new_cards_per_day: 20,
  session_limit: 20,
};

export default function ReviewSettingsPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: api.reviewQueryKeys.settings,
    queryFn: api.getReviewSettings,
    staleTime: 5 * 60_000,
  });
  const duePreviewQuery = useQuery({
    queryKey: ["reviewDuePreview"],
    queryFn: () => api.getDueReviewCards(1),
    staleTime: 60_000,
  });
  const [newCardsPerDay, setNewCardsPerDay] = useState(String(DEFAULT_SETTINGS.new_cards_per_day));
  const [sessionLimit, setSessionLimit] = useState(String(DEFAULT_SETTINGS.session_limit));
  const [validationError, setValidationError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settingsQuery.data) return;
    setNewCardsPerDay(String(settingsQuery.data.new_cards_per_day));
    setSessionLimit(String(settingsQuery.data.session_limit));
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: api.updateReviewSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(api.reviewQueryKeys.settings, settings);
      void queryClient.invalidateQueries({ queryKey: ["dueCount"] });
      void queryClient.invalidateQueries({ queryKey: ["reviewDuePreview"] });
      setNewCardsPerDay(String(settings.new_cards_per_day));
      setSessionLimit(String(settings.session_limit));
      setValidationError("");
      setSaved(true);
    },
  });

  const save = () => {
    setSaved(false);
    setValidationError("");
    const newLimit = Number(newCardsPerDay.trim());
    const batchLimit = Number(sessionLimit.trim());
    if (!Number.isInteger(newLimit) || newLimit < 0 || newLimit > 100) {
      setValidationError("每天最多加入的新复习题必须是 0–100 的整数。设置为 0 表示暂不引入新的复习题。");
      return;
    }
    if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 100) {
      setValidationError("每次加载复习题数必须是 1–100 的整数。");
      return;
    }
    mutation.mutate({ new_cards_per_day: newLimit, session_limit: batchLimit });
  };

  const reset = () => {
    mutation.reset();
    setNewCardsPerDay(String(DEFAULT_SETTINGS.new_cards_per_day));
    setSessionLimit(String(DEFAULT_SETTINGS.session_limit));
    setValidationError("");
    setSaved(false);
  };

  const updateNewCardsPerDay = (value: string) => {
    mutation.reset();
    setNewCardsPerDay(value);
    setSaved(false);
    setValidationError("");
  };

  const updateSessionLimit = (value: string) => {
    mutation.reset();
    setSessionLimit(value);
    setSaved(false);
    setValidationError("");
  };

  const loadError = settingsQuery.error ? api.getErrorMessage(settingsQuery.error) : "";
  const mutationError = mutation.error ? api.getErrorMessage(mutation.error) : "";
  const message = validationError || mutationError || (saved ? "复习计划已保存，下一次开始记忆复习时生效。" : "");
  const tone: Tone = validationError || mutationError ? "bad" : saved ? "good" : "neutral";
  const isDirty = Boolean(settingsQuery.data) && (
    newCardsPerDay !== String(settingsQuery.data?.new_cards_per_day)
    || sessionLimit !== String(settingsQuery.data?.session_limit)
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  return (
    <div className="grid w-full max-w-4xl gap-4">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle desc="设置只影响之后生成的复习队列，不会修改已记录的复习历史。">
            复习计划
          </SectionTitle>
          <span className="ui-status-accent inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold">
            <Check size={12} /> FSRS · 目标保持率 90%
          </span>
        </div>

        {settingsQuery.isPending ? (
          <div className="ui-skeleton h-24 w-full" />
        ) : loadError ? (
          <div className="grid gap-3">
            <StatusBox tone="bad" message={`加载复习设置失败：${loadError}`} />
            <SecondaryBtn onClick={() => void settingsQuery.refetch()} className="sm:w-auto">
              <RotateCcw size={15} /> 重试
            </SecondaryBtn>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); save(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingField
                id="review-new-cards"
                label="每天最多加入的新复习题"
                value={newCardsPerDay}
                onChange={updateNewCardsPerDay}
                min={0}
                max={100}
                suffix="张"
                disabled={mutation.isPending}
                description="只限制当天首次加入队列的新题；已经到期的复习题不受此上限影响。未使用额度不会结转。"
              />
              <SettingField
                id="review-session-limit"
                label="每次加载复习题数"
                value={sessionLimit}
                onChange={updateSessionLimit}
                min={1}
                max={100}
                suffix="张"
                disabled={mutation.isPending}
                description="每次进入复习页先加载的数量；完成后可以继续加载，不代表当天没有更多到期复习题。"
              />
            </div>

            <div className="ui-panel-muted mt-4 p-3.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-[var(--ui-text)]">当前队列（按已保存设置）</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ui-text-subtle)]">显示今天的到期题和可加入的新题；保存上方修改后，复习页会按新设置加载。</p>
                </div>
                <SecondaryBtn type="button" onClick={() => void duePreviewQuery.refetch()} disabled={duePreviewQuery.isFetching || mutation.isPending} className="shrink-0 sm:w-auto">
                  <RotateCcw size={14} className={duePreviewQuery.isFetching ? "animate-spin" : ""} /> 刷新队列
                </SecondaryBtn>
              </div>
              {duePreviewQuery.error ? (
                <p className="mt-3 text-xs text-[var(--ui-text-subtle)]">暂时无法读取队列预览，保存设置后可在复习页查看实际数量。</p>
              ) : duePreviewQuery.data ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <QueueMetric label="今日可复习" value={duePreviewQuery.data.stats.due} />
                  <QueueMetric label="到期复习题" value={duePreviewQuery.data.stats.due_reviews} />
                  <QueueMetric label="可加入新题" value={duePreviewQuery.data.stats.new_cards} />
                </div>
              ) : (
                <p className="mt-3 text-xs text-[var(--ui-text-subtle)]" role="status">正在读取队列预览...</p>
              )}
            </div>

            <div className="ui-panel-muted mt-4 p-3.5">
              <p className="text-xs font-semibold text-[var(--ui-text)]">关于 FSRS</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
                当前使用 FSRS 调度，期望保持率为 90%。系统会根据你的评分记录计算间隔；原始参数暂由系统维护，避免手动调整造成不稳定的复习负担。
              </p>
            </div>

            {isDirty && !message && <p className="text-xs text-[var(--ui-text-muted)]" role="status">有未保存的更改。</p>}
            <StatusBox tone={tone} message={message} />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <SecondaryBtn type="button" onClick={reset} disabled={mutation.isPending}>
                <RotateCcw size={15} /> 恢复默认值
              </SecondaryBtn>
              <PrimaryBtn type="submit" disabled={mutation.isPending}>
                <Save size={15} /> {mutation.isPending ? "保存中..." : "保存复习计划"}
              </PrimaryBtn>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

function SettingField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  suffix,
  disabled,
  description,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  suffix: string;
  disabled?: boolean;
  description: string;
}) {
  return (
    <label htmlFor={id} className="ui-panel-muted block p-3.5">
      <span className="text-sm font-semibold text-[var(--ui-text)]">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-description`}
          className="h-11 min-w-0 flex-1 text-base font-semibold"
        />
        <span className="shrink-0 text-sm text-[var(--ui-text-subtle)]">{suffix}</span>
      </span>
      <span id={`${id}-description`} className="mt-2 block text-xs leading-5 text-[var(--ui-text-subtle)]">
        {description}
      </span>
    </label>
  );
}

function QueueMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-2.5">
      <p className="text-[11px] text-[var(--ui-text-subtle)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--ui-text)]">{value}</p>
    </div>
  );
}
