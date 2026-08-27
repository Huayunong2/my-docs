import { useEffect, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../../lib/api";
import { Card, Input, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone } from "./shared";

const DEFAULT_SETTINGS: api.ReviewSettings = {
  new_cards_per_day: 20,
  session_limit: 20,
};

export default function ReviewSettingsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: api.reviewQueryKeys.settings,
    queryFn: api.getReviewSettings,
    staleTime: 5 * 60_000,
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
      setValidationError("每日新卡上限必须是 0–100 的整数。设置为 0 表示暂不引入新卡。");
      return;
    }
    if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 100) {
      setValidationError("单次复习批次必须是 1–100 的整数。");
      return;
    }
    mutation.mutate({ new_cards_per_day: newLimit, session_limit: batchLimit });
  };

  const reset = () => {
    setNewCardsPerDay(String(DEFAULT_SETTINGS.new_cards_per_day));
    setSessionLimit(String(DEFAULT_SETTINGS.session_limit));
    setValidationError("");
    setSaved(false);
  };

  const loadError = settingsQuery.error ? api.getErrorMessage(settingsQuery.error) : "";
  const mutationError = mutation.error ? api.getErrorMessage(mutation.error) : "";
  const message = validationError || mutationError || (saved ? "复习计划已保存，下一次取卡时生效。" : "");
  const tone: Tone = validationError || mutationError ? "bad" : saved ? "good" : "neutral";

  return (
    <div className="grid w-full max-w-3xl gap-4">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle desc="设置只影响之后取出的复习卡，不会修改已记录的复习历史。">
            复习计划
          </SectionTitle>
          <span className="ui-status-accent inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold">
            <Check size={12} /> FSRS · 90%
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
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingField
                id="review-new-cards"
                label="每日新卡上限"
                value={newCardsPerDay}
                onChange={setNewCardsPerDay}
                min={0}
                max={100}
                suffix="张"
                description="未使用的额度不会结转到下一天。"
              />
              <SettingField
                id="review-session-limit"
                label="单次复习批次"
                value={sessionLimit}
                onChange={setSessionLimit}
                min={1}
                max={100}
                suffix="张"
                description="批次完成后可以继续下一批，不代表当天没有更多到期卡。"
              />
            </div>

            <div className="ui-panel-muted mt-4 p-3.5">
              <p className="text-xs font-semibold text-[var(--ui-text)]">关于 FSRS</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
                当前使用 FSRS 调度，期望保持率为 90%。系统会根据你的评分记录计算间隔；原始参数暂由系统维护，避免手动调整造成不稳定的复习负担。
              </p>
            </div>

            <StatusBox tone={tone} message={message} />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <SecondaryBtn onClick={reset} disabled={mutation.isPending}>
                <RotateCcw size={15} /> 恢复默认
              </SecondaryBtn>
              <PrimaryBtn onClick={save} disabled={mutation.isPending}>
                <Save size={15} /> {mutation.isPending ? "保存中..." : "保存复习计划"}
              </PrimaryBtn>
            </div>
          </>
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
  description,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  suffix: string;
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
