import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import "./workspace.css";

export default function WorkspaceHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="wb-header">
      <div className="wb-heading">
        <span className="wb-heading-icon">
          <Icon size={22} strokeWidth={1.7} />
        </span>
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
      </div>
      {actions && <div className="wb-header-actions">{actions}</div>}
    </header>
  );
}
