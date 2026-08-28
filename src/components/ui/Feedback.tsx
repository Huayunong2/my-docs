import { useCallback, useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Tone = "neutral" | "good" | "warn" | "bad";

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" aria-live="assertive" className="ui-alert-bad flex items-start gap-2">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="min-w-0">{message}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80">
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
    neutral: "ui-toast-neutral",
    good: "ui-toast-good",
    warn: "ui-toast-warn",
    bad: "ui-toast-bad",
  }[tone];
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      aria-live={tone === "bad" ? "assertive" : "polite"}
      className={`ui-toast fixed bottom-20 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 px-4 py-2 text-sm ${toneClass}`}
    >
      <div className="flex items-center gap-3">
        <span>{message}</span>
        {onClose && (
          <button type="button" onClick={onClose} className="font-medium opacity-75 hover:opacity-100">
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
    <div className="ui-panel-muted relative flex min-h-[200px] flex-col items-center justify-center px-5 py-10 text-center">
      {Icon && (
        <span className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--ui-surface-selected)] text-[var(--ui-accent-text)] ring-1 ring-[var(--ui-selected-border)]">
          <Icon size={22} strokeWidth={2} />
        </span>
      )}
      <h3 className="relative text-sm font-semibold text-[var(--ui-text)]">{title}</h3>
      {description && (
        <p className="relative mt-1 max-w-sm text-xs leading-5 text-[var(--ui-text-subtle)]">{description}</p>
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
    <div className="ui-panel-muted space-y-3 p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--ui-text-subtle)]">{label}</span>
        <span className="ui-skeleton h-2 w-16" />
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="ui-panel-muted p-3">
          <div className="ui-skeleton mb-2 h-3 w-28 rounded-full" />
          <div className="ui-skeleton mb-2 h-4 w-2/5 rounded-full" />
          <div className="ui-skeleton h-3 w-full rounded-full" />
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
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-[80] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="ui-modal-surface fixed left-1/2 top-1/2 z-[81] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 p-5 outline-hidden data-[state=open]:animate-fade-in sm:p-6">
          <div className="flex items-start gap-3">
            {danger && (
              <span className="ui-status-danger flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
                <AlertTriangle size={17} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold leading-6 text-[var(--ui-text)]">{title}</Dialog.Title>
              <Dialog.Description className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[var(--ui-text-muted)]">
                {message}
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-6 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Dialog.Close asChild>
              <button type="button" className="ui-button-secondary h-10 min-h-10 min-w-[64px] px-4 text-sm">{cancelText}</button>
            </Dialog.Close>
            <button
              type="button"
              onClick={onConfirm}
              className={danger ? "ui-button-danger h-10 min-h-10 min-w-[104px] px-4 text-sm" : "ui-button-primary h-10 min-h-10 min-w-[80px] px-4 text-sm"}
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
