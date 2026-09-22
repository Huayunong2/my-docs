// Isolated browser regression: API calls are intercepted in memory; no real records are changed.
// Run against the loopback Vite development server. See docs/knowledge-ui-redesign.md.
const { chromium } = await import(
  process.env.KNOWLEDGE_PLAYWRIGHT_MODULE || "playwright-core"
);
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const out = process.env.KNOWLEDGE_UI_OUTPUT || "/tmp/daily-summary-final-audit";
await fs.mkdir(out, { recursive: true });
const examples = [
  [
    "理解所有权：让资源生命周期变得清晰",
    "concept",
    "C++ 与系统编程",
    ["Modern C++", "所有权"],
    "## 核心结论\n\n资源应当具有明确的拥有者。通过 RAII 把资源的生命周期绑定到对象，减少手动释放带来的遗漏。\n\n### 如何选择\n\n- 独占所有权优先使用 `std::unique_ptr`。\n- 多个对象确实需要共享生命周期时，再使用 `std::shared_ptr`。\n- 非拥有访问使用引用或受约束的指针。\n\n```cpp\nauto device = std::make_unique<Device>();\ndevice->connect();\n```\n\n> 先解释谁拥有资源，再考虑使用哪种智能指针。",
  ],
  [
    "把复杂任务拆成可以验证的最小闭环",
    "method",
    "学习与思考",
    ["学习方法", "反馈"],
    "从一个可以跑通的输入开始，追踪状态变化，再检查输出。每一轮只验证一个假设，让学习从“看过”变成“能够解释与复现”。",
  ],
  [
    "PCIe 与 DMA：控制路径和数据路径的分工",
    "fact",
    "设备通信",
    ["PCIe", "DMA"],
    "控制路径负责配置寄存器与任务参数；数据路径负责把批量数据在设备与主机内存之间搬运。两条路径协同，但不应混为一谈。",
  ],
  [
    "代码评审前，先写清楚为什么这样设计",
    "principle",
    "工程实践",
    ["代码质量", "设计"],
    "一份有用的设计说明需要包含约束、备选方案和取舍。让评审者理解问题背景，而不是从实现细节反向猜测意图。",
  ],
  [
    "阅读笔记不等于知识：保留可复用的结论",
    "method",
    "学习与思考",
    ["知识管理", "阅读"],
    "摘录保留信息，重述检验理解。将一段材料整理成可以回答真实问题的结论，并留下来源，才能在未来重新使用。",
  ],
  [
    "为异步任务建立可观察的状态转换",
    "snippet",
    "工程实践",
    ["异步", "状态机"],
    "```cpp\nenum class TaskState { Idle, Running, Completed, Failed };\n```\n\n明确每种状态允许的动作和失败后的恢复路径。不要只依赖一个布尔变量表达复杂任务的生命周期。",
  ],
];
let cards = Array.from({ length: 30 }, (_, i) => {
  const e = examples[i % examples.length];
  return {
    id: `demo-${i + 1}`,
    title: e[0] + (i >= 6 ? ` · 笔记 ${i + 1}` : ""),
    card_type: e[1],
    projects: [e[2]],
    tags: e[3],
    content: e[4],
    status: i % 5 === 1 ? "draft" : i % 7 === 6 ? "outdated" : "confirmed",
    source_article_id: "",
    source_review_id: "",
    source_date: "",
    source_excerpt: i === 0 ? "先解释谁拥有资源，再考虑使用哪种智能指针。" : "",
    related_ids: [],
    declared_related_ids: [],
    created_at: "2026-08-01T08:00:00Z",
    updated_at: new Date(Date.UTC(2026, 8, 22 - i)).toISOString(),
    usage_count: i % 6,
    content_version: 1,
  };
});
const originalCards = structuredClone(cards);
let deletedCards = [];
let writes = [],
  requests = [],
  failUpdate = false,
  failList = false;
let queue = cards.slice(0, 3).map((card, i) => ({
  ...card,
  id: `question-${i + 1}`,
  knowledge_card_id: card.id,
  item_type: "basic",
  item_status: "active",
  card_status: "confirmed",
  prompt: [
    "为什么 RAII 能让资源管理更可靠？",
    "怎样验证一个复杂任务的最小闭环？",
    "DMA 与控制路径有什么区别？",
  ][i],
  answer: card.content,
  hint: "先考虑资源与对象的生命周期。",
  review_state: "learning",
  review_count: 2,
  next_review_at: "2026-09-22",
  review_interval_days: 3,
  review_ease: 2.5,
}));
let reviewedToday = 4,
  failGrade = false,
  failConnection = false,
  aiConfigured = true,
  holdJob = false;
let settings = { new_cards_per_day: 10, session_limit: 20 };
let config = {
  configured: true,
  api_key_configured: true,
  api_key_source: "settings",
  base_url: "https://example.test/v1",
  model: "test-model",
  temperature: 0.4,
  max_tokens: 4000,
  timeout_secs: 60,
  retries: 1,
  min_interval_ms: 0,
};
let routing = {
  profiles: [{ id: "default", name: "通用模型", ...config }],
  routes: { knowledge_extract: "default" },
  fallback_profile: "default",
};
let reviews = [
  {
    id: "weekly-new",
    kind: "weekly",
    period_start: "2026-09-14",
    period_end: "2026-09-20",
    version: 2,
    status: "draft",
    title: "从问题定位到稳定交付：本周工程回顾",
    content:
      "## 本周进展\n\n完成设备通信链路梳理，补齐自动化回归和异常恢复流程。\n\n## 复盘与下一步\n\n先缩小问题范围，再验证一个假设。下周继续完善数据路径的性能测试。",
    source_article_ids: [],
    source_review_ids: [],
    model: "test-model",
    generated_at: "2026-09-21T10:30:00Z",
    updated_at: "2026-09-21T10:30:00Z",
  },
  {
    id: "weekly-old",
    kind: "weekly",
    period_start: "2026-09-14",
    period_end: "2026-09-20",
    version: 1,
    status: "confirmed",
    title: "本周工程回顾：第一版",
    content: "## 本周进展\n\n梳理设备与主机的数据交换过程。",
    source_article_ids: [],
    source_review_ids: [],
    model: "test-model",
    generated_at: "2026-09-20T10:30:00Z",
    updated_at: "2026-09-20T10:30:00Z",
  },
  {
    id: "monthly-aug",
    kind: "monthly",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    version: 1,
    status: "confirmed",
    title: "八月回顾：建立持续学习与实践的节奏",
    content:
      "## 主要收获\n\n通过真实项目理解系统软件，整理可复用的技术笔记。\n\n## 九月计划\n\n保持记录与复习，深入设备生命周期和故障定位。",
    source_article_ids: [],
    source_review_ids: ["weekly-old"],
    model: "test-model",
    generated_at: "2026-09-01T08:30:00Z",
    updated_at: "2026-09-01T08:30:00Z",
  },
];
function jobSnapshot() {
  return {
    job_id: "mock-job",
    status: holdJob ? "running" : "completed",
    source_name: "测试文档",
    total_chars: 100,
    total_chunks: 1,
    finished_chunks: holdJob ? 0 : 1,
    completed_chunks: holdJob ? 0 : 1,
    failed_chunks: 0,
    progress_percent: holdJob ? 20 : 100,
    active_chunk: holdJob ? 0 : null,
    max_cards: 100,
    model: "test-model",
    skipped_cards: 0,
    error: "",
    cards: holdJob
      ? []
      : [
          {
            card_type: "concept",
            title: "RAII 与资源生命周期",
            content: "将资源释放绑定到对象生命周期。",
            tags: ["C++"],
            projects: [],
            source_excerpt: "将资源释放绑定到对象生命周期。",
          },
        ],
    batches: [],
    chunks: [],
  };
}

const anchorDate = "2026-09-22";
let records = Array.from({ length: 45 }, (_, i) => {
  const example = examples[i % examples.length];
  const date = new Date(Date.UTC(2026, 8, 22 - i)).toISOString().slice(0, 10);
  return {
    id: `record-${i + 1}`,
    date,
    title: example[0],
    content: example[4],
    preview: example[4],
    mood: "",
    tags: example[3],
    spaces: [example[2]],
    word_count: 180 + i * 16,
    created_at: date + "T10:00:00Z",
    updated_at: date + "T10:00:00Z",
  };
});
let recordTrash = [];
let statsFail = false;
let summaryFail = false;
let legacyReviewQuery = false;
let analyzeDelay = 0;
const dateStates = new Map();

const frontendOrigin = new URL(process.env.KNOWLEDGE_FRONTEND_ORIGIN || "http://127.0.0.1:5173").origin;
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(frontendOrigin).hostname)) throw new Error("UI tests require a loopback origin");
const browser = await chromium.launch({
  executablePath: process.env.KNOWLEDGE_CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  colorScheme: "light",
});
await context.addInitScript(() => {
  localStorage.setItem("server_url", "/api");
  localStorage.setItem("theme-mode", "light");
});
await context.route("**/*", async (route) => {
  const request = route.request(),
    url = new URL(request.url());
  if (url.pathname.startsWith("/api/")) {
    const path = url.pathname.slice(4),
      method = request.method();
    requests.push({ path, method, q: url.search });
    const send = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (method !== "GET")
      writes.push({ path, method, body: request.postData() });
    if (path === "/articles/search") {
      const query = url.searchParams.get("q") || "";
      return send(
        records.filter((record) =>
          (record.title + record.content).includes(query),
        ),
      );
    }
    if (path === "/articles/today")
      return send(
        records.find(
          (record) => record.date === url.searchParams.get("date"),
        ) || null,
      );
    if (path === "/articles" || path === "/articles/trash") {
      if (method === "POST") {
        const value = {
          ...records[0],
          ...request.postDataJSON(),
          id: `record-new-${writes.length}`,
        };
        records.push(value);
        return send(value);
      }
      const list = path.endsWith("/trash") ? recordTrash : records;
      const currentPage = Number(url.searchParams.get("page") || 1);
      const size = Number(url.searchParams.get("page_size") || 20);
      return send({
        items: list.slice((currentPage - 1) * size, currentPage * size),
        total: list.length,
        page: currentPage,
        page_size: size,
        has_more: currentPage * size < list.length,
      });
    }
    if (/^\/articles\/[^/]+\/restore$/.test(path)) {
      const id = path.split("/")[2];
      records.push(...recordTrash.filter((record) => record.id === id));
      recordTrash = recordTrash.filter((record) => record.id !== id);
      return route.fulfill({ status: 204 });
    }
    if (/^\/articles\/[^/]+$/.test(path)) {
      const record = records.find((record) => record.id === path.split("/")[2]);
      if (!record) return send({ error: "Not found" }, 404);
      if (method === "PUT") Object.assign(record, request.postDataJSON());
      if (method === "DELETE") {
        recordTrash.push(record);
        records = records.filter((item) => item.id !== record.id);
        return route.fulfill({ status: 204 });
      }
      return send(record);
    }
    if (path === "/archive/months")
      return send([
        { year: 2026, month: 9, count: 22 },
        { year: 2026, month: 8, count: 23 },
      ]);
    if (path.startsWith("/archive/")) {
      const parts = path.split("/");
      return send(
        records.filter((record) =>
          record.date.startsWith(`${parts[2]}-${parts[3].padStart(2, "0")}`),
        ),
      );
    }
    if (path === "/stats/overview")
      return statsFail
        ? send({ error: "Simulated stats failure" }, 500)
        : send({
            days_written: 15,
            current_streak: 8,
            streak_exempted_days: 1,
            exempted_days: 2,
            missing_days: 5,
            total_words: 6400,
            avg_words: 427,
            mood_counts: {},
          });
    if (path === "/stats/month") {
      const year = Number(url.searchParams.get("year")),
        month = Number(url.searchParams.get("month"));
      return send(
        Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => {
          const date = `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
          const record = records.find(
            (record) => record.date === date && i % 4 !== 1,
          );
          return {
            date,
            has_article: !!record,
            word_count: record?.word_count || 0,
            title: record?.title || "",
            id: record?.id || null,
            mood: "",
            exemption: dateStates.get(date) || null,
          };
        }),
      );
    }
    if (path === "/stats/week")
      return send({
        from: "2026-09-21",
        to: "2026-09-27",
        days_written: 2,
        exempted_days: 0,
        missing_days: ["2026-09-20"],
        longest_article: records[0],
        total_words: 680,
        avg_words: 340,
        top_terms: [{ term: "RAII", count: 3 }],
      });
    if (path === "/reviews")
      return send(
        reviews.filter(
          (review) =>
            !url.searchParams.get("kind") ||
            review.kind === url.searchParams.get("kind"),
        ),
      );
    if (path === "/review/heatmap") return send([]);
    if (path === "/ai/summary") {
      if (summaryFail) return send({ error: "Simulated AI failure" }, 500);
      return send({
        summary:
          "## 关键结论\n\n明确资源所有权，补齐错误处理。\n\n## 下一步\n\n继续验证生命周期与异常场景。",
      });
    }
    if (path === "/knowledge-cards/analyze") {
      await new Promise((resolve) => setTimeout(resolve, analyzeDelay));
      return send({
        cards: examples.slice(0, 2).map((example) => ({
          title: example[0],
          card_type: example[1],
          content: example[4],
          tags: example[3],
          projects: [example[2]],
          source_excerpt: "",
        })),
        skipped: 0,
        model: "test-model",
      });
    }

    if (path === "/knowledge-cards" && method === "GET") return send(cards);
    if (path === "/review/due")
      return send({
        cards: url.searchParams.has("limit")
          ? queue.slice(0, Number(url.searchParams.get("limit")))
          : queue,
        stats: {
          due: queue.length,
          due_reviews: queue.length,
          new_cards: 0,
          reviewed_today: reviewedToday,
          total_confirmed: 21,
        },
      });
    if (path === "/review/stats")
      return send({
        total_reviews: 40,
        reviewed_today: reviewedToday,
        due: queue.length,
        total_confirmed: 21,
        learning: 15,
        mature: 6,
        new_cards: 0,
        streak_days: 5,
        daily: [],
        upcoming: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-09-${23 + i}`,
          count: [2, 0, 5, 3, 1, 0, 4][i],
        })),
      });
    if (path === "/review/settings") {
      if (method === "PUT") settings = request.postDataJSON();
      return send(settings);
    }
    if (/^\/review\/[^/]+\/preview$/.test(path))
      return send(
        ["again", "hard", "good", "easy"].map((grade, i) => ({
          grade,
          interval_days: [0, 1, 3, 7][i],
          next_review_at: "2026-09-29",
        })),
      );
    if (path.endsWith("/grade")) {
      if (failGrade) return send({ error: "模拟评分失败" }, 500);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const id = path.split("/")[2];
      const current = queue.find((q) => q.id === id);
      if (!current) return send({ error: "missing question" }, 404);
      queue = queue.filter((q) => q.id !== id);
      if (request.postDataJSON().grade === "again") queue.push(current);
      reviewedToday++;
      return send(current);
    }
    if (path === "/reviews/query") {
      if (legacyReviewQuery) return send({ error: "Legacy endpoint" }, 404);
      let result = reviews.filter(
        (r) =>
          (!url.searchParams.get("kind") ||
            r.kind === url.searchParams.get("kind")) &&
          (!url.searchParams.get("status") ||
            r.status === url.searchParams.get("status")) &&
          (!url.searchParams.get("q") ||
            (r.title + r.content).includes(url.searchParams.get("q"))),
      );
      return send({
        reviews: result,
        total: result.length,
        draft_count: result.filter((r) => r.status === "draft").length,
        confirmed_count: result.filter((r) => r.status === "confirmed").length,
        current_month_weekly_drafts: 1,
        latest_generated_at: result[0]?.generated_at || null,
        page: 1,
        page_size: 36,
        has_more: false,
      });
    }
    if (/^\/reviews\/[^/]+$/.test(path)) {
      const id = path.split("/")[2];
      const review = reviews.find((r) => r.id === id);
      if (!review) return send({ error: "not found" }, 404);
      if (method === "PUT") Object.assign(review, request.postDataJSON());
      if (method === "DELETE") {
        reviews = reviews.filter((r) => r.id !== id);
        return route.fulfill({ status: 204 });
      }
      return send(review);
    }
    if (path === "/ai/config") {
      if (method === "PUT") Object.assign(config, request.postDataJSON());
      return send({
        ...config,
        configured: aiConfigured,
        api_key_configured: aiConfigured,
      });
    }
    if (path === "/ai/routing") return send(routing);
    if (path === "/ai/prompt")
      return send({
        prompt: "测试系统提示词",
        system_prompt: "测试系统提示词",
      });
    if (path === "/knowledge-cards/analyze-jobs" && method === "POST")
      return send({
        job_id: "mock-job",
        status: "queued",
        total_chars: 100,
        total_chunks: 1,
        max_cards: 100,
      });
    if (path === "/knowledge-cards/analyze-jobs/mock-job")
      return send(jobSnapshot());
    if (path === "/knowledge-cards/import") {
      const data = request.postDataJSON();
      const imported = data.cards.map((card, i) => ({
        ...cards[0],
        ...card,
        id: `import-${writes.length}-${i}`,
        status: "draft",
      }));
      cards.push(...imported);
      return send({ cards: imported, imported: imported.length, skipped: 0 });
    }
    if (path === "/backups")
      return send([
        {
          name: "mock-snapshot.sqlite",
          size_bytes: 102400,
          created_at: new Date().toISOString(),
          kind: "manual",
          protected: false,
        },
      ]);
    if (path === "/health")
      return send({
        version: "1.0.0",
        build: "1780000000",
        features: { ai: true, reviews: true, knowledge: true, exports: true },
      });
    if (path === "/articles")
      return failConnection ? send({ error: "模拟连接失败" }, 401) : send([]);

    let filtered = cards.filter(
      (c) =>
        !url.searchParams.get("project") ||
        c.projects.includes(url.searchParams.get("project")),
    );
    if (path === "/knowledge-cards/summary")
      return send({
        total: filtered.length,
        draft: filtered.filter((c) => c.status === "draft").length,
        confirmed: filtered.filter((c) => c.status === "confirmed").length,
        outdated: filtered.filter((c) => c.status === "outdated").length,
        missing_source: filtered.length,
        missing_project: 0,
        missing_tags: 0,
        short_content: 0,
      });
    if (path === "/knowledge-cards/query") {
      if (failList) return send({ error: "Synthetic list failure" }, 500);
      for (const [param, key] of [
        ["status", "status"],
        ["card_type", "card_type"],
      ])
        if (url.searchParams.get(param))
          filtered = filtered.filter(
            (c) => c[key] === url.searchParams.get(param),
          );
      if (url.searchParams.get("tag"))
        filtered = filtered.filter((c) =>
          c.tags.includes(url.searchParams.get("tag")),
        );
      if (url.searchParams.get("q"))
        filtered = filtered.filter((c) =>
          (c.title + c.content).includes(url.searchParams.get("q")),
        );
      const page = Number(url.searchParams.get("page") || 1),
        size = Number(url.searchParams.get("page_size") || 24);
      return send({
        cards: filtered.slice((page - 1) * size, page * size),
        total: filtered.length,
        page,
        page_size: size,
        has_more: page * size < filtered.length,
      });
    }
    if (path === "/spaces" || path === "/knowledge-cards/projects")
      return send(
        [...new Set(cards.flatMap((c) => c.projects))].map((name) => ({
          name,
          kind: "topic",
          status: "active",
          count: cards.filter((c) => c.projects.includes(name)).length,
          article_count: 0,
          total_count: cards.filter((c) => c.projects.includes(name)).length,
          description: "",
        })),
      );
    if (path === "/knowledge-cards/tags")
      return send(
        [...new Set(cards.flatMap((c) => c.tags))].map((tag) => ({
          tag,
          count: cards.filter((c) => c.tags.includes(tag)).length,
        })),
      );
    if (
      path.includes("/review-items") ||
      path.startsWith("/review/history/") ||
      path.endsWith("/articles")
    )
      return send([]);
    if (path.startsWith("/review/"))
      return send({
        cards: [],
        stats: { due: 0, total: 0, new: 0, learning: 0, mature: 0 },
      });
    if (path === "/knowledge-cards/batch") {
      const body = request.postDataJSON();
      if (body.action === "delete") {
        deletedCards.push(...cards.filter((c) => body.ids.includes(c.id)));
        cards = cards.filter((c) => !body.ids.includes(c.id));
      } else if (body.action === "restore") {
        cards.push(...deletedCards.filter((c) => body.ids.includes(c.id)));
        deletedCards = deletedCards.filter((c) => !body.ids.includes(c.id));
      } else
        cards = cards.map((c) =>
          body.ids.includes(c.id)
            ? {
                ...c,
                ...(body.action === "confirm" ? { status: "confirmed" } : {}),
                ...(body.action === "add_tags"
                  ? { tags: [...new Set([...c.tags, ...body.values])] }
                  : {}),
              }
            : c,
        );
      return send({ updated: body.ids.length });
    }
    if (path === "/knowledge-cards" && method === "POST") {
      const card = {
        ...cards[0],
        ...request.postDataJSON(),
        id: `demo-new-${writes.length}`,
        status: "draft",
      };
      cards.push(card);
      return send(card);
    }
    const match = /^\/knowledge-cards\/([^/]+)(\/touch)?$/.exec(path);
    if (match) {
      const card = cards.find((c) => c.id === match[1]);
      if (!card) return send({ error: "Not found" }, 404);
      if (match[2]) return send(card);
      if (method === "PUT" || method === "PATCH") {
        if (failUpdate) return send({ error: "Synthetic save failure" }, 500);
        Object.assign(card, request.postDataJSON());
      }
      if (method === "DELETE") {
        cards = cards.filter((c) => c.id !== card.id);
        return route.fulfill({ status: 204 });
      }
      return send(card);
    }
    return send({});
  }
  if (url.origin === frontendOrigin)
    return route.continue();
  return route.abort();
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
async function check(name, run) {
  await run();
  checks.push(name);
  console.log("PASS", name);
}
async function go(path) {
  await page.goto(`${frontendOrigin}${path}`);
  await page.waitForTimeout(300);
}
async function shot(name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png` });
}
const mutations = (path) => writes.filter((item) => item.path === path).length;
try {
  for (const [path, selector, name] of [
    ["/stats?date=2026-09", ".ft-calendar", "stats"],
    ["/history", ".history-card", "history"],
    ["/search", ".ft-search-input", "search"],
    ["/today?date=2026-09-22", ".cm-editor", "today"],
  ]) {
    await check(
      `${name} renders without automatic business writes`,
      async () => {
        const count = writes.length;
        await go(path);
        await page.locator(selector).first().waitFor();
        assert.equal(writes.length, count);
        await shot(name);
      },
    );
  }
  await check(
    "sidebar removes duplicate navigation and persists collapse",
    async () => {
      assert.equal(
        await page
          .locator(".shell-sidebar")
          .getByRole("link", { name: "复习", exact: true })
          .count(),
        1,
      );
      await page
        .getByRole("button", { name: "收起侧边栏", exact: true })
        .click();
      assert.equal(
        await page.locator(".shell-sidebar").getAttribute("data-collapsed"),
        "true",
      );
      await page.reload();
      await page.locator(".cm-editor").waitFor();
      assert.equal(
        await page.locator(".shell-sidebar").getAttribute("data-collapsed"),
        "true",
      );
      await page
        .getByRole("button", { name: "展开侧边栏", exact: true })
        .click();
    },
  );
  await check("sidebar shortcut does not steal editor formatting", async () => {
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("Control+b");
    assert.equal(
      await page.locator(".shell-sidebar").getAttribute("data-collapsed"),
      "false",
    );
  });
  await check(
    "AI summary is opt-in and does not overwrite the record",
    async () => {
      const original = records[0].content;
      const count = mutations("/ai/summary");
      await page.getByRole("button", { name: "AI 总结", exact: true }).click();
      await page.locator(".ft-ai-dialog").waitFor();
      assert.equal(mutations("/ai/summary"), count);
      await page.getByRole("button", { name: "生成总结", exact: true }).click();
      await page.locator(".ft-ai-summary").waitFor();
      assert.equal(records[0].content, original);
      await shot("today-ai-summary");
      await page.getByRole("button", { name: "关闭 AI 结果" }).click();
      await page.getByRole("button", { name: "AI 总结", exact: true }).click();
      assert.equal(mutations("/ai/summary"), count + 1);
      await page.getByRole("button", { name: "关闭 AI 结果" }).click();
    },
  );
  await check(
    "knowledge preview is independent and does not persist candidates",
    async () => {
      await go("/today?date=2026-09-22");
      await page.locator(".cm-editor").waitFor();
      const before = mutations("/knowledge-cards/import");
      const summaryCalls = mutations("/ai/summary");
      await page.getByRole("button", { name: "提取知识", exact: true }).click();
      await page.getByRole("button", { name: "提取预览", exact: true }).click();
      await page
        .getByRole("textbox", { name: "候选知识标题", exact: true })
        .waitFor();
      assert.equal(mutations("/knowledge-cards/import"), before);
      assert.equal(mutations("/ai/summary"), summaryCalls);
      assert.equal(
        await page.getByRole("checkbox", { name: /选择候选/ }).count(),
        2,
      );
      await shot("today-ai-candidates");
    },
  );
  await check(
    "candidate validation and selection constrain explicit save",
    async () => {
      await page
        .getByRole("checkbox", { name: "选择候选 2", exact: true })
        .uncheck();
      const title = page.getByRole("textbox", {
        name: "候选知识标题",
        exact: true,
      });
      const original = await title.inputValue();
      await title.fill("");
      assert.equal(
        await page
          .getByRole("button", { name: "保存 1 个草稿", exact: true })
          .isDisabled(),
        true,
      );
      await title.fill(original);
      const before = mutations("/knowledge-cards/import");
      await page
        .getByRole("button", { name: "保存 1 个草稿", exact: true })
        .dblclick();
      await page.locator(".ft-ai-complete").waitFor();
      assert.equal(mutations("/knowledge-cards/import"), before + 1);
      const payload = JSON.parse(
        writes.filter((item) => item.path === "/knowledge-cards/import").at(-1)
          .body,
      );
      assert.equal(payload.cards.length, 1);
      assert.equal(payload.cards[0].source_article_id, "record-1");
      assert.equal(payload.cards[0].source_date, "2026-09-22");
      await page.getByRole("button", { name: "关闭 AI 结果" }).click();
    },
  );
  await check(
    "original changes invalidate an outstanding candidate snapshot",
    async () => {
      analyzeDelay = 500;
      await page.getByRole("button", { name: "提取知识", exact: true }).click();
      await page.getByRole("button", { name: "重新提取", exact: true }).click();
      await page.getByRole("button", { name: "关闭 AI 结果" }).click();
      await page
        .locator(".cm-content")
        .first()
        .fill("更新后的原文，需要重新提取知识。");
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: "提取知识", exact: true }).click();
      await page
        .getByText("原文已变化，下方是旧版本结果。请重新生成后使用。")
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "保存 2 个草稿", exact: true })
          .isDisabled(),
        true,
      );
      analyzeDelay = 0;
      await page.getByRole("button", { name: "关闭 AI 结果" }).click();
    },
  );
  await go("/search");
  await check("search waits for IME composition", async () => {
    const input = page.getByRole("searchbox", { name: "搜索记录、知识或复盘" });
    const before = requests.filter(
      (item) => item.path === "/articles/search",
    ).length;
    await input.dispatchEvent("compositionstart");
    await input.fill("RAII");
    await page.waitForTimeout(450);
    assert.equal(
      requests.filter((item) => item.path === "/articles/search").length,
      before,
    );
    await input.dispatchEvent("compositionend");
    await page.waitForTimeout(500);
    assert(
      requests.some(
        (item) => item.path === "/articles/search" && item.q.includes("RAII"),
      ),
    );
  });
  await check(
    "review scope performs real review retrieval and survives reload",
    async () => {
      await page.getByRole("tab", { name: "复盘", exact: true }).click();
      await page.getByRole("searchbox").fill("工程");
      await page.waitForTimeout(500);
      await page.locator(".ft-result").first().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("scope"), "reviews");
      await page.reload();
      await page.locator(".ft-result").first().waitFor();
      assert.equal(
        await page
          .getByRole("tab", { name: "复盘", exact: true })
          .getAttribute("data-state"),
        "active",
      );
      await shot("search-review-results");
      await page.locator(".ft-result-main").first().click();
      await page.getByRole("dialog").waitFor();
      assert.equal(
        await page.getByRole("button", { name: "编辑", exact: true }).count(),
        0,
      );
      await page.getByRole("button", { name: "关闭复盘详情" }).click();
    },
  );
  await check(
    "search knowledge scope and clear use consistent URL state",
    async () => {
      await page.getByRole("tab", { name: "知识", exact: true }).click();
      await page.getByRole("searchbox").fill("所有权");
      await page.waitForTimeout(500);
      await page.locator(".ft-result").first().waitFor();
      assert(new URL(page.url()).searchParams.get("q") === "所有权");
      await page.getByRole("button", { name: "清除搜索", exact: true }).click();
      await page.locator(".ft-search-empty").waitFor();
      assert.equal(await page.locator(".ft-result").count(), 0);
      assert.equal(new URL(page.url()).searchParams.get("q"), null);
    },
  );
  await check(
    "record library has no empty inspector and pages without duplicates",
    async () => {
      await go("/history");
      await page.locator(".history-card").first().waitFor();
      assert.equal(await page.locator(".history-detail-pane").count(), 0);
      assert.equal(await page.locator(".history-card").count(), 20);
      await page.getByRole("button", { name: /加载更多/ }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".history-card").length === 40,
      );
      const names = await page
        .locator(".history-card-main")
        .evaluateAll((items) =>
          items.map((item) => item.getAttribute("aria-label")),
        );
      assert.equal(new Set(names).size, 40);
    },
  );
  await check(
    "record inspector adapts when resizing an open document",
    async () => {
      await page.locator(".history-card-main").first().click();
      await page
        .locator(
          ".history-detail-pane .markdown-content, .history-detail-pane .prose",
        )
        .first()
        .waitFor();
      await shot("history-reader");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("dialog").waitFor();
      assert.equal(await page.getByRole("dialog").isVisible(), true);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.setViewportSize({ width: 1600, height: 1000 });
    },
  );
  await check(
    "record month changes and recycle actions remain explicit",
    async () => {
      await page.getByRole("tab", { name: "按月份", exact: true }).click();
      await page.getByRole("combobox", { name: "选择月份" }).click();
      await page.getByRole("option", { name: /八月/ }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".history-list-title")
          ?.textContent?.includes("八月"),
      );
      assert(
        new URL(page.url()).searchParams.get("historyMonth") === "2026-08",
      );
      const before = writes.length;
      await page
        .locator(".history-card-actions")
        .first()
        .getByRole("button", { name: /更多操作/ })
        .click();
      await page
        .getByRole("menuitem", { name: "移入回收站", exact: true })
        .click();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(writes.length, before);
    },
  );
  await check("stats moves redundant sections behind task tabs", async () => {
    await go("/stats?date=2026-09");
    await page.locator(".ft-calendar-grid").waitFor();
    assert.equal(await page.locator(".ft-metric").count(), 4);
    assert.equal(await page.locator("[data-calendar-cell]").count(), 42);
    assert.equal(
      await page
        .getByRole("button", { name: "AI 周复盘", exact: true })
        .count(),
      0,
    );
    await page.getByRole("tab", { name: "生成复盘", exact: true }).click();
    await page
      .getByRole("button", { name: "AI 周复盘", exact: true })
      .waitFor();
    const before = writes.length;
    await shot("stats-generation");
    await page.getByRole("tab", { name: "知识整理", exact: true }).click();
    assert.equal(writes.length, before);
    await page.getByText("未关联来源（来源可选）").waitFor();
  });
  await check(
    "statistics month route survives refresh; unavailable data stays distinct",
    async () => {
      await page.getByRole("tab", { name: "记录概览" }).click();
      await page.getByRole("button", { name: "上个月", exact: true }).click();
      await page.waitForURL(/date=2026-08/);
      await page.reload();
      await page.locator(".ft-calendar-grid").waitFor();
      assert.equal(
        await page.locator('[data-calendar-cell="day"]').count(),
        31,
      );
      statsFail = true;
      await page.getByRole("button", { name: "上个月", exact: true }).click();
      await page.getByRole("button", { name: /重试/ }).first().waitFor();
      assert.equal(await page.locator(".ft-metric").count(), 0);
      statsFail = false;
      await page.getByRole("button", { name: /重试/ }).first().click();
      await page.locator(".ft-metric").first().waitFor();
    },
  );
  await check("desktop record library uses its available width", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await go("/history");
    await page.locator(".history-card").first().waitFor();
    const ratio = await page.evaluate(
      () =>
        document.querySelector(".history-list-pane").getBoundingClientRect()
          .width /
        document.querySelector(".history-body").getBoundingClientRect().width,
    );
    assert(ratio > 0.95);
  });
  await check("month navigation icons are not compressed", async () => {
    await go("/stats?date=2026-09");
    const icons = await page
      .locator(".ft-month-nav .shell-icon svg")
      .evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().width),
      );
    assert(icons.every((width) => width >= 16));
  });
  await check(
    "summary failure can retry without changing original content",
    async () => {
      await go("/today?date=2026-09-22");
      const original = records.find((item) => item.id === "record-1").content;
      summaryFail = true;
      await page.getByRole("button", { name: "AI 总结", exact: true }).click();
      await page.getByRole("button", { name: "生成总结", exact: true }).click();
      await page.locator('.ft-ai-body [role="alert"]').waitFor();
      assert.equal(
        records.find((item) => item.id === "record-1").content,
        original,
      );
      summaryFail = false;
      await page.getByRole("button", { name: "生成总结", exact: true }).click();
      await page.locator(".ft-ai-summary").waitFor();
      await page.getByRole("button", { name: "关闭 AI 结果" }).click();
    },
  );
  await check(
    "old server review listing remains searchable after a missing endpoint",
    async () => {
      legacyReviewQuery = true;
      await go("/search?q=工程&scope=reviews");
      await page.locator(".ft-result").first().waitFor();
      assert.equal(
        await page.locator('.ft-search-empty[role="alert"]').count(),
        0,
      );
      assert(requests.some((item) => item.path === "/reviews"));
      legacyReviewQuery = false;
    },
  );
  await check(
    "mobile calendar dates do not overlap decorative document icons",
    async () => {
      await page.setViewportSize({ width: 360, height: 844 });
      await go("/stats?date=2026-09");
      await page.locator(".ft-calendar-grid").waitFor();
      const shown = await page
        .locator(".ft-calendar-grid .ui-calendar-doc")
        .evaluateAll(
          (items) =>
            items.filter((item) => getComputedStyle(item).display !== "none")
              .length,
        );
      assert.equal(shown, 0);
    },
  );
  await check(
    "long mobile titles wrap instead of clipping the record heading",
    async () => {
      await go("/today?date=2026-09-21");
      await page.getByRole("textbox", { name: "今日记录标题" }).waitFor();
      const title = page.getByRole("textbox", { name: "今日记录标题" });
      assert.equal(await title.evaluate((el) => el.tagName), "TEXTAREA");
      assert(
        await title.evaluate((el) => el.clientHeight >= el.scrollHeight - 2),
      );
    },
  );
  for (const path of [
    "/stats",
    "/history",
    "/search",
    "/today?date=2026-09-22",
  ])
    await check(`landscape ${path} remains navigable`, async () => {
      await page.setViewportSize({ width: 740, height: 480 });
      await go(path);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const more = await page
        .getByRole("button", { name: "打开更多入口" })
        .boundingBox();
      assert(more && more.y + more.height <= 480);
    });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await check(
    "reduced motion disables remaining presentation transitions",
    async () => {
      await go("/history");
      assert(
        await page
          .locator(".history-card")
          .first()
          .evaluate((el) => getComputedStyle(el).transitionDuration === "0s"),
      );
    },
  );

  for (const width of [1600, 1280, 1024, 768, 390, 360])
    for (const [path, name] of [
      ["/stats?date=2026-09", "stats"],
      ["/history", "history"],
      ["/search?q=RAII", "search"],
      ["/today?date=2026-09-22", "today"],
    ]) {
      await check(`${name} fits ${width}px`, async () => {
        await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
        await go(path);
        const sizes = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert(sizes.scroll <= sizes.width, JSON.stringify(sizes));
        if (width === 390) await shot(name + "-mobile");
      });
    }
  await check(
    "mobile AI keeps both candidates and save actions reachable",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await go("/today?date=2026-09-22");
      await page.getByRole("button", { name: "提取知识", exact: true }).click();
      await page.getByRole("button", { name: "提取预览" }).click();
      await page.getByRole("textbox", { name: "候选知识标题" }).waitFor();
      const box = await page
        .getByRole("button", { name: "保存 2 个草稿" })
        .boundingBox();
      assert(box && box.y + box.height <= 844);
      await shot("today-ai-mobile");
      await page.getByRole("button", { name: "关闭 AI 结果" }).click();
    },
  );
  await check(
    "mobile more navigation retains focus and all secondary pages",
    async () => {
      await page.getByRole("button", { name: "打开更多入口" }).click();
      await page.getByRole("dialog").waitFor();
      assert.equal(
        await page
          .getByRole("navigation", { name: "更多页面" })
          .getByRole("link")
          .count(),
        4,
      );
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      assert(
        await page
          .getByRole("button", { name: "打开更多入口" })
          .evaluate((el) => el === document.activeElement),
      );
    },
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page
    .getByRole("button", { name: "切换到深色模式", exact: true })
    .click();
  for (const [path, name] of [
    ["/stats?date=2026-09", "stats"],
    ["/history", "history"],
    ["/search?q=RAII", "search"],
    ["/today?date=2026-09-22", "today"],
    ["/knowledge", "knowledge"],
    ["/review", "review"],
    ["/reviews", "reviews"],
    ["/settings?tab=appearance", "settings"],
  ]) {
    await check(`${name} dark layout and shared canvas`, async () => {
      await go(path);
      assert.equal(await page.locator(".shell-sidebar").isVisible(), true);
      await shot(name + "-dark");
      const size = await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      );
      assert(size);
    });
  }
  assert.deepEqual(errors, []);
  console.log("All checks passed:", checks.length);
} catch (error) {
  console.error(error);
  await page.screenshot({ path: `${out}/failure.png` });
  await fs.writeFile(
    `${out}/failure-dom.txt`,
    await page.locator("body").innerText(),
  );
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    `${out}/report.json`,
    JSON.stringify({ checks, errors, writes, requests }, null, 2),
  );
  await browser.close();
}
