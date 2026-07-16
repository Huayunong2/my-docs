import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, FileText, FolderArchive } from "lucide-react";
import * as api from "../lib/api";
import type { Article, ArticleSummary } from "../lib/api";
import ArticleDetail from "./ArticleDetail";
import { useConfirmDialog } from "./ui/Feedback";

interface MonthGroup {
  year: number;
  months: number[];
}

const MONTH_NAMES = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];

function MonthTitle({ yearMonth }: { yearMonth: string }) {
  const [y, m] = yearMonth.split("-").map(Number);
  return (
    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-1">
      {y} 年 {MONTH_NAMES[m - 1] || `${m}月`}
    </h3>
  );
}

export default function ArchivePage({ onEditDate }: { onEditDate: (date: string) => void }) {
  const [groups, setGroups] = useState<MonthGroup[]>([]);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewingArticle, setViewingArticle] = useState<Article | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => {
    api.getArchiveMonths().then((months) => {
      const map = new Map<number, number[]>();
      for (const m of months) {
        if (!map.has(m.year)) map.set(m.year, []);
        map.get(m.year)!.push(m.month);
      }
      const gs: MonthGroup[] = [];
      for (const [year, months] of map) {
        gs.push({ year, months: [...new Set(months)].sort((a, b) => b - a) });
      }
      gs.sort((a, b) => b.year - a.year);
      setGroups(gs);
      setLoading(false);
    });
  }, []);

  const loadMonth = useCallback(async (year: number, month: number) => {
    const key = `${year}-${month}`;
    if (expandedMonth === key) {
      setExpandedMonth(null);
      return;
    }
    setExpandedMonth(key);
    try {
      const list = await api.getArticlesByMonth(year, month);
      setArticles(list);
    } catch (e) {
      setError(api.getErrorMessage(e));
    }
  }, [expandedMonth]);

  const selectMonth = (year: number, month: number) => {
    loadMonth(year, month);
    setMobilePanelOpen(false);
  };

  const openArticle = async (id: string) => {
    try {
      const a = await api.getArticle(id);
      setViewingArticle(a);
    } catch (e) { setError(api.getErrorMessage(e)); }
  };

  const editDate = (date: string) => {
    setViewingArticle(null);
    onEditDate(date);
  };

  const deleteArticle = async (article: Article) => {
    const ok = await confirm({
      title: "删除记录",
      message: `确定要删除 ${article.date} 的记录吗？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await api.deleteArticle(article.id);
    setViewingArticle(null);
    setArticles((prev) => prev.filter((item) => item.id !== article.id));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="h-full flex flex-col md:flex-row">
      {/* ── Desktop tree ── */}
      <div className="hidden md:block w-[220px] min-w-[220px] border-r border-gray-100 dark:border-gray-700 overflow-y-auto px-4 py-6">
        <ArchiveTree groups={groups} loading={loading} expandedYear={expandedYear} expandedMonth={expandedMonth} setExpandedYear={setExpandedYear} selectMonth={selectMonth} />
      </div>

      {/* ── Mobile selector ── */}
      <div className="md:hidden px-4 pt-3 pb-1 border-b border-gray-100 dark:border-gray-700">
        <button
          onClick={() => setMobilePanelOpen(!mobilePanelOpen)}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-600/50 text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          <span className="flex items-center gap-2">
            <FolderArchive size={16} className="text-gray-400" />
            {expandedMonth ? <MonthTitle yearMonth={expandedMonth} /> : "选择月份"}
          </span>
          <motion.span animate={{ rotate: mobilePanelOpen ? 180 : 0 }} className="text-gray-400">
            <ChevronDown size={16} />
          </motion.span>
        </button>
        <AnimatePresence>
          {mobilePanelOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-2 pb-1 max-h-[40vh] overflow-y-auto">
                <ArchiveTree groups={groups} loading={loading} expandedYear={expandedYear} expandedMonth={expandedMonth} setExpandedYear={setExpandedYear} selectMonth={selectMonth} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Articles ── */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6">
        {error && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline">关闭</button>
          </div>
        )}
        {expandedMonth ? (
          <>
            <div className="hidden md:block"><MonthTitle yearMonth={expandedMonth} /></div>
            {articles.length === 0 ? (
              <div className="text-center py-16 text-gray-300 dark:text-gray-500">
                <FileText size={30} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p className="text-sm">该月没有记录</p>
              </div>
            ) : (
              <div className="space-y-2">
                {articles.map((a) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => openArticle(a.id)}
                    className="p-3 rounded-xl cursor-pointer border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 hover:shadow-sm transition-all duration-150"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 dark:text-gray-400 font-mono">{a.date}</span>
                      {a.mood && <span>{a.mood}</span>}
                    </div>
                    <h4 className="font-medium text-sm text-gray-700 dark:text-gray-200 mt-0.5">{a.title || "(无标题)"}</h4>
                    <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5 line-clamp-2">{a.preview}</p>
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
              </div>
            )}
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-300 dark:text-gray-500">
            <div className="text-center">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-white/[0.06] dark:text-gray-500">
                <FolderArchive size={24} />
              </span>
              <p className="text-sm">选择一个月份查看记录</p>
            </div>
          </div>
        )}
      </div>

      {/* Full-screen reader — unchanged */}
      <AnimatePresence>
        {viewingArticle && (
          <ArticleDetail
            article={viewingArticle}
            onClose={() => setViewingArticle(null)}
            onEdit={editDate}
            onDelete={deleteArticle}
          />
        )}
      </AnimatePresence>
      {dialog}
    </motion.div>
  );
}

// ── Shared tree component ──
function ArchiveTree({
  groups, loading, expandedYear, expandedMonth, setExpandedYear, selectMonth,
}: {
  groups: MonthGroup[]; loading: boolean;
  expandedYear: number | null; expandedMonth: string | null;
  setExpandedYear: (y: number | null) => void;
  selectMonth: (year: number, month: number) => void;
}) {
  if (loading) return <div className="text-sm text-gray-400 dark:text-gray-400 px-2 py-2">加载中...</div>;
  if (groups.length === 0) return <div className="text-sm text-gray-400 dark:text-gray-400 px-2 py-2">暂无记录</div>;

  return (
    <div className="space-y-0.5">
      {groups.map((g) => (
        <div key={g.year}>
          <button
            onClick={() => setExpandedYear(expandedYear === g.year ? null : g.year)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors duration-150"
          >
            <motion.span animate={{ rotate: expandedYear === g.year ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-gray-400 dark:text-gray-400">
              <ChevronRight size={14} />
            </motion.span>
            {g.year} 年
          </button>
          <AnimatePresence>
            {expandedYear === g.year && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden ml-4">
                {g.months.map((m) => {
                  const key = `${g.year}-${m}`;
                  const isActive = expandedMonth === key;
                  return (
                    <button
                      key={key}
                      onClick={() => selectMonth(g.year, m)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors duration-150 ${
                        isActive ? "text-accent bg-accent-light dark:bg-accent-light/20" : "text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50"
                      }`}
                    >
                      {m} 月
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
