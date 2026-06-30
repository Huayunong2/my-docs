import { useCallback, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Tone = "neutral" | "good" | "warn" | "bad";

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="ui-alert-bad">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="ml-2 font-semibold underline underline-offset-2">
          重试
        </button>
      )}
    </div>
  );
}

export function Toast({
  message,
  tone = "neutral",
  onClose,
}: {
  message: string;
  tone?: Tone;
  onClose?: () => void;
}) {
  if (!message) return null;
  const toneClass = {
    neutral: "border-gray-700 bg-gray-900 text-white",
    good: "border-emerald-500 bg-emerald-600 text-white",
    warn: "border-amber-400 bg-amber-500 text-white",
    bad: "border-red-500 bg-red-600 text-white",
  }[tone];
  return (
    <div className={`fixed bottom-20 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 rounded-xl border px-4 py-2 text-sm shadow-modal ${toneClass}`}>
      <div className="flex items-center gap-3">
        <span>{message}</span>
        {onClose && (
          <button onClick={onClose} className="font-medium text-white/80 hover:text-white">
            关闭
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-panel-muted flex min-h-[180px] flex-col items-center justify-center px-5 py-8 text-center">
      {Icon && (
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 text-gray-400 dark:bg-white/[0.06] dark:text-gray-500">
          <Icon size={20} strokeWidth={2.1} />
        </span>
      )}
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-5 text-gray-400 dark:text-gray-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({
  label = "加载中...",
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="ui-panel-muted space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500">{label}</span>
        <span className="h-2 w-16 animate-pulse rounded-full bg-gray-100 dark:bg-white/10" />
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-xl border border-gray-100 bg-white p-3 dark:border-white/10 dark:bg-white/[0.035]">
          <div className="mb-2 h-3 w-28 animate-pulse rounded-full bg-gray-100 dark:bg-white/10" />
          <div className="mb-2 h-4 w-2/5 animate-pulse rounded-full bg-gray-200 dark:bg-white/15" />
          <div className="h-3 w-full animate-pulse rounded-full bg-gray-100 dark:bg-white/10" />
        </div>
      ))}
    </div>
  );
}

type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmOptions & {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-3 sm:items-center" onClick={onCancel}>
      <div
        className="ui-modal-surface max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-500 dark:text-gray-400">{message}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            className="ui-button-secondary h-10 px-4 text-sm"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={[
              "inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition-colors",
              danger ? "bg-red-500 hover:bg-red-600" : "bg-accent hover:bg-accent-hover",
            ].join(" ")}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null);

  const confirm = useCallback((nextOptions: ConfirmOptions) => {
    setOptions(nextOptions);
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve);
    });
  }, []);

  const close = useCallback((value: boolean) => {
    resolver?.(value);
    setResolver(null);
    setOptions(null);
  }, [resolver]);

  const dialog = (
    <ConfirmDialog
      open={!!options}
      title={options?.title || ""}
      message={options?.message || ""}
      confirmText={options?.confirmText}
      cancelText={options?.cancelText}
      danger={options?.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { confirm, dialog };
}
