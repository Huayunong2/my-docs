import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export type Tone = "neutral" | "good" | "warn" | "bad";

export const SectionTitle = ({ children, desc }: { children: string; desc?: string }) => (
  <div className="mb-3">
    <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">{children}</h3>
    {desc && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{desc}</p>}
  </div>
);

export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <section className={`ui-panel p-4 ${className}`}>
    {children}
  </section>
);

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`ui-field ${props.className || ""}`}
  />
);

export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    className={`ui-textarea ${props.className || ""}`}
  />
);

export const PrimaryBtn = ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} className={`ui-button-primary h-10 w-full px-4 text-sm sm:w-auto ${props.className || ""}`}>{children}</button>
);

export const SecondaryBtn = ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} className={`ui-button-secondary h-10 w-full px-4 text-sm sm:w-auto ${props.className || ""}`}>{children}</button>
);

export const DangerBtn = ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} className={`ui-button-danger h-10 w-full px-4 text-sm sm:w-auto ${props.className || ""}`}>{children}</button>
);

export function StatusBox({ message, tone = "neutral" }: { message: string; tone?: Tone }) {
  if (!message) return null;
  const cls = {
    neutral: "ui-alert border-gray-100 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300",
    good: "ui-alert-good",
    warn: "ui-alert-warn",
    bad: "ui-alert-bad",
  }[tone];
  return <div className={`whitespace-pre-wrap ${cls}`}>{message}</div>;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function daysSince(iso: string) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return Infinity;
  return Math.floor((Date.now() - time) / 86400000);
}

export function normalizeInputUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "/api") return "/api";
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}
