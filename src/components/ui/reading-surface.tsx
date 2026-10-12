import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
export function ReadingSurface({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <article {...props} className={cn("reading-surface", className)}/>;
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={cn("ui-input", className)}/>;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} {...props} className={cn("ui-textarea", className)}/>;
});
export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; help?: ReactNode }>(function Field({ label, help, className, ...props }, ref) {
  return <label className="workbench-field"><span>{label}</span><Input ref={ref} {...props} className={cn("ui-field", className)}/>{help && <small>{help}</small>}</label>;
});
