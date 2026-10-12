import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/utils";

const buttonVariants = cva("workbench-button", {
  variants: {
    variant: { primary: "ui-button-primary", secondary: "ui-button-secondary", ghost: "ui-button-ghost", danger: "ui-button-danger", success: "ui-button-success" },
    size: { default: "workbench-button-default", small: "workbench-button-small", icon: "workbench-button-icon" },
  },
  defaultVariants: { variant: "secondary", size: "default" },
});
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean; loading?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ asChild, loading, disabled, variant, size, className, children, ...props }, ref) {
  const Component = asChild ? Slot : "button";
  return <Component ref={ref} type={asChild ? undefined : "button"} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>{asChild ? children : <>{loading && <LoaderCircle className="workbench-spinner" size={16} aria-hidden="true"/>}{children}</>}</Component>;
});
export function IconButton({ label, ...props }: Omit<ButtonProps, "size" | "aria-label"> & { label: string }) {
  return <Button {...props} size="icon" aria-label={label} title={label}/>;
}
