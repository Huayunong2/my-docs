import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: LucideIcon;
  navigation?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Shared page-level hierarchy: identity on the left, navigation and contextual
 * actions on the right. Keeping this primitive small makes it usable on both
 * desktop and mobile without forcing every page into the same content layout.
 */
export default function PageHeader({ title, description, eyebrow, icon: Icon, navigation, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("page-header mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="page-header-identity flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="page-header-mark flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--ui-accent-text)]">
            <Icon size={19} strokeWidth={2.15} />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-[10px] font-semibold tracking-[0.12em] text-[var(--ui-text-subtle)]">{eyebrow}</p>}
          <h1 className="text-[1.35rem] font-bold leading-tight tracking-[-0.03em] text-[var(--ui-text)] md:text-[1.5rem]">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ui-text-muted)]">{description}</p>}
        </div>
      </div>
      {(navigation || actions) && (
        <div className="page-header-tools flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
          {navigation && <div className="page-header-navigation min-w-0">{navigation}</div>}
          {actions && <div className="page-header-actions flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap">{actions}</div>}
        </div>
      )}
    </header>
  );
}

/**
 * Gives page actions an explicit priority. At narrow container widths the
 * secondary group is hidden, leaving the primary action and optional overflow
 * entry discoverable instead of letting every button wrap independently.
 */
export function PageHeaderActions({
  primary,
  secondary,
  overflow,
}: {
  primary?: ReactNode;
  secondary?: ReactNode;
  overflow?: ReactNode;
}) {
  return (
    <div className="page-header-action-set flex items-center gap-2">
      {primary && <div className="page-header-action-primary">{primary}</div>}
      {secondary && <div className={cn("flex items-center gap-2", overflow && "page-header-action-secondary")}>{secondary}</div>}
      {overflow && <div className="page-header-action-overflow shrink-0">{overflow}</div>}
    </div>
  );
}
