import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUp, Keyboard, X } from "lucide-react";
import { isInteractionBlocked } from "../../lib/navigationInteractions";
import "./interactions.css";

export default function WorkspaceInteractions({
  pageKey,
  open,
  onOpenChange,
}: {
  pageKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [showTop, setShowTop] = useState(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const scrollTarget = useRef<HTMLElement | null>(null);
  const previousPage = useRef(pageKey);
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  const modifier = mac ? "⌘" : "Ctrl";
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        event.key !== "?" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isInteractionBlocked(event) ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      event.preventDefault();
      onOpenChange(true);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onOpenChange]);
  useEffect(() => {
    setShowTop(false);
    scrollTarget.current = null;
    if (previousPage.current === pageKey) return;
    previousPage.current = pageKey;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = document
      .getElementById("main-content")
      ?.animate([{ opacity: 0.78 }, { opacity: 1 }], {
        duration: 160,
        easing: "ease-out",
      });
    return () => animation?.cancel();
  }, [pageKey]);
  useEffect(() => {
    let frame = 0;
    const update = (event: Event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !target.closest("#main-content") ||
        target.closest('.cm-editor,textarea,[role="dialog"],[role="menu"]') ||
        target.scrollHeight <= target.clientHeight + 100
      )
        return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        scrollTarget.current = target;
        setShowTop(target.scrollTop > 500);
      });
    };
    document.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", update, true);
    };
  }, []);
  const shortcuts = [
    ["快速跳转", `${modifier} K`],
    ["折叠侧边栏", `${modifier} B`],
    ["查看快捷键", "?"],
    ["今日 / 记录 / 搜索", `${modifier} 1 / 2 / 4`],
    ["统计 / 复盘 / 知识", `${modifier} 5 / 6 / 7`],
    ["设置 / 复习", `${modifier} 8 / 9`],
    ["保存当前编辑", `${modifier} S`],
    ["关闭弹层", "Esc"],
  ];
  return (
    <>
      {showTop && !open && (
        <button
          type="button"
          className="ix-back-top"
          aria-label="返回顶部"
          title="返回当前阅读区域顶部"
          onClick={() =>
            scrollTarget.current?.scrollTo({
              top: 0,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            })
          }
        >
          <ArrowUp size={18} />
        </button>
      )}
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-[80]" />
          <Dialog.Content
            className="ix-shortcut-dialog"
            onOpenAutoFocus={() => {
              restoreFocus.current = document.activeElement as HTMLElement;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (restoreFocus.current?.isConnected)
                restoreFocus.current.focus();
            }}
          >
            <header>
              <Dialog.Title>
                <Keyboard size={19} />
                快捷键
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="shell-icon"
                  aria-label="关闭快捷键"
                >
                  <X size={18} />
                </button>
              </Dialog.Close>
            </header>
            <Dialog.Description>
              输入文字时，导航快捷键不会接管编辑操作。
            </Dialog.Description>
            <dl>
              {shortcuts.map(([label, keys]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <kbd>{keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
            <footer>
              侧边栏支持 ↑ ↓ 选择、Enter 打开；复习时 Space 显示答案，1–4 评分。
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
