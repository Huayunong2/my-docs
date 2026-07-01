import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

function textFromNode(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return textFromNode(props?.children);
  }
  return "";
}

function languageFromNode(node: unknown): string {
  if (Array.isArray(node)) {
    for (const item of node) {
      const language = languageFromNode(item);
      if (language) return language;
    }
  }
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { className?: string; "data-language"?: string; children?: unknown } }).props;
    if (props?.["data-language"]) return props["data-language"];
    const match = /language-([\w-]+)/.exec(props?.className || "");
    if (match) return match[1];
    return languageFromNode(props?.children);
  }
  return "";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-white/10 hover:text-gray-100"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

function PlainCodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <div className="group my-4 overflow-hidden rounded-xl border border-gray-200 bg-gray-950 shadow-sm dark:border-gray-700">
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
          {language || "code"}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6">
        <code className="block whitespace-pre font-mono text-gray-100">
          {code}
        </code>
      </pre>
    </div>
  );
}

function MermaidBlock({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"compact" | "fit" | "original">("compact");
  const [expanded, setExpanded] = useState(false);

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
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
          themeVariables: {
            fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            fontSize: "12px",
          },
          flowchart: {
            curve: "linear",
            diagramPadding: 6,
            nodeSpacing: 24,
            rankSpacing: 28,
            wrappingWidth: 120,
          },
        });
        const result = await mermaid.render(`mermaid-${id}-${Date.now()}`, chart);
        if (alive) setSvg(result.svg);
      } catch (e: any) {
        if (alive) setError(e?.message || "Mermaid 渲染失败");
      }
    }

    render();

    return () => {
      alive = false;
    };
  }, [chart, id]);

  return (
    <div className="my-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5 dark:border-gray-800 dark:bg-gray-800/70">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          mermaid
        </span>
        <div className="flex items-center gap-1">
          {(["compact", "fit", "original"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={[
                "rounded-md px-2 py-1 text-xs",
                viewMode === mode
                  ? "bg-accent text-white"
                  : "text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-white/10",
              ].join(" ")}
            >
              {mode === "compact" ? "紧凑" : mode === "fit" ? "适配" : "原始"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-white/10"
          >
            {expanded ? "收起" : "展开"}
          </button>
          <CopyButton text={chart} />
        </div>
      </div>
      {error ? (
        <div className="space-y-3 p-3">
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
          <PlainCodeBlock code={chart} language="mermaid" />
        </div>
      ) : svg ? (
        <div
          className={[
            "mermaid-diagram overflow-auto p-2 text-center sm:p-3",
            `mermaid-diagram--${viewMode}`,
            expanded ? "max-h-[75vh]" : "max-h-[360px]",
          ].join(" ")}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="p-5 flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <span className="text-sm text-gray-400 dark:text-gray-500">图表加载中...</span>
        </div>
      )}
    </div>
  );
}

function CodeBlock({ children }: { children: unknown }) {
  const code = textFromNode(children).replace(/\n$/, "");
  const language = languageFromNode(children);
  if (language.toLowerCase() === "mermaid") {
    return <MermaidBlock chart={code} />;
  }
  return <PlainCodeBlock code={code} language={language} />;
}

export default function MarkdownContent({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-gray-300 dark:text-gray-500 italic text-sm">输入 Markdown 内容以预览...</p>;
  }

  return (
    <div className="text-[15px] leading-7 text-gray-700 dark:text-gray-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
        h1: ({ children }) => <h1 className="mb-5 text-3xl font-bold leading-tight text-gray-950 dark:text-gray-50">{children}</h1>,
        h2: ({ children }) => <h2 className="mt-10 mb-4 border-b border-gray-200 pb-2 text-2xl font-bold leading-tight text-gray-950 dark:border-white/10 dark:text-gray-50">{children}</h2>,
        h3: ({ children }) => <h3 className="mt-8 mb-3 text-xl font-semibold leading-snug text-gray-800 dark:text-gray-100">{children}</h3>,
        p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="mb-4 pl-6 space-y-1.5 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="mb-4 pl-6 space-y-1.5 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-accent pl-4 italic my-3 text-gray-600 dark:text-gray-400">
            {children}
          </blockquote>
        ),
        code: ({ children, className }) => {
          const language = /language-([\w-]+)/.exec(className || "")?.[1] || "";
          return (
            <code
              data-language={language || undefined}
              className={`rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.92em] text-pink-600 dark:bg-gray-800 dark:text-pink-400 ${className || ""}`}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        a: ({ href, children }) => (
          <a href={href} className="text-accent underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        img: ({ src, alt }) => (
          <img src={src || ""} alt={alt || ""} className="rounded-lg max-w-full my-2" loading="lazy" />
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-left">{children}</th>,
        td: ({ children }) => <td className="border border-gray-200 dark:border-gray-700 px-2 py-1">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
