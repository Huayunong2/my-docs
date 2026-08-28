import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, FileText, Folder, FolderArchive } from "lucide-react";
import * as api from "../lib/api";
import type { Article, ArticleSummary } from "../lib/api";
import ArticleDetail from "./ArticleDetail";
import { EmptyState, useConfirmDialog } from "./ui/Feedback";
import PageHeader from "./ui/PageHeader";

interface MonthGroup {
  year: number;
  months: number[];
}

const MONTH_NAMES = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];

function MonthTitle({ yearMonth }: { yearMonth: string }) {
  const [y, m] = yearMonth.split("-").map(Number);
  return (
    <span className="text-sm font-semibold text-[var(--ui-text)]">
      {y} 年 {MONTH_NAMES[m - 1] || `${m}月`}
    </span>
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
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="page-surface page-surface-archive h-full flex flex-col md:flex-row">
      {/* ── Desktop tree ── */}
      <div className="hidden w-[220px] min-w-[220px] overflow-y-auto border-r px-4 py-6 md:block ui-soft-divider">
        <ArchiveTree groups={groups} loading={loading} expandedYear={expandedYear} expandedMonth={expandedMonth} setExpandedYear={setExpandedYear} selectMonth={selectMonth} />
      </div>

      {/* ── Mobile selector ── */}
      <div className="border-b px-4 pb-1 pt-3 md:hidden ui-soft-divider">
        <button
          type="button"
          onClick={() => setMobilePanelOpen(!mobilePanelOpen)}
          className="ui-mobile-control flex w-full items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <FolderArchive size={16} className="text-[var(--ui-text-subtle)]" />
            {expandedMonth ? <MonthTitle yearMonth={expandedMonth} /> : "选择月份"}
          </span>
          <motion.span animate={{ rotate: mobilePanelOpen ? 180 : 0 }} className="text-[var(--ui-text-muted)]">
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
        <PageHeader
          icon={FolderArchive}
          title="归档"
          description={expandedMonth ? `正在查看 ${expandedMonth.replace("-", " 年 ")} 月的历史记录` : "按年月浏览已归档的每日记录"}
          className="mb-4"
        />
        {error && (
          <div className="ui-alert-bad mb-3 flex items-start justify-between gap-2" role="alert">
            {error}
            <button type="button" onClick={() => setError("")} className="shrink-0 underline underline-offset-2">关闭</button>
          </div>
        )}
        {expandedMonth ? (
          <>
            {articles.length === 0 ? (
              <EmptyState icon={FileText} title="该月没有记录" description="选择其他月份，或回到今日页面创建一条记录。" />
            ) : (
              <div className="space-y-2">
                {articles.map((a) => (
                  <motion.button
                    key={a.id}
                    type="button"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => openArticle(a.id)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openArticle(a.id); } }}
                    aria-label={`打开 ${a.date} 的记录`}
                    className="ui-panel card-interactive block w-full p-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-[var(--ui-text-subtle)]">{a.date}</span>
                      {a.mood && <span>{a.mood}</span>}
                    </div>
                    <h4 className="mt-0.5 text-sm font-medium text-[var(--ui-text)]">{a.title || "(无标题)"}</h4>
                    <p className="mt-0.5 line-clamp-2 text-xs text-[var(--ui-text-muted)]">{a.preview}</p>
                    {(a.spaces?.length || a.tags.length > 0) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(a.spaces || []).map((space) => (
                          <span key={space} className="ui-chip h-6 gap-1 border-[var(--ui-selected-border)] bg-[var(--ui-surface-selected)] px-2 py-0 text-[11px] text-[var(--ui-accent-text)]">
                            <Folder size={10} /> {space}
                          </span>
                        ))}
                        {a.tags.map((tag) => (
                          <span key={tag} className="ui-chip h-6 px-2 py-0 text-[11px]">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--ui-text-subtle)]">
            <div className="text-center">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ui-surface-inset)] text-[var(--ui-text-subtle)]">
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
  if (loading) return <div className="px-2 py-2 text-sm text-[var(--ui-text-subtle)]">加载中...</div>;
  if (groups.length === 0) return <div className="px-2 py-2 text-sm text-[var(--ui-text-subtle)]">暂无记录</div>;

  return (
    <div className="space-y-0.5">
      {groups.map((g) => (
        <div key={g.year}>
          <button
            type="button"
            onClick={() => setExpandedYear(expandedYear === g.year ? null : g.year)}
            className="ui-nav-item w-full gap-2 px-3 py-2 text-sm font-medium"
          >
            <motion.span animate={{ rotate: expandedYear === g.year ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-[var(--ui-text-subtle)]">
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
                      type="button"
                      onClick={() => selectMonth(g.year, m)}
                      className={["ui-nav-item w-full gap-2 px-3 py-1.5 text-sm", isActive ? "ui-nav-item-active" : ""].join(" ")}
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
