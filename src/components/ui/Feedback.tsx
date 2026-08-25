import { useCallback, useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Tone = "neutral" | "good" | "warn" | "bad";

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="ui-alert-bad flex items-start gap-2">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="min-w-0">{message}</span>
        {onRetry && (
          <button onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80">
            <RotateCw size={13} /> 重试
          </button>
        )}
      </div>
    </div>
  );
}

export function Toast({
  message,
  tone = "neutral",
  onClose,
  autoHideMs,
}: {
  message: string;
  tone?: Tone;
  onClose?: () => void;
  autoHideMs?: number;
}) {
  useEffect(() => {
    if (!message || !autoHideMs || !onClose) return;
    const timer = window.setTimeout(onClose, autoHideMs);
    return () => window.clearTimeout(timer);
  }, [autoHideMs, message, onClose]);
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
    <div className="ui-panel-muted relative flex min-h-[200px] flex-col items-center justify-center overflow-hidden px-5 py-10 text-center">
      <div className="pointer-events-none absolute -top-16 left-1/2 h-32 w-72 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl dark:bg-accent/15" />
      {Icon && (
        <span className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/15 to-accent/5 text-accent ring-1 ring-accent/15 dark:from-accent/20 dark:to-accent/5 dark:ring-accent/20">
          <Icon size={22} strokeWidth={2} />
        </span>
      )}
      <h3 className="relative text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
      {description && (
        <p className="relative mt-1 max-w-sm text-xs leading-5 text-gray-400 dark:text-gray-500">{description}</p>
      )}
      {action && <div className="relative mt-4">{action}</div>}
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
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45 data-[state=open]:animate-fade-in" />
        <Dialog.Content className="ui-modal-surface fixed left-1/2 top-1/2 z-[81] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 p-4 outline-hidden data-[state=open]:animate-fade-in">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-500 dark:text-gray-400">
            {message}
          </Dialog.Description>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <button className="ui-button-secondary h-10 px-4 text-sm">{cancelText}</button>
            </Dialog.Close>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
