import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  BarChart3,
  BookMarked,
  BookOpenText,
  Brain,
  CalendarDays,
  NotebookPen,
  Search,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Page } from "../App";

const commands: { id: Page; label: string; icon: LucideIcon; hint?: string }[] = [
  { id: "today", label: "记录", icon: NotebookPen, hint: "1" },
  { id: "history", label: "历史", icon: CalendarDays, hint: "2" },
  { id: "archive", label: "归档", icon: Archive, hint: "3" },
  { id: "search", label: "搜索", icon: Search, hint: "4" },
  { id: "stats", label: "统计", icon: BarChart3, hint: "5" },
  { id: "reviews", label: "复盘", icon: BookOpenText, hint: "6" },
  { id: "knowledge", label: "知识", icon: BookMarked, hint: "7" },
  { id: "settings", label: "设置", icon: Settings, hint: "8" },
  { id: "review", label: "复习", icon: Brain, hint: "9" },
];

export default function CommandPalette({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (p: Page) => void;
}) {
  const run = (p: Page) => {
    onNavigate(p);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="palette-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            key="palette-panel"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-[16%] z-50 w-[92vw] max-w-md -translate-x-1/2 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-modal dark:border-white/10 dark:bg-gray-900"
          >
            <Command loop onKeyDown={(e) => e.key === "Escape" && onClose()}>
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 dark:border-white/10">
                <Search size={16} className="shrink-0 text-gray-400" />
                <Command.Input
                  autoFocus
                  placeholder="跳转到页面…"
                  className="h-12 w-full bg-transparent text-sm text-gray-800 outline-hidden placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
                />
                <kbd className="shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:border-white/10 dark:bg-white/10">
                  Esc
                </kbd>
              </div>
              <Command.List className="max-h-72 overflow-y-auto p-1.5">
                <Command.Empty className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  无匹配页面
                </Command.Empty>
                {commands.map((c) => {
                  const Icon = c.icon;
                  return (
                    <Command.Item
                      key={c.id}
                      value={c.id}
                      onSelect={() => run(c.id)}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-600 transition-colors data-[selected=true]:bg-accent-light data-[selected=true]:text-accent dark:text-gray-300 dark:data-[selected=true]:bg-accent-light/20"
                    >
                      <Icon size={16} />
                      <span className="font-medium">{c.label}</span>
                      {c.hint && (
                        <kbd className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">Ctrl+{c.hint}</kbd>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.List>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
