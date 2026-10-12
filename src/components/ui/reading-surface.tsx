import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
export function ReadingSurface({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <article {...props} className={cn("reading-surface", className)}/>;
}
export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; help?: ReactNode }>(function Field({ label, help, className, ...props }, ref) {
  return <label className="workbench-field"><span>{label}</span><input ref={ref} {...props} className={cn("ui-field", className)}/>{help && <small>{help}</small>}</label>;
});
