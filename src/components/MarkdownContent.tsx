import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkWikiLink from "remark-wiki-link";
import { toast } from "sonner";
import type { PanzoomObject } from "@panzoom/panzoom";
import { Check, Copy, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { repairMarkdownFences } from "../lib/markdownFences";

function textFromNode(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return textFromNode(props?.children);
  }
  return "";
}

function propsFromNode(node: unknown): { className?: string; "data-language"?: string; children?: ReactNode } | null {
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  return (node as { props?: { className?: string; "data-language"?: string; children?: ReactNode } }).props || null;
}

function firstPropsFromNode(node: ReactNode): { className?: string; "data-language"?: string; children?: ReactNode } | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const props = firstPropsFromNode(item);
      if (props) return props;
    }
    return null;
  }
  return propsFromNode(node);
}

function languageFromNode(node: unknown): string {
  if (Array.isArray(node)) {
    for (const item of node) {
      const language = languageFromNode(item);
      if (language) return language;
    }
  }
  const props = propsFromNode(node);
  if (!props) return "";
  if (props["data-language"]) return props["data-language"];
  const token = (props.className || "").split(/\s+/).find((item) => item.startsWith("language-"));
  if (token) return token.slice("language-".length);
  return languageFromNode(props.children);
}

const LANGUAGE_ALIASES: Record<string, string> = {
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  md: "markdown",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
};

function normalizeLanguage(value: string): string {
  const normalized = value.trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] || normalized;
}

const MERMAID_MIN_SCALE = 0.5;
const MERMAID_MAX_SCALE = 12;

function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    if (typeof MutationObserver === "undefined") return undefined;
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await copyText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("复制失败，当前浏览器未允许访问剪贴板；请选中内容后复制。", { duration: 3200 });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="ui-button-ghost h-10 min-h-10 min-w-10 rounded-md px-2 text-xs md:h-8 md:min-h-8 md:min-w-0"
      aria-label={copied ? `${label}成功` : label}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span className="hidden sm:inline">{copied ? "已复制" : label}</span>
    </button>
  );
}

function PlainCodeBlock({
  code,
  language,
  children,
}: {
  code: string;
  language: string;
  children?: ReactNode;
}) {
  const content = children ?? code;
  const isEmpty = !code.trim();

  return (
    <div
      className="markdown-code-block group my-4 overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-code-surface)] shadow-xs"
      data-language={language || undefined}
    >
      <div className="ui-soft-divider flex min-h-9 items-center justify-between gap-3 border-b px-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--ui-text-subtle)]">{language || "code"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="markdown-code-scroll overflow-x-auto p-4 text-[13px] leading-6">
        <code className="block whitespace-pre font-mono text-[var(--ui-code-text)]">
          {isEmpty ? <span className="italic text-[var(--ui-text-subtle)]">代码块为空</span> : content}
        </code>
      </pre>
    </div>
  );
}

function MermaidControls({
  panzoom,
  zoomScale,
  ready,
  onCollapse,
  onReset,
  onZoomTo,
}: {
  panzoom: PanzoomObject | null;
  zoomScale: number;
  ready: boolean;
  onCollapse: () => void;
  onReset: () => void;
  onZoomTo: (scale: number) => void;
}) {
  const action = (callback: () => void) => {
    if (!ready || !panzoom) return;
    callback();
  };
  const sliderScale = Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, zoomScale));

  return (
    <div className="mermaid-controls mermaid-control flex min-w-0 flex-wrap items-center justify-end gap-1" role="toolbar" aria-label="Mermaid 图表缩放控制">
      <div className="flex min-w-0 items-center gap-1 rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-inset)] px-1">
        <span className="min-w-[3.25rem] text-right text-[11px] tabular-nums text-[var(--ui-text-subtle)]" aria-live="polite">
          {ready ? `${Math.round(zoomScale * 100)}%` : "加载中"}
        </span>
        <label className="flex h-10 min-h-10 items-center rounded-md px-1 md:h-8 md:min-h-8">
          <span className="sr-only">图表缩放比例</span>
          <input
            type="range"
            min={MERMAID_MIN_SCALE}
            max={MERMAID_MAX_SCALE}
            step={0.1}
            value={sliderScale}
            onChange={(event) => action(() => onZoomTo(Number(event.target.value)))}
            disabled={!ready}
            className="mermaid-zoom-range w-20 sm:w-28"
            aria-label="图表缩放比例"
          />
        </label>
      </div>
      <button type="button" onClick={() => action(() => panzoom?.zoomOut())} disabled={!ready} className="ui-button-ghost h-10 min-h-10 min-w-10 px-2 text-xs md:h-8 md:min-h-8 md:min-w-8" aria-label="缩小图表" title="缩小图表">
        <ZoomOut size={14} />
      </button>
      <button type="button" onClick={() => action(() => panzoom?.zoomIn())} disabled={!ready} className="ui-button-ghost h-10 min-h-10 min-w-10 px-2 text-xs md:h-8 md:min-h-8 md:min-w-8" aria-label="放大图表" title="放大图表">
        <ZoomIn size={14} />
      </button>
      <button type="button" onClick={() => action(onReset)} disabled={!ready} className="ui-button-ghost h-10 min-h-10 gap-1 px-2 text-xs md:h-8 md:min-h-8" aria-label="重置图表视图" title="重置视图">
        <RotateCcw size={13} /> <span className="hidden sm:inline">重置</span>
      </button>
      <button type="button" onClick={onCollapse} className="ui-button-secondary h-10 min-h-10 gap-1 px-2 text-xs md:h-8 md:min-h-8" aria-label="收起图表" title="收起图表">
        <Minimize2 size={13} /> <span className="hidden sm:inline">收起</span>
      </button>
      <span className="basis-full text-right text-[10px] leading-4 text-[var(--ui-text-subtle)]">可拖动、滚轮或双指缩放 · 50%–1200%</span>
    </div>
  );
}

function MermaidBlock({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"compact" | "fit" | "original">("fit");
  const [expanded, setExpanded] = useState(false);
  const [panzoom, setPanzoom] = useState<PanzoomObject | null>(null);
  const [panzoomReady, setPanzoomReady] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const diagramRef = useRef<HTMLDivElement>(null);
  const dark = useDarkMode();
  const zoomHintId = `${id}-zoom-hint`;

  useEffect(() => {
    let alive = true;

    setSvg("");
    setError("");

    async function render() {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: true,
          theme: dark ? "dark" : "default",
          themeVariables: {
            fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, Source Han Sans SC, sans-serif",
            fontSize: "14px",
          },
          flowchart: {
            curve: "linear",
            diagramPadding: 6,
            nodeSpacing: 24,
            rankSpacing: 28,
            wrappingWidth: 120,
            useMaxWidth: false,
          },
        });
        const result = await mermaid.render(`mermaid-${id}-${Date.now()}`, chart);
        if (alive) setSvg(result.svg);
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : "Mermaid 渲染失败，请检查图表语法。");
      }
    }

    void render();

    return () => {
      alive = false;
    };
  }, [chart, dark, id]);

  useEffect(() => {
    if (!diagramRef.current || !svg) return;
    // Keep the Mermaid DOM stable while Panzoom mutates the SVG transform.
    // Replacing dangerouslySetInnerHTML on every zoom-status render would
    // reset the transform and make the controls appear to do nothing.
    diagramRef.current.innerHTML = svg;
    const svgElement = diagramRef.current.querySelector("svg");
    if (svgElement && !svgElement.getAttribute("role")) svgElement.setAttribute("role", "img");
    if (svgElement && !svgElement.getAttribute("aria-labelledby") && !svgElement.getAttribute("aria-label")) {
      svgElement.setAttribute("aria-label", "Mermaid 图表");
    }
  }, [svg]);

  useEffect(() => {
    setPanzoom(null);
    setPanzoomReady(false);
    setZoomScale(1);
    if (!expanded || !svg || !diagramRef.current) return undefined;

    let alive = true;
    let instance: PanzoomObject | null = null;
    let svgElement: SVGElement | null = null;
    let wheelHandler: ((event: WheelEvent) => void) | null = null;
    let changeHandler: ((event: Event) => void) | null = null;

    const setup = async () => {
      svgElement = diagramRef.current?.querySelector("svg") || null;
      if (!svgElement) return;

      try {
        const { default: Panzoom } = await import("@panzoom/panzoom");
        if (!alive || !diagramRef.current || !svgElement) return;
        instance = Panzoom(svgElement, {
          canvas: true,
          cursor: "grab",
          maxScale: MERMAID_MAX_SCALE,
          minScale: MERMAID_MIN_SCALE,
          overflow: "auto",
          panOnlyWhenZoomed: true,
          pinchAndPan: true,
          step: 0.3,
          touchAction: "none",
        });
        if (!alive) {
          instance.resetStyle();
          instance.destroy();
          return;
        }

        changeHandler = (event) => {
          const scale = (event as CustomEvent<{ scale?: number }>).detail?.scale;
          if (typeof scale === "number") setZoomScale(scale);
        };
        svgElement.addEventListener("panzoomchange", changeHandler);

        wheelHandler = (event) => {
          if (!instance || (event.target instanceof Element && event.target.closest(".mermaid-control"))) return;
          event.preventDefault();
          instance.zoomWithWheel(event);
        };
        diagramRef.current.addEventListener("wheel", wheelHandler, { passive: false });

        setPanzoom(instance);
        setPanzoomReady(true);
        setZoomScale(instance.getScale());
      } catch {
        if (alive) toast.error("图表缩放控件加载失败，仍可使用显示模式。", { duration: 2600 });
      }
    };

    void setup();

    return () => {
      alive = false;
      if (wheelHandler && diagramRef.current) diagramRef.current.removeEventListener("wheel", wheelHandler);
      if (changeHandler && svgElement) svgElement.removeEventListener("panzoomchange", changeHandler);
      instance?.resetStyle();
      instance?.destroy();
      setPanzoom(null);
      setPanzoomReady(false);
    };
  }, [expanded, svg, viewMode]);

  const zoomTo = (scale: number) => {
    if (!panzoomReady || !panzoom) return;
    panzoom.zoom(Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, scale)), { animate: false });
  };

  return (
    <div className="ui-editor-surface my-3 overflow-hidden rounded-xl">
      <div className="mermaid-toolbar ui-soft-divider flex min-h-9 flex-col gap-2 border-b px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--ui-text-subtle)]">Mermaid 图表</span>
        <div className="mermaid-toolbar-actions flex w-full min-w-0 flex-wrap items-center justify-end gap-1 sm:w-auto sm:gap-1.5">
          <div className="ui-segment flex min-w-0 flex-1 items-center gap-0.5 p-0.5 sm:flex-none" role="group" aria-label="Mermaid 图表显示方式">
            {(["compact", "fit", "original"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={["ui-segment-item h-10 min-h-10 flex-1 px-2 text-xs sm:flex-none md:h-8 md:min-h-0", viewMode === mode ? "ui-segment-item-active" : ""].join(" ")}
                aria-pressed={viewMode === mode}
              >
                {mode === "compact" ? "紧凑" : mode === "fit" ? "适配" : "原始"}
              </button>
            ))}
          </div>
          {!expanded && (
            <button type="button" onClick={() => setExpanded(true)} className="ui-button-ghost h-10 min-h-10 gap-1 px-2 text-xs md:h-8 md:min-h-8" aria-label="展开图表" title="展开图表">
              <Maximize2 size={13} /> <span className="hidden sm:inline">展开</span>
            </button>
          )}
          <CopyButton text={chart} label="复制源码" />
        </div>
      </div>
      {expanded && (
        <div className="ui-soft-divider flex min-w-0 items-center justify-end border-b bg-[var(--ui-surface-inset)] px-3 py-1.5">
          <MermaidControls
            panzoom={panzoom}
            zoomScale={zoomScale}
            ready={panzoomReady}
            onCollapse={() => setExpanded(false)}
            onReset={() => panzoom?.reset({ animate: false })}
            onZoomTo={zoomTo}
          />
        </div>
      )}
      {error ? (
        <div className="space-y-3 p-3">
          <p className="ui-alert-bad" role="alert">Mermaid 渲染失败：{error}</p>
          <PlainCodeBlock code={chart} language="mermaid" />
        </div>
      ) : svg ? (
        <>
          <div
            ref={diagramRef}
            className={[
              "mermaid-diagram p-2 text-center sm:p-3",
              `mermaid-diagram--${viewMode}`,
              expanded ? "mermaid-diagram--expanded" : "max-h-[360px] overflow-auto",
            ].join(" ")}
            role="group"
            aria-label="Mermaid 图表"
            aria-describedby={zoomHintId}
          />
          <p id={zoomHintId} className="sr-only">展开图表后，可用拖动、滚轮或双指缩放查看细节；缩放范围为 50% 到 1200%。</p>
        </>
      ) : (
        <div className="flex items-center gap-3 p-5" role="status">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--ui-selected-border)] border-t-[var(--ui-accent-solid)]" />
          <span className="text-sm text-[var(--ui-text-subtle)]">图表加载中...</span>
        </div>
      )}
    </div>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const codeElementProps = firstPropsFromNode(children);
  const highlightedChildren = codeElementProps?.children ?? children;
  const code = textFromNode(highlightedChildren).replace(/\n$/, "");
  const language = normalizeLanguage(languageFromNode(children));
  if (language === "mermaid") return <MermaidBlock chart={code} />;
  return <PlainCodeBlock code={code} language={language}>{highlightedChildren}</PlainCodeBlock>;
}

function MarkdownFenceNotice({ content, onRepairContent }: { content: string; onRepairContent?: (fixedContent: string) => void }) {
  const repair = useMemo(() => repairMarkdownFences(content), [content]);
  if (!repair.issues.length) return null;

  const lineLabels = repair.issues.map((issue) => `第 ${issue.line} 行：${issue.message}`);
  const copyRepair = async () => {
    try {
      await copyText(repair.fixedContent);
      toast.success("修正版 Markdown 已复制。", { duration: 2200 });
    } catch {
      toast.error("复制失败，当前浏览器未允许访问剪贴板；请选中修正版内容后复制。", { duration: 3200 });
    }
  };

  return (
    <div className="ui-alert-warn my-3 flex flex-col gap-2 text-xs leading-5 sm:flex-row sm:items-start sm:justify-between" role="alert">
      <div className="min-w-0">
        <p className="font-semibold text-[var(--ui-warning-text)]">Markdown 围栏需要修复</p>
        <p>{lineLabels.join(" ")}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          if (onRepairContent) {
            onRepairContent(repair.fixedContent);
            toast.success("已应用 Markdown 修复，请保存后继续。", { duration: 2200 });
          } else {
            void copyRepair();
          }
        }}
        className="ui-button-secondary min-h-11 shrink-0 px-2.5 text-xs md:min-h-9"
      >
        {onRepairContent ? "应用修复" : "复制修正版"}
      </button>
    </div>
  );
}

type MarkdownContentProps = {
  content: string;
  onWikiLink?: (title: string) => void;
  onRepairContent?: (fixedContent: string) => void;
};

function MarkdownContent({ content, onWikiLink, onRepairContent }: MarkdownContentProps) {
  if (!content.trim()) {
    return <p className="text-sm italic text-[var(--ui-text-subtle)]">输入 Markdown 内容以预览...</p>;
  }

  return (
    <div className="min-w-0 max-w-full break-words text-[15px] leading-7 text-[var(--ui-text-muted)]">
      <MarkdownFenceNotice content={content} onRepairContent={onRepairContent} />
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          [
            remarkWikiLink,
            {
              aliasDivider: "|",
              pageResolver: (name: string) => [name],
              hrefTemplate: (permalink: string) => `wiki:${permalink}`,
            },
          ],
        ]}
        rehypePlugins={[
          rehypeSanitize,
          [rehypeHighlight, { detect: false, plainText: ["mermaid", "text", "txt", "plaintext"] }],
        ]}
        components={{
          h1: ({ children }) => <h1 className="mb-5 text-3xl font-bold leading-tight text-[var(--ui-text)]">{children}</h1>,
          h2: ({ children }) => <h2 className="ui-soft-divider mt-10 mb-4 border-b pb-2 text-2xl font-bold leading-tight text-[var(--ui-text)]">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-8 mb-3 text-xl font-semibold leading-snug text-[var(--ui-text)]">{children}</h3>,
          p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1.5 pl-6">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-4 rounded-xl border border-[var(--ui-quote-border)] bg-[var(--ui-quote-surface)] px-4 py-3 text-[var(--ui-quote-text)]">{children}</blockquote>
          ),
          code: ({ children, className }) => {
            const rawLanguage = (className || "").split(/\s+/).find((item) => item.startsWith("language-"))?.slice("language-".length) || "";
            const language = normalizeLanguage(rawLanguage);
            return (
              <code data-language={language || undefined} className={`ui-inline-code rounded px-1.5 py-0.5 font-mono text-[0.92em] ${className || ""}`}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => {
            if (href?.startsWith("wiki:")) {
              const title = decodeURIComponent(href.slice(5));
              return <button type="button" onClick={() => onWikiLink?.(title)} className="ui-wiki-link px-1 py-0.5 font-medium">{children}</button>;
            }
            return <a href={href} className="text-[var(--ui-accent-text)] underline" target="_blank" rel="noopener noreferrer">{children}</a>;
          },
          img: ({ src, alt }) => <img src={src || ""} alt={alt || ""} className="my-2 max-w-full rounded-lg" loading="lazy" />,
          table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="min-w-full border-collapse text-sm">{children}</table></div>,
          th: ({ children }) => <th className="border border-[var(--ui-border)] px-2 py-1 text-left">{children}</th>,
          td: ({ children }) => <td className="border border-[var(--ui-border)] px-2 py-1">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownContent);
