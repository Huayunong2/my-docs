import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Search, SearchX } from "lucide-react";
import * as api from "../lib/api";
import type { Article, ArticleSummary } from "../lib/api";
import ArticleDetail from "./ArticleDetail";
import { useConfirmDialog } from "./ui/Feedback";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryTerms(query: string): string[] {
  const raw = query.trim();
  if (!raw) return [];
  return Array.from(new Set([raw, ...raw.split(/\s+/)]))
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const terms = queryTerms(query);
  if (!terms.length || !text) return <>{text}</>;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((part, index) => {
        const matched = terms.some((term) => part.toLowerCase() === term.toLowerCase());
        return matched ? (
          <mark
            key={`${part}-${index}`}
            className="rounded bg-amber-200/80 px-0.5 text-gray-900 dark:bg-amber-400/30 dark:text-amber-100"
          >
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </>
  );
}

export default function SearchPage({
  onEditDate,
  initialQuery,
  initialNonce,
}: {
  onEditDate: (date: string) => void;
  initialQuery?: string;
  initialNonce?: number;
}) {
  const [query, setQuery] = useState(initialQuery || "");
  const [results, setResults] = useState<ArticleSummary[]>([]);
  const [detail, setDetail] = useState<Article | null>(null);
  const [activeTag, setActiveTag] = useState("");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { confirm, dialog } = useConfirmDialog();

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await api.searchArticles(q.trim());
      setResults(res);
      setActiveTag("");
    } catch (e: any) {
      setError(api.getErrorMessage(e));
      setResults([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      doSearch(initialQuery);
    }
  }, [doSearch, initialNonce]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => doSearch(v), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (timer.current) clearTimeout(timer.current);
      doSearch(query);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const article = await api.getArticle(id);
      setDetail(article);
    } catch (e: any) {
      setError(api.getErrorMessage(e));
    }
  };

  const deleteDetail = async (article: Article) => {
    const ok = await confirm({
      title: "删除记录",
      message: `确定要删除 ${article.date} 的记录吗？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteArticle(article.id);
      setDetail(null);
      setResults((prev) => prev.filter((item) => item.id !== article.id));
    } catch (e) {
      setError(api.getErrorMessage(e));
    }
  };

  const editDate = (date: string) => {
    setDetail(null);
    onEditDate(date);
  };

  const availableTags = Array.from(new Set(results.flatMap((item) => item.tags)));
  const visibleResults = activeTag
    ? results.filter((item) => item.tags.includes(activeTag))
    : results;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full flex flex-col px-8 py-6"
    >
      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">
        全文搜索
      </h2>

      {/* Search input */}
      <motion.div
        className="relative"
        initial={false}
        animate={query ? "focused" : "idle"}
      >
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="搜索标题或内容..."
          className="ui-field rounded-2xl px-5 py-3.5 text-base"
        />
        {loading && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
              className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full"
            />
          </div>
        )}
      </motion.div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto mt-4">
        <AnimatePresence mode="wait">
          {!searched && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex items-center justify-center text-gray-300 dark:text-gray-500"
            >
              <div className="text-center">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-white/[0.06] dark:text-gray-500">
                  <Search size={24} />
                </span>
                <p>输入关键词搜索你的记录</p>
              </div>
            </motion.div>
          )}

          {error && (
            <div className="text-center py-12">
              <AlertTriangle size={28} className="mx-auto mb-2 text-red-400" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {searched && !error && results.length === 0 && !loading && (
            <motion.div
              key="no-results"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-16 text-gray-400 dark:text-gray-400"
            >
              <SearchX size={30} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p className="text-sm">没有找到匹配的记录</p>
              <p className="text-xs mt-1">试试其他关键词</p>
            </motion.div>
          )}

          {results.length > 0 && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-2"
            >
              <p className="text-sm text-gray-400 dark:text-gray-400 mb-3">
                找到 {visibleResults.length} 条结果{activeTag ? ` · #${activeTag}` : ""}
              </p>
              {availableTags.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setActiveTag("")}
                    className={`rounded-full px-2 py-1 text-xs ${!activeTag ? "bg-accent text-white" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300"}`}
                  >
                    全部
                  </button>
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setActiveTag(tag)}
                      className={`rounded-full px-2 py-1 text-xs ${activeTag === tag ? "bg-accent text-white" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300"}`}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
              {visibleResults.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => openDetail(a.id)}
                  className="p-4 rounded-xl cursor-pointer border border-gray-100/80 dark:border-white/5 bg-white dark:bg-white/[0.04] hover:border-gray-200 dark:hover:border-white/10 hover:shadow-card-hover transition-all duration-200"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-400 dark:text-gray-400 font-mono">
                      {a.date}
                    </span>
                    {a.mood && <span>{a.mood}</span>}
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-medium text-gray-800 dark:text-gray-200">
                      <HighlightText text={a.title || "(无标题)"} query={query} />
                    </h4>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        editDate(a.date);
                      }}
                      className="text-xs text-accent hover:underline shrink-0"
                    >
                      编辑
                    </button>
                  </div>
                  <p className="text-sm text-gray-400 dark:text-gray-400 mt-1 line-clamp-2">
                    <HighlightText text={a.preview} query={query} />
                  </p>
                  {a.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {a.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {detail && (
          <ArticleDetail
            article={detail}
            onClose={() => setDetail(null)}
            onEdit={editDate}
            onDelete={deleteDetail}
          />
        )}
      </AnimatePresence>
      {dialog}
    </motion.div>
  );
}
