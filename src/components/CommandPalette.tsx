import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import {
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
  { id: "today", label: "今日", icon: NotebookPen, hint: "1" },
  { id: "history", label: "记录", icon: CalendarDays, hint: "2" },
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
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 data-[state=open]:animate-fade-in" />
        <Dialog.Content className="ui-modal-surface fixed left-1/2 top-[16%] z-50 w-[92vw] max-w-md -translate-x-1/2 overflow-hidden p-0 outline-hidden data-[state=open]:animate-scale-in">
          <Dialog.Title className="sr-only">快速导航</Dialog.Title>
          <Dialog.Description className="sr-only">搜索页面并使用键盘快捷键快速跳转。</Dialog.Description>
          <Command loop>
            <div className="ui-command-input-row flex items-center gap-2 border-b px-4">
              <Search size={16} className="shrink-0 text-[var(--ui-text-muted)]" />
              <Command.Input
                autoFocus
                placeholder="跳转到页面…"
                className="ui-command-input h-12 w-full bg-transparent text-sm outline-hidden"
              />
              <kbd className="ui-command-kbd shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
                Esc
              </kbd>
            </div>
            <Command.List className="max-h-72 overflow-y-auto p-1.5">
              <Command.Empty className="ui-command-empty px-3 py-6 text-center text-sm">
                无匹配页面
              </Command.Empty>
              {commands.map((c) => {
                const Icon = c.icon;
                return (
                  <Command.Item
                    key={c.id}
                    value={`${c.label} ${c.id}`}
                    onSelect={() => run(c.id)}
                    className="ui-command-item flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
                  >
                    <Icon size={16} />
                    <span className="font-medium">{c.label}</span>
                    {c.hint && (
                      <kbd className="ui-command-kbd ml-auto border-0 bg-transparent text-[10px]">Ctrl+{c.hint}</kbd>
                    )}
                  </Command.Item>
                );
              })}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
