import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  Folder,
  FolderCog,
  Hash,
  Inbox,
  LayoutGrid,
  List,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type {
  KnowledgeCard,
  KnowledgeCardStatus,
  KnowledgeCardSort,
  KnowledgeProject,
  KnowledgeSummary,
  KnowledgeTagCount,
} from "../../lib/api";
import { cardStatusLabels, cardTypeLabels } from "../../lib/cardLabels";
import {
  knowledgeDate,
  knowledgeExcerpt,
  isKnowledgeShortcut,
} from "../../lib/knowledgePresentation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

export interface LibraryFilter {
  label: string;
  onRemove: () => void;
}
interface Props {
  cards: KnowledgeCard[];
  summary: KnowledgeSummary;
  spaces: KnowledgeProject[];
  tags: KnowledgeTagCount[];
  total: number;
  loading: boolean;
  error: boolean;
  status: "all" | KnowledgeCardStatus;
  project: string;
  tag: string;
  query: string;
  sort: KnowledgeCardSort;
  density: "comfortable" | "compact";
  selectedIds: string[];
  activeId: string | null;
  filters: LibraryFilter[];
  page: number;
  pageCount: number;
  detailVisible: boolean;
  focused: boolean;
  detail: ReactNode;
  batchBar: ReactNode;
  spaceOverview: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: { label: string; onClick: () => void } | null;
  onStatus: (status: "all" | KnowledgeCardStatus) => void;
  onProject: (name: string) => void;
  onTag: (tag: string) => void;
  onQuery: (query: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onFilters: () => void;
  onReset: () => void;
  onSort: (sort: string) => void;
  onDensity: (density: "comfortable" | "compact") => void;
  onSelect: (id: string) => void;
  onSelectAll: () => void;
  onInvert: () => void;
  onOpen: (card: KnowledgeCard) => void;
  onCardStatus: (card: KnowledgeCard) => void;
  onDelete: (card: KnowledgeCard) => void;
  onPage: (page: number) => void;
  onNew: () => void;
  onManageSpaces: () => void;
  cardSearch: Record<string, unknown>;
  busy: boolean;
}
const statuses = ["all", "draft", "confirmed", "outdated"] as const;
const sortLabels = {
  updated: "最近更新",
  created: "最近创建",
  usage: "使用最多",
  review: "优先复习",
} as const;

export default function KnowledgeLibrary(p: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [spaceQuery, setSpaceQuery] = useState("");
  const visibleSpaces = useMemo(
    () =>
      p.spaces.filter((space) =>
        space.name
          .toLocaleLowerCase()
          .includes(spaceQuery.trim().toLocaleLowerCase()),
      ),
    [p.spaces, spaceQuery],
  );
  const allSelected =
    p.cards.length > 0 &&
    p.cards.every((card) => p.selectedIds.includes(card.id));
  const someSelected = p.cards.some((card) => p.selectedIds.includes(card.id));
  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        !isKnowledgeShortcut(event) ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        ) ||
        p.detailVisible
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key.toLowerCase() === "n" && !event.shiftKey) {
        event.preventDefault();
        p.onNew();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [p.detailVisible, p.onNew]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [p.page, p.project, p.status, p.tag, p.sort]);

  return (
    <div
      className="kl-workspace"
      data-detail={p.detailVisible}
      data-focused={p.focused}
    >
      <aside className="kl-nav" aria-label="知识导航">
        <div className="kl-nav-section">
          <span className="kl-eyebrow">知识库</span>
          <button
            className="kl-nav-item"
            data-active={!p.project && p.status === "all"}
            onClick={p.onReset}
          >
            <BookOpen size={17} />
            <span>全部知识</span>
            {!p.project && <small>{p.summary.total}</small>}
          </button>
          <button
            className="kl-nav-item"
            data-active={p.status === "draft"}
            onClick={() => p.onStatus("draft")}
          >
            <Inbox size={17} />
            <span>待确认</span>
            {p.summary.draft > 0 && (
              <small className="kl-count-warm">{p.summary.draft}</small>
            )}
          </button>
          <button
            className="kl-nav-item"
            data-active={p.status === "confirmed"}
            onClick={() => p.onStatus("confirmed")}
          >
            <CheckCircle2 size={17} />
            <span>已沉淀</span>
            <small>{p.summary.confirmed}</small>
          </button>
        </div>
        <div className="kl-nav-section kl-nav-spaces">
          <div className="kl-section-line">
            <span className="kl-eyebrow">
              空间 <span>{p.spaces.length}</span>
            </span>
            <button
              className="kl-icon"
              onClick={p.onManageSpaces}
              aria-label="管理空间"
              title="管理空间"
            >
              <FolderCog size={15} />
            </button>
          </div>
          {p.spaces.length > 6 && (
            <label className="kl-space-search">
              <Search size={13} />
              <input
                aria-label="查找空间"
                placeholder="查找空间"
                value={spaceQuery}
                onChange={(event) => setSpaceQuery(event.target.value)}
              />
            </label>
          )}
          <div className="kl-space-list">
            {visibleSpaces.map((space) => (
              <button
                key={space.name}
                className="kl-nav-item"
                data-active={p.project === space.name}
                onClick={() =>
                  p.onProject(p.project === space.name ? "" : space.name)
                }
                title={space.description || space.name}
              >
                {space.kind === "project" ? (
                  <Boxes size={16} />
                ) : (
                  <Folder size={16} />
                )}
                <span>{space.name}</span>
                <small>{space.count}</small>
              </button>
            ))}
            {p.spaces.length === 0 && (
              <button className="kl-nav-empty" onClick={p.onManageSpaces}>
                创建主题或项目空间
                <ArrowUpRight size={14} />
              </button>
            )}
            {p.spaces.length > 0 && visibleSpaces.length === 0 && (
              <p className="kl-muted-note">没有匹配的空间</p>
            )}
          </div>
        </div>
        {p.tags.length > 0 && (
          <div className="kl-nav-section">
            <div className="kl-section-line">
              <span className="kl-eyebrow">常用标签</span>
              <button className="kl-text-button" onClick={p.onFilters}>
                全部
              </button>
            </div>
            <div className="kl-nav-tags">
              {p.tags.slice(0, 8).map(({ tag }) => (
                <button
                  key={tag}
                  data-active={p.tag === tag}
                  onClick={() => p.onTag(p.tag === tag ? "" : tag)}
                >
                  <Hash size={12} />
                  <span>{tag}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="kl-nav-footer">
          <Link
            to="/knowledge/trash"
            search={{} as never}
            className="kl-nav-item"
          >
            <Trash2 size={16} />
            <span>知识回收站</span>
            <ChevronRight size={14} />
          </Link>
          <p>移除的条目仍可恢复</p>
        </div>
      </aside>
      <section className="kl-library" aria-label="知识浏览">
        <div className="kl-library-top">
          <div className="kl-collection-heading">
            <div>
              <div className="kl-eyebrow">
                {p.project ? "空间" : "我的知识库"}
              </div>
              <h2 title={p.project || "全部知识"}>
                {p.project || "全部知识"}
                <span>{p.summary.total}</span>
              </h2>
            </div>
            <button
              className="kl-mobile-space kl-icon"
              onClick={p.onFilters}
              aria-label="选择空间"
            >
              <Folder size={18} />
            </button>
          </div>
          <form
            className="kl-search-line"
            onSubmit={(event) => {
              event.preventDefault();
              if (!composing.current) p.onSearch();
            }}
          >
            <div className="kl-search">
              <Search size={17} />
              <input
                ref={searchRef}
                type="search"
                value={p.query}
                onChange={(event) => p.onQuery(event.target.value)}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.nativeEvent.isComposing || event.keyCode === 229)
                  )
                    event.preventDefault();
                }}
                aria-label="搜索知识条目"
                placeholder="搜索标题、正文或来源"
              />
              {p.query ? (
                <button
                  type="button"
                  className="kl-icon"
                  onClick={p.onClearSearch}
                  aria-label="清除搜索"
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd>/</kbd>
              )}
              <button
                className="kl-search-submit"
                type="submit"
                aria-label="执行搜索"
              >
                搜索
              </button>
            </div>
            <button
              type="button"
              className="kl-filter-button"
              onClick={p.onFilters}
              aria-label="打开搜索与筛选"
            >
              <SlidersHorizontal size={16} />
              <span>筛选</span>
              {p.filters.length > 0 && <b>{p.filters.length}</b>}
            </button>
          </form>
          <div className="kl-viewbar">
            <Tabs
              value={p.status}
              onValueChange={(value) => p.onStatus(value as Props["status"])}
              className="kl-status-tabs"
            >
              <TabsList>
                {statuses.map((status) => (
                  <TabsTrigger key={status} value={status}>
                    {status === "all" ? "全部" : cardStatusLabels[status]}
                    <span>
                      {status === "all" ? p.summary.total : p.summary[status]}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="kl-display-tools">
              <Select value={p.sort} onValueChange={p.onSort}>
                <SelectTrigger aria-label="知识条目排序" className="kl-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {Object.entries(sortLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div
                className="kl-layout-toggle"
                role="group"
                aria-label="知识展示方式"
              >
                <button
                  aria-label="卡片视图"
                  aria-pressed={p.density === "comfortable"}
                  onClick={() => p.onDensity("comfortable")}
                  title="卡片视图"
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  aria-label="列表视图"
                  aria-pressed={p.density === "compact"}
                  onClick={() => p.onDensity("compact")}
                  title="列表视图"
                >
                  <List size={17} />
                </button>
              </div>
            </div>
          </div>
          {p.filters.length > 0 && (
            <div className="kl-active-filters" aria-label="已应用的筛选条件">
              {p.filters.map((filter) => (
                <button key={filter.label} onClick={filter.onRemove}>
                  {filter.label}
                  <X size={12} />
                </button>
              ))}
              <button className="kl-clear-filters" onClick={p.onReset}>
                清除全部
              </button>
            </div>
          )}
          {p.cards.length > 0 && (
            <div className="kl-selection-line">
              <label>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={p.onSelectAll}
                  aria-label="选择当前页全部知识条目"
                />
                <span>
                  {p.selectedIds.length
                    ? `已选 ${p.selectedIds.length} 项`
                    : "选择本页"}
                </span>
              </label>
              <span className="kl-result-count" aria-live="polite">
                {p.loading ? "更新中…" : `${p.total} 个条目`}
              </span>
              {p.selectedIds.length > 0 && (
                <button onClick={p.onInvert} className="kl-text-button">
                  反选
                </button>
              )}
            </div>
          )}
          {p.batchBar}
        </div>
        <div
          ref={scrollRef}
          className="kl-library-scroll"
          aria-busy={p.loading}
        >
          {p.spaceOverview}
          {p.loading && p.cards.length === 0 ? (
            <div
              className="kl-collection"
              data-layout={p.density}
              aria-label="正在加载知识条目"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="kl-card kl-skeleton">
                  <div className="ui-skeleton" />
                  <div className="ui-skeleton" />
                  <div className="ui-skeleton" />
                </div>
              ))}
            </div>
          ) : p.cards.length === 0 ? (
            <div className="kl-empty">
              <div className="kl-empty-symbol">
                <BookOpen size={32} strokeWidth={1.4} />
              </div>
              <h3>{p.error ? "暂时无法读取知识库" : p.emptyTitle}</h3>
              <p>
                {p.error
                  ? "请检查页面上方的连接提示并重试，已有内容不会丢失。"
                  : p.emptyDescription}
              </p>
              {!p.error && p.emptyAction && (
                <button
                  className="ui-button-primary"
                  onClick={p.emptyAction.onClick}
                >
                  {p.emptyAction.label}
                  <ArrowUpRight size={15} />
                </button>
              )}
            </div>
          ) : (
            <div
              className="kl-collection"
              data-layout={p.density}
              data-selecting={p.selectedIds.length > 0}
              data-loading={p.loading}
            >
              {p.cards.map((card) => (
                <article
                  className="kl-card"
                  key={card.id}
                  data-selected={p.selectedIds.includes(card.id)}
                  data-active={p.detailVisible && p.activeId === card.id}
                >
                  <div className="kl-card-top">
                    <span className="kl-type" data-type={card.card_type}>
                      {card.card_type === "snippet" ? (
                        <Code2 size={15} />
                      ) : (
                        <FileText size={15} />
                      )}
                      {cardTypeLabels[card.card_type]}
                    </span>
                    <span className="kl-status" data-status={card.status}>
                      <i />
                      {cardStatusLabels[card.status]}
                    </span>
                  </div>
                  <label className="kl-card-check">
                    <input
                      type="checkbox"
                      checked={p.selectedIds.includes(card.id)}
                      onChange={() => p.onSelect(card.id)}
                      aria-label={`${p.selectedIds.includes(card.id) ? "取消选择" : "选择"}：${card.title}`}
                    />
                  </label>
                  <Link
                    to="/knowledge/$cardId"
                    params={{ cardId: card.id }}
                    search={{ ...p.cardSearch, view: "detail" } as never}
                    className="kl-card-link"
                    data-card-id={card.id}
                    onClick={(event) => {
                      if (
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey ||
                        event.defaultPrevented
                      )
                        return;
                      event.preventDefault();
                      p.onOpen(card);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                        return;
                      event.preventDefault();
                      const links = Array.from(
                        scrollRef.current?.querySelectorAll<HTMLAnchorElement>(
                          ".kl-card-link",
                        ) || [],
                      );
                      const index = links.indexOf(event.currentTarget);
                      links[
                        index + (event.key === "ArrowDown" ? 1 : -1)
                      ]?.focus();
                    }}
                    aria-label={`阅读：${card.title}`}
                  >
                    <h3>{card.title}</h3>
                    <p className="kl-card-preview">
                      {knowledgeExcerpt(card.content) || "暂无正文"}
                    </p>
                    <div className="kl-card-tags">
                      {card.tags.slice(0, 2).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                      {card.tags.length > 2 && (
                        <span>+{card.tags.length - 2}</span>
                      )}
                    </div>
                    <div className="kl-card-meta">
                      <span>
                        <Folder size={12} />
                        {card.projects?.[0] || "未归入空间"}
                        {(card.projects?.length || 0) > 1
                          ? ` +${card.projects!.length - 1}`
                          : ""}
                      </span>
                      <time
                        dateTime={card.updated_at}
                        title={`更新于 ${knowledgeDate(card.updated_at)}`}
                      >
                        {knowledgeDate(card.updated_at)}
                      </time>
                    </div>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="kl-card-menu kl-icon"
                        aria-label={`知识条目操作：${card.title}`}
                        disabled={p.busy}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>知识条目</DropdownMenuLabel>
                      <DropdownMenuItem onSelect={() => p.onOpen(card)}>
                        <BookOpen size={14} />
                        打开阅读
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => p.onCardStatus(card)}>
                        <Check size={14} />
                        {card.status === "draft"
                          ? "确认沉淀"
                          : card.status === "outdated"
                            ? "恢复为已确认"
                            : "标记为过时"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => p.onDelete(card)}
                        className="text-[var(--ui-danger-text)]"
                      >
                        <Trash2 size={14} />
                        移入回收站
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </article>
              ))}
            </div>
          )}
        </div>
        <footer className="kl-pagination">
          <span>
            {p.total > 0
              ? `第 ${p.page} / ${p.pageCount} 页`
              : "知识从一条记录开始"}
            <span className="kl-key-hint"> · N 新建</span>
          </span>
          <div>
            <button
              className="kl-icon"
              aria-label="上一页"
              disabled={p.page <= 1 || p.loading}
              onClick={() => p.onPage(p.page - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="kl-icon"
              aria-label="下一页"
              disabled={p.page >= p.pageCount || p.loading}
              onClick={() => p.onPage(p.page + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </footer>
      </section>
      {p.detailVisible && p.detail}
    </div>
  );
}
