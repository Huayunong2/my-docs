import { motion } from "framer-motion";
import {
  Archive,
  BarChart3,
  BookOpenText,
  BookMarked,
  CalendarDays,
  FileText,
  Moon,
  NotebookPen,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Page } from "../App";

const navItems: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: "today", label: "记录", icon: NotebookPen },
  { id: "history", label: "历史", icon: CalendarDays },
  { id: "archive", label: "归档", icon: Archive },
  { id: "search", label: "搜索", icon: Search },
  { id: "stats", label: "统计", icon: BarChart3 },
  { id: "reviews", label: "复盘", icon: BookOpenText },
  { id: "knowledge", label: "知识", icon: BookMarked },
  { id: "settings", label: "设置", icon: Settings },
];

interface SidebarProps {
  page: Page;
  onNavigate: (p: Page) => void;
  dark: boolean;
  onToggleDark: () => void;
}

export default function Sidebar({ page, onNavigate, dark, onToggleDark }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-[220px] min-w-[220px] h-full glass bg-sidebar dark:bg-sidebar-dark border-r border-gray-200/50 dark:border-white/10 flex-col select-none z-10">
        <DesktopSidebar page={page} onNavigate={onNavigate} dark={dark} onToggleDark={onToggleDark} />
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 grid grid-cols-9 gap-0.5 border-t border-gray-200 bg-white px-2 py-1 safe-bottom shadow-[0_-8px_24px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-gray-950">
        {navItems.map((item) => (
          <MobileNavButton
            key={item.id}
            item={item}
            active={page === item.id}
            onClick={() => onNavigate(item.id)}
          />
        ))}
        <button
          onClick={onToggleDark}
          className="relative flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-gray-300 transition-colors active:scale-95 dark:text-gray-500"
          title={dark ? "浅色模式" : "深色模式"}
        >
          {dark ? <Sun size={19} strokeWidth={2.1} /> : <Moon size={19} strokeWidth={2.1} />}
          <span className="text-[10px] font-medium leading-none">{dark ? "浅色" : "深色"}</span>
        </button>
      </nav>
    </>
  );
}

function DesktopSidebar({ page, onNavigate, dark, onToggleDark }: SidebarProps) {
  const ThemeIcon = dark ? Sun : Moon;
  return (
    <>
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-sm shadow-accent/20">
            <FileText size={18} strokeWidth={2.2} />
          </span>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100 tracking-tight">
            每日总结
          </h1>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">
          记录每一天
        </p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavButton
              key={item.id}
              active={page === item.id}
              onClick={() => onNavigate(item.id)}
            >
              <Icon className="mr-3" size={18} strokeWidth={page === item.id ? 2.4 : 2.1} />
              {item.label}
            </NavButton>
          );
        })}
      </nav>

      <div className="px-3 pb-5">
        <button
          onClick={onToggleDark}
          className="
            w-full flex items-center gap-3 px-4 py-2.5 rounded-xl
            text-sm text-gray-500 dark:text-gray-400
            hover:bg-gray-100/70 dark:hover:bg-white/10
            transition-colors duration-200
          "
        >
          <ThemeIcon size={17} strokeWidth={2.1} />
          {dark ? "浅色模式" : "深色模式"}
        </button>
      </div>
    </>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={`
        w-full flex items-center px-3.5 py-2.5 rounded-xl text-sm font-medium
        transition-colors duration-200 relative
        ${
          active
            ? "text-accent bg-accent-light dark:bg-accent-light/20 shadow-sm"
            : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/70 dark:hover:bg-white/10"
        }
      `}
    >
      {children}
      {active && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute left-0 inset-y-2 w-[3px] rounded-r-full bg-accent"
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      )}
    </motion.button>
  );
}

function MobileNavButton({
  item,
  active,
  onClick,
}: {
  item: { id: Page; label: string; icon: LucideIcon };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={[
        "relative flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-1 py-1 transition-all duration-200 active:scale-95",
        active
          ? "bg-accent-light/70 text-accent dark:bg-accent-light/15"
          : "text-gray-300 dark:text-gray-500",
      ].join(" ")}
      title={item.label}
    >
      <Icon size={18} strokeWidth={active ? 2.35 : 2} />
      <span className="max-w-full truncate text-[10px] font-medium leading-none">{item.label}</span>
      {active && (
        <span className="absolute -top-0.5 h-0.5 w-4 rounded-full bg-accent/80" />
      )}
    </button>
  );
}
