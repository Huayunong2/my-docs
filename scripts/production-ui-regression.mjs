// Production assets only. Every API response is an isolated in-memory fixture.
// Isolated browser regression: API calls are intercepted in memory; no real records are changed.
// Run against the loopback Vite development server. See docs/knowledge-ui-redesign.md.
const { chromium } = await import(
  process.env.KNOWLEDGE_PLAYWRIGHT_MODULE || "playwright-core"
);
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const out =
  process.env.KNOWLEDGE_UI_OUTPUT || "/tmp/daily-summary-stats-repair";
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

const frontendOrigin = new URL(
  process.env.KNOWLEDGE_FRONTEND_ORIGIN || "http://127.0.0.1:8080",
).origin;
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(
    new URL(frontendOrigin).hostname,
  )
)
  throw new Error("UI tests require a loopback origin");
const browser = await chromium.launch({
  executablePath: process.env.KNOWLEDGE_CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  colorScheme: "light",
  serviceWorkers: "block",
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
        daily: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-09-${i + 10}`,
          count: i + 1,
        })),
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
  if (url.origin === frontendOrigin) return route.continue();
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
const scriptRequests = [];
page.on("request", (request) => {
  if (request.resourceType() === "script")
    scriptRequests.push(new URL(request.url()).pathname);
});
async function healthy(selector) {
  await page.locator(selector).first().waitFor({ timeout: 15000 });
  assert.equal(await page.locator(".ix-route-error").count(), 0);
  assert.equal(
    await page.getByText("Something went wrong!", { exact: true }).count(),
    0,
  );
}
try {
  await check("production stats loads real optimized assets", async () => {
    await go("/stats?date=2026-09");
    await healthy("[data-calendar-cell=day]");
    assert(
      scriptRequests.some((path) => /\/assets\/StatsPage-.*\.js$/.test(path)),
    );
    assert(!scriptRequests.some((path) => /@vite\/client|\/src\//.test(path)));
  });
  await check("production chart including XAxis renders", async () => {
    await page.getByRole("tab", { name: "记忆复习", exact: true }).click();
    await healthy(".recharts-wrapper");
    assert((await page.locator(".recharts-bar-rectangle").count()) > 0);
    await page.getByRole("tab", { name: "记录概览" }).click();
  });
  await check("direct reload keeps statistics usable", async () => {
    await page.reload();
    await healthy("[data-calendar-cell=day]");
  });
  await check(
    "month picker supports keyboard and preserves the URL",
    async () => {
      await page
        .getByRole("button", { name: "选择统计月份", exact: true })
        .click();
      await page
        .getByRole("button", { name: "2026 年 9 月", exact: true })
        .focus();
      await page.keyboard.press("ArrowLeft");
      assert.equal(
        await page
          .getByRole("button", { name: "2026 年 8 月", exact: true })
          .evaluate((el) => document.activeElement === el),
        true,
      );
      await page.keyboard.press("Enter");
      await page.waitForURL(/date=2026-08/);
      await healthy("[data-calendar-cell=day]");
      assert.equal(
        await page
          .getByRole("button", { name: "选择统计月份", exact: true })
          .evaluate((el) => document.activeElement === el),
        true,
      );
    },
  );
  await check("month picker year navigation is reversible", async () => {
    await page
      .getByRole("button", { name: "选择统计月份", exact: true })
      .click();
    await page.getByRole("button", { name: "上一年", exact: true }).click();
    await page
      .getByRole("button", { name: "2025 年 1 月", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".ix-month-picker").count(), 0);
    await page.getByRole("button", { name: "本月", exact: true }).click();
  });
  await check("sidebar contains one link per destination", async () => {
    const paths = await page
      .locator(".sb-refined a.shell-nav-link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    assert.equal(paths.length, 8);
    assert.equal(new Set(paths).size, paths.length);
    assert.equal(
      await page.locator(".sb-refined a[aria-current=page]").count(),
      1,
    );
    await shot("sidebar-light");
  });
  await check("sidebar arrow keys move focus without navigating", async () => {
    const url = page.url();
    await page
      .locator(".sb-refined")
      .getByRole("link", { name: "今日", exact: true })
      .focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page
        .locator(".sb-refined")
        .getByRole("link", { name: "记录", exact: true })
        .evaluate((el) => document.activeElement === el),
      true,
    );
    await page.keyboard.press("End");
    assert.equal(
      await page
        .locator(".sb-refined")
        .getByRole("link", { name: "设置", exact: true })
        .evaluate((el) => document.activeElement === el),
      true,
    );
    assert.equal(page.url(), url);
  });
  await check("sidebar shows contextual shortcut hints on hover", async () => {
    await page
      .locator(".sb-refined")
      .getByRole("link", { name: "记录", exact: true })
      .hover();
    await page.waitForTimeout(180);
    assert.equal(
      await page
        .locator('.sb-refined a[href="/history"] .sb-nav-shortcut')
        .evaluate((el) => Number(getComputedStyle(el).opacity) > 0.5),
      true,
    );
  });
  await check("collapsed sidebar supplies readable hover labels", async () => {
    await page.getByRole("button", { name: "收起侧边栏", exact: true }).click();
    await page.waitForTimeout(210);
    await page
      .locator(".sb-refined")
      .getByRole("link", { name: "统计", exact: true })
      .hover();
    await page.getByRole("tooltip").waitFor();
    assert.match(await page.getByRole("tooltip").innerText(), /统计/);
    await shot("sidebar-collapsed");
    await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
    assert.equal(await page.getByRole("tooltip").count(), 0);
  });
  await check("shortcut dialog restores focus", async () => {
    await page.getByRole("button", { name: "查看快捷键", exact: true }).click();
    await page.getByRole("dialog", { name: "快捷键", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "查看快捷键", exact: true })
        .evaluate((el) => document.activeElement === el),
      true,
    );
  });
  await check("question-mark shortcut works outside editors", async () => {
    await page
      .locator(".sb-refined")
      .getByRole("link", { name: "统计", exact: true })
      .focus();
    await page.keyboard.press("?");
    await page.getByRole("dialog", { name: "快捷键", exact: true }).waitFor();
    await page.keyboard.press("Escape");
  });
  await check(
    "appearance menu records an explicit dark selection",
    async () => {
      await page
        .getByRole("button", { name: "选择显示模式", exact: true })
        .click();
      await page
        .getByRole("menuitemradio", { name: "深色", exact: true })
        .click();
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("dark"),
      );
      await page.waitForTimeout(250);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("themeMode")),
        "dark",
      );
      await shot("sidebar-dark");
    },
  );
  await check(
    "appearance menu offers following the operating system",
    async () => {
      await page
        .getByRole("button", { name: "选择显示模式", exact: true })
        .click();
      await page
        .getByRole("menuitemradio", { name: "跟随系统", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => localStorage.getItem("themeMode")),
        "system",
      );
    },
  );
  await check(
    "return-to-top targets the actual record scroll region",
    async () => {
      await go("/history");
      await healthy(".history-card");
      await page.locator(".history-list-scroll").evaluate((el) => {
        el.scrollTop = 850;
      });
      await page
        .getByRole("button", { name: "返回顶部", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "返回顶部", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".history-list-scroll").scrollTop < 2,
      );
    },
  );
  await check(
    "editing never triggers question-mark or collapse shortcuts",
    async () => {
      await go("/search");
      const input = page
        .locator(
          ".ft-search-input input, .ft-search-box input, input[type=search]",
        )
        .first();
      await input.fill("");
      await input.press("?");
      await input.press("Control+b");
      assert.equal(
        await page.getByRole("dialog", { name: "快捷键", exact: true }).count(),
        0,
      );
      assert.equal(
        await page.locator(".sb-refined").getAttribute("data-collapsed"),
        "false",
      );
    },
  );
  for (const width of [1440, 1024, 768, 390, 360]) {
    await check(`statistics and navigation fit ${width}px`, async () => {
      await page.setViewportSize({ width, height: width < 640 ? 844 : 960 });
      await go("/stats?date=2026-09");
      await healthy("[data-calendar-cell=day]");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      if (width === 390) await shot("stats-mobile");
    });
  }
  await check(
    "mobile more menu retains all secondary destinations",
    async () => {
      await page.getByRole("button", { name: "打开更多入口" }).click();
      await page.getByRole("dialog", { name: "更多", exact: true }).waitFor();
      for (const name of ["记录", "统计", "搜索", "设置"])
        assert.equal(
          await page
            .getByRole("dialog")
            .getByRole("link", { name, exact: true })
            .count(),
          1,
        );
      await page.keyboard.press("Escape");
      assert.equal(
        await page
          .getByRole("button", { name: "打开更多入口" })
          .evaluate((el) => document.activeElement === el),
        true,
      );
    },
  );
  await check(
    "reduced motion disables optional transition feedback",
    async () => {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await go("/stats");
      await healthy(".ft-stats");
      assert.equal(
        await page
          .locator(".sb-refined")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      assert.equal(
        await page
          .locator(".sb-refined a.shell-nav-link")
          .first()
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
    },
  );
  for (const [path, selector] of [
    ["/knowledge", ".knowledge-hub"],
    ["/review", ".rs-page"],
    ["/reviews", ".rp-page"],
    ["/settings?tab=appearance", ".st-page"],
    ["/today", ".page-surface-today"],
    ["/search", ".ft-search"],
    ["/history", ".ft-history"],
  ]) {
    await check(`optimized route ${path} remains usable`, async () => {
      await go(path);
      await healthy(selector);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    });
  }
  await check(
    "failed route module keeps the sidebar and a recovery action",
    async () => {
      const probe = await context.newPage();
      try {
        await probe.route("**/assets/StatsPage-*.js", (route) =>
          route.fulfill({
            contentType: "text/javascript",
            body: 'throw new Error("Isolated production chunk failure");',
          }),
        );
        await probe.goto(`${frontendOrigin}/stats`);
        await probe.locator(".ix-route-error").waitFor({ timeout: 15000 });
        assert.equal(await probe.locator(".sb-refined").isVisible(), true);
        assert.equal(
          await probe
            .getByRole("button", { name: "重新加载", exact: true })
            .count(),
          1,
        );
        await probe
          .locator(".sb-refined")
          .getByRole("link", { name: "搜索", exact: true })
          .click();
        await probe.locator(".ft-search").waitFor();
      } finally {
        await probe.close();
      }
    },
  );
  assert.deepEqual(errors, []);
  assert.equal(
    writes.length,
    0,
    "Production UI checks must not issue business mutations",
  );
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
    `${out}/production-report.json`,
    JSON.stringify(
      {
        origin: frontendOrigin,
        checks,
        errors,
        businessWrites: writes.length,
        optimizedScripts: scriptRequests.filter((path) =>
          path.startsWith("/assets/"),
        ),
      },
      null,
      2,
    ),
  );
  await browser.close();
}
