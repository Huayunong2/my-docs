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
const wallpaperSource=await fs.readFile(new URL("../src/lib/wallpapers.ts",import.meta.url),"utf8");
const surfacePairs=[...wallpaperSource.matchAll(/id: "([^"]+)", module: "([^"]+)"/g)];
const wallpaperPreferences=Object.fromEntries(["today","records","search","knowledge","review","stats","reviews","settings"].map(id=>[id,{wallpaperIds:[],overlay:80,cycleDaily:false,surfaces:Object.fromEntries(surfacePairs.filter(p=>p[2]===id).map(p=>[p[1],{wallpaperIds:[],overlay:80,cycleDaily:false}]))}]));
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
examples[0][4] += "\n\n| 场景 | 建议 |\n| --- | --- |\n| 移动阅读 | 内容优先 |\n\n![阅读示意图一](/synthetic-image-a.svg)\n\n![阅读示意图二](/synthetic-image-b.svg)";
cards[0].content = examples[0][4];
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
  if (/^\/synthetic-image-[ab]\.svg$/.test(url.pathname)) return route.fulfill({contentType:"image/svg+xml",body:`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" rx="40" fill="#d7e8df"/><circle cx="450" cy="280" r="130" fill="#6a8f7b"/><text x="450" y="500" text-anchor="middle" font-family="sans-serif" font-size="40" fill="#203b2d">Reading workspace</text></svg>`});
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
    if(path === "/wallpapers") return send({revision:0,preferences:wallpaperPreferences,assets:[],presets:[],storageUsedBytes:0,storageQuotaBytes:268435456,hasUserData:false});
    if(path === "/ai/tasks") return send([]);
    if(path === "/articles/tag-suggestions") return send(["工作","Rust"]);
    if(path === "/knowledge-cards/trash") return send([]);
    if(path === "/knowledge-reuse") return send({events:[],total:0,page:1,has_more:false,from:"",to:""});
    if(path.endsWith("/sources")) return send([]);
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

    if (path === "/knowledge-cards/labels") {
      const ids = url.searchParams.getAll("id");
      const labels = cards.map(({ id, title }) => ({ id, title }));
      return send(url.searchParams.get("all") === "true"
        ? labels
        : ids.flatMap((id) => labels.filter((label) => label.id === id)));
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
    if (path === "/review/stats/snapshot")
      return send({
        stats: {
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
        },
        heatmap: [],
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
page.on("console",message=>{if(message.type()==="error")console.error("Browser:",message.text());});
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
async function imageReadingRegression() {
    await go("/history"); await healthy(".history-card");
    await page.locator(".history-card-main").first().click();
    const image=page.getByRole("button",{name:"查看图片：阅读示意图一",exact:true});
    await image.scrollIntoViewIfNeeded();
    const before=await page.locator(".article-detail-body:visible").evaluate(e=>e.scrollTop);
    await image.click();await page.getByRole("dialog",{name:"阅读示意图一",exact:true}).waitFor();
    await page.waitForFunction(()=>{const image=document.querySelector(".reading-image-stage img");return image?.style.transform&&Math.abs(new DOMMatrix(getComputedStyle(image).transform).a-1)<.01;});
    const fits=()=>page.locator(".reading-image-stage").evaluate(stage=>{const image=stage.querySelector("img"),outer=stage.getBoundingClientRect(),inner=image.getBoundingClientRect();return inner.x>=outer.x-1&&inner.y>=outer.y-1&&inner.right<=outer.right+1&&inner.bottom<=outer.bottom+1;});
    assert(await fits(),"initial image fits completely inside its reading viewport");
    await page.getByRole("button",{name:"放大图片",exact:true}).click();
    await page.waitForFunction(()=>{const img=document.querySelector(".reading-image-stage img");return img&&new DOMMatrix(getComputedStyle(img).transform).a>1;});
    await page.getByRole("button",{name:"复位图片",exact:true}).click();
    await page.waitForFunction(()=>{const img=document.querySelector(".reading-image-stage img");return img&&Math.abs(new DOMMatrix(getComputedStyle(img).transform).a-1)<.01;});
    assert(await fits(),"reset returns the entire image to view");
    await page.getByRole("button",{name:"下一张图片",exact:true}).click();
    await page.getByRole("dialog",{name:"阅读示意图二",exact:true}).waitFor();
    await page.waitForFunction(()=>{const image=document.querySelector(".reading-image-stage img");return image?.style.transform&&Math.abs(new DOMMatrix(getComputedStyle(image).transform).a-1)<.01;});
    assert(await fits(),"gallery switching starts with a complete image");
    await shot("image-viewer-mobile");
    await page.keyboard.press("Escape");
    await page.locator(".reading-image-viewer").waitFor({state:"hidden"});
    // Radix restores focus in its asynchronous unmount callback, after the
    // viewer stops painting. Wait for that lifecycle before asserting focus.
    await page.waitForFunction(element=>document.activeElement===element,await image.elementHandle());
    assert(await image.evaluate(e=>e===document.activeElement));
    assert(Math.abs(await page.locator(".article-detail-body:visible").evaluate(e=>e.scrollTop)-before)<=1);
    await page.getByRole("button",{name:"关闭详情",exact:true}).click();
}
try {
  if(process.env.KNOWLEDGE_UI_GUIDELINES_ONLY === "1") {
    for(const width of [320,390,768,1024,1280,1440]) {
      await page.setViewportSize({width,height:width===320?568:1000});
      for(const [name,path,selector] of [["history","/history",".history-card-main"],["knowledge","/knowledge",".kl-card"],["reviews","/reviews",".rp-period"],["stats","/stats?date=2026-09",".ft-metric"]]) {
        await go(path);await healthy(selector);
        await check(`${name} readable content and shared controls fit ${width}px`,async()=>{
          const main=await page.locator("#main-content").boundingBox(),content=await page.locator(selector).first().boundingBox();
          assert(content.y<main.y+main.height-24,"first content appears within the reading viewport");
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
          assert.equal(await page.locator("#main-content").evaluate(e=>getComputedStyle(e).paddingBottom),"0px");
          const clipped=await page.locator("#main-content .ui-select-trigger").evaluateAll(es=>es.filter(e=>e.getClientRects().length).some(e=>{const r=e.getBoundingClientRect(),m=document.getElementById("main-content").getBoundingClientRect();return r.right>m.right+1||r.left<m.left-1;}));assert(!clipped);
          if(name==="stats")assert(await page.locator(".ft-monthly-story").evaluate(panel=>{const p=panel.getBoundingClientRect();return [...panel.querySelectorAll(".ft-monthly-ring,.ft-monthly-legend")].every(e=>{const r=e.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1;});}),"overview graphics and labels fit their panel without masked clipping");
        });
        if(width===320||width===1440)await shot(`guidelines-${name}-${width}`);
      }
    }
    await page.setViewportSize({width:320,height:568});
    await check("mobile browsing has one scroll and returns from the reader without jumping",async()=>{
      await go("/history");const main=page.locator("#main-content");
      assert.equal(await page.locator(".history-list-scroll").evaluate(e=>getComputedStyle(e).overflowY),"visible");
      const row=page.locator(".history-card-main").nth(3);await row.scrollIntoViewIfNeeded();const before=await main.evaluate(e=>e.scrollTop);assert(before>100);
      await row.click();await page.locator(".article-detail-body:visible").waitFor();await page.getByRole("button",{name:"关闭详情",exact:true}).click();await page.locator(".article-detail-body:visible").waitFor({state:"hidden"});
      await page.waitForFunction(element=>document.activeElement===element,await row.elementHandle());assert(Math.abs(await main.evaluate(e=>e.scrollTop)-before)<=1);
    });
    await check("library selects support keyboard, collision limits and focus return inside the view sheet",async()=>{
      await go("/knowledge");const status=page.getByRole("combobox",{name:"知识状态",exact:true});await status.click();
      await page.waitForFunction(()=>document.activeElement?.getAttribute("role")==="option");
      await page.keyboard.press("End");await page.waitForFunction(()=>document.activeElement?.textContent?.includes("已过时"));assert((await page.evaluate(()=>document.activeElement?.textContent)).includes("已过时"));await page.keyboard.press("Escape");await page.getByRole("listbox").waitFor({state:"hidden"});await page.waitForFunction(element=>document.activeElement===element,await status.elementHandle());
      await page.getByRole("button",{name:"知识排序与显示",exact:true}).click();const sort=page.getByRole("combobox",{name:"知识条目排序",exact:true});await sort.click();
      const box=await page.getByRole("listbox").boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=321&&box.y+box.height<=569);
      await shot("guidelines-sort-popup-320");await page.keyboard.press("Escape");await page.getByRole("listbox").waitFor({state:"hidden"});await page.getByRole("button",{name:"关闭操作面板",exact:true}).click();
    });
    await check("the library empty state has a reachable primary action and no disabled pagination",async()=>{
      cards=[];await go("/knowledge");await page.locator(".kl-empty").waitFor();const action=await page.locator(".kl-empty button").first().boundingBox(),main=await page.locator("#main-content").boundingBox();
      assert(action.y+action.height<=main.y+main.height+1,"the short-screen starting action is fully visible");assert.equal(await page.locator(".kl-pagination").count(),0);await shot("guidelines-knowledge-empty-320");
    });
  } else if(process.env.KNOWLEDGE_IMAGE_ONLY === "1") {
    await page.setViewportSize({width:390,height:844});
    await check("image fit, zoom, reset, gallery and focus",imageReadingRegression);
  } else {
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
    assert.equal(paths.length, 9);
    assert(paths.includes("/profile"), "personal profile is reachable from desktop navigation");
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
  await check("record focus expands in the workspace like knowledge reading and restores the split", async () => {
    await page.setViewportSize({width:1440,height:960});
    await go("/history"); await healthy(".history-card");
    await page.locator(".history-card-main").first().click();
    const panel=page.locator(".history-detail-pane");await panel.getByRole("button",{name:"专注阅读",exact:true}).waitFor();
    await panel.evaluate(element=>{element.scrollTop=120;});const previous=await panel.evaluate(element=>element.scrollTop);
    const before=await panel.boundingBox();
    await panel.getByRole("button",{name:"专注阅读",exact:true}).click();
    await page.locator('.ft-history[data-focused="true"]').waitFor();
    assert.equal(await page.getByRole("dialog").count(),0,"workspace focus does not open a modal");
    assert(await page.locator(".history-list-pane").isHidden());
    const expanded=await panel.boundingBox();assert(expanded.width>before.width+100,"reader uses the space released by the list");
    assert(await page.locator(".wb-header").isVisible(),"workspace navigation remains visible like the knowledge page");
    await shot("history-focus-workspace");await page.keyboard.press("Escape");
    await page.locator('.ft-history[data-focused="false"]').waitFor();
    await panel.getByRole("button",{name:"专注阅读",exact:true}).waitFor();
    await page.waitForFunction(expected=>document.querySelector(".history-detail-pane").scrollTop===expected,previous);
    assert(await panel.getByRole("button",{name:"专注阅读",exact:true}).evaluate(element=>element===document.activeElement));
    await panel.getByRole("button",{name:"关闭详情",exact:true}).click();
  });
  await check("runtime overview links activate settings, preserve drafts, and support history and reload", async () => {
    await go("/settings?tab=connect");await page.getByRole("heading",{name:"运行概览",exact:true}).waitFor();
    const address=page.getByRole("textbox",{name:"服务器地址",exact:true});const original=await address.inputValue();
    await address.fill("http://127.0.0.1:8080/api");
    await page.getByRole("link",{name:"检查 AI 配置",exact:true}).click();
    await page.locator("#settings-panel-ai").waitFor({state:"visible"});assert(new URL(page.url()).searchParams.get("tab")==="ai");
    await page.goBack();await page.locator("#settings-panel-connect").waitFor({state:"visible"});
    assert.equal(await address.inputValue(),"http://127.0.0.1:8080/api","changing category retains the unsaved connection draft");
    await address.fill(original);
    await page.getByRole("link",{name:"查看备份与数据",exact:true}).click();await page.locator("#settings-panel-data").waitFor({state:"visible"});
    await page.goBack();await page.locator("#settings-panel-connect").waitFor({state:"visible"});
    await page.getByRole("link",{name:"检查 AI 配置",exact:true}).click();await page.locator("#settings-panel-ai").waitFor({state:"visible"});
    await page.reload();await page.locator("#settings-panel-ai").waitFor({state:"visible"});
  });
  await check("weekly reuse copy stays inside a padded panel at desktop and mobile widths", async () => {
    for(const width of [320,390,768,1024,1440]) {
      await page.setViewportSize({width,height:1000});await go("/stats");
      if(width<768){await page.getByRole("combobox",{name:"统计分类",exact:true}).click();await page.getByRole("option",{name:"知识整理",exact:true}).click();}
      else await page.getByRole("tab",{name:"知识整理",exact:true}).click();
      const panel=page.locator(".ko-weekly");await panel.waitFor();await page.getByText("尚无复用记录。使用知识解决问题后，可以在阅读区一键记录。",{exact:true}).waitFor();
      const geometry=await panel.evaluate(element=>{const box=element.getBoundingClientRect(),text=element.querySelector("p").getBoundingClientRect(),heading=element.querySelector("h2").getBoundingClientRect();return {left:text.left-box.left,right:box.right-text.right,bottom:box.bottom-text.bottom,alignment:Math.abs(text.left-heading.left)};});
      assert(geometry.left>=20&&geometry.right>=20&&geometry.bottom>=20&&geometry.alignment<2,JSON.stringify({width,geometry}));
      if(width===1440||width===390)await shot("weekly-reuse-padding-"+width);
    }
    await page.setViewportSize({width:1440,height:960});
  });
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
    ["/history", ".ft-history"], ["/archive", ".ft-history"], ["/knowledge/trash", ".page-surface-knowledge-trash"],
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
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: width === 360 ? "dark" : "light" });
    for (const [path, selector] of [
      ["/knowledge", ".knowledge-hub"], ["/review", ".rs-page"],
      ["/reviews", ".rp-page"], ["/settings?tab=appearance", ".st-page"],
      ["/today", ".page-surface-today"], ["/search", ".ft-search"],
      ["/history", ".ft-history"], ["/archive", ".ft-history"], ["/knowledge/trash", ".page-surface-knowledge-trash"],
    ]) {
      await check(`mobile route ${path} fits ${width}px and clears navigation`, async () => {
        await go(path); await healthy(selector);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const main = await page.locator("#main-content").boundingBox();
        const nav = await page.locator(".shell-mobile-nav").boundingBox();
        assert(main && nav && main.y + main.height <= nav.y + 1, "page viewport never extends behind navigation");
        assert(await page.locator("#ai-task-launcher").isHidden(), "idle AI button never obscures mobile text");
        await shot(`mobile-${width}-${path.split("?")[0].slice(1)}`);
      });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await check("mobile knowledge bulk selection is explicit and reversible", async () => {
    await go("/knowledge"); await healthy(".kl-card");
    assert(await page.locator(".kl-card-check").first().isHidden());
    await page.locator(".kl-card-menu").first().click();
    await page.getByRole("menuitem", {name:"批量选择", exact:true}).click();
    assert(await page.locator(".kl-card-check").first().isVisible());
    assert(await page.locator(".kl-batchbar").isVisible());
    const all=page.getByRole("checkbox",{name:"选择当前页全部知识条目",exact:true});
    assert(await all.evaluate(e=>e.indeterminate),"one selected card displays the mixed checkbox state");
    await all.focus();await page.keyboard.press("Space");assert(await all.isChecked());assert(!(await all.evaluate(e=>e.indeterminate)));
    await page.keyboard.press("Space");assert(!(await all.isChecked()));
    await page.getByRole("button", {name:"结束选择", exact:true}).click();
    assert(await page.locator(".kl-card-check").first().isHidden());
    assert.equal(await page.locator(".kl-batchbar").count(), 0);
  });
  await check("mobile Today starts with the document and exposes editing on demand", async () => {
    await go(`/today?date=${anchorDate}`);
    await page.locator(".today-reading-title").waitFor();
    assert(await page.locator(".today-actions").count() === 0);
    assert.equal(await page.locator(".cm-editor").count(),0,"reading does not initialize a hidden editor");
    assert(await page.getByLabel("今日记录标题", { exact: true }).count() === 0);
    const originalTitle = records[0].title;
    assert.equal(await page.locator(".today-reading-title").innerText(), originalTitle);
    const body = await page.locator(".today-preview-surface .markdown-content").boundingBox();
    if (!body || body.y >= 320) await fs.writeFile(`${out}/today-geometry.json`, JSON.stringify(await page.locator(".today-workspace").evaluate(e => [e,...e.querySelectorAll("div,h2")].map(n => ({c:n.className,box:n.getBoundingClientRect().toJSON(),margin:getComputedStyle(n).margin,padding:getComputedStyle(n).padding}))),null,2));
    assert(body && body.y < 320, "record text leads the first screen");
    await shot("today-reading-first");
    await page.getByRole("button", { name: "补记", exact: true }).click();
    assert.equal(await page.getByLabel("今日记录标题", { exact: true }).inputValue(), originalTitle);
    await page.getByRole("button", { name: "返回阅读", exact: true }).click();
    assert.equal(await page.locator(".today-reading-title").innerText(), originalTitle);
    await page.getByRole("button", { name: "今日记录操作", exact: true }).click();
    for (const name of ["立即保存", "AI 总结", "提取知识", "心情与标签"]) assert.equal(await page.getByRole("button", { name, exact: true }).count(), 1);
    await page.keyboard.press("Escape");
  });
  await check("mobile commands close before opening the next AI dialog", async () => {
    await go(`/today?date=${anchorDate}`);await page.locator(".today-reading-title").waitFor();
    const trigger=page.getByRole("button",{name:"今日记录操作",exact:true});
    await trigger.click();await page.getByRole("button",{name:"AI 总结",exact:true}).click();
    await page.getByRole("dialog",{name:"AI 总结",exact:true}).waitFor();
    assert.equal(await page.getByRole("dialog",{name:"今日记录操作",exact:true}).count(),0);
    assert(await page.getByRole("dialog",{name:"AI 总结",exact:true}).evaluate(e=>e.contains(document.activeElement)));
    await page.getByRole("button",{name:"关闭 AI 结果",exact:true}).click();
    await page.getByRole("dialog",{name:"AI 总结",exact:true}).waitFor({state:"hidden"});
    assert(await trigger.evaluate(e=>e===document.activeElement));
    await trigger.click();await page.getByRole("dialog",{name:"今日记录操作",exact:true}).waitFor();await shot("today-actions-mobile");await page.keyboard.press("Escape");
  });
  await check("mobile empty Today opens writing only after an explicit action", async () => {
    await go("/today?date=2026-10-01");
    await page.getByRole("heading", { name: "这一天还没有记录", exact: true }).waitFor();
    assert(await page.locator(".cm-editor").isHidden());
    await page.getByRole("button", { name: "开始记录", exact: true }).click();
    assert(await page.locator(".cm-editor").isVisible());
    await page.getByRole("button", { name: "返回阅读", exact: true }).click();
  });
  await check("mobile history reads first and exposes management on demand", async () => {
    await go("/history"); await healthy(".history-card");
    assert(await page.locator(".history-card-edit").first().isHidden());
    const card = page.locator(".history-card-main").nth(2); await card.scrollIntoViewIfNeeded();
    const before = await page.locator("#main-content").evaluate(e => e.scrollTop);
    await card.click(); await page.locator(".article-detail-body:visible .markdown-content").waitFor();assert.equal(await page.locator(".article-detail-body:visible").count(),1,"only one record reader is visible");
    assert(await page.getByRole("button", { name: "编辑记录", exact: true }).isHidden());
    await shot("history-reading-first");
    await page.getByRole("button", { name: "记录阅读操作", exact: true }).click();
    assert(await page.getByRole("button", { name: "编辑记录", exact: true }).isVisible());
    await page.getByRole("button", { name: "关闭操作面板", exact: true }).click();
    await page.getByRole("dialog",{name:"记录阅读操作",exact:true}).waitFor({state:"hidden"});
    assert(await page.getByRole("button",{name:"记录阅读操作",exact:true}).evaluate(e=>e===document.activeElement));
    await page.getByRole("button", { name: "关闭详情", exact: true }).click();
    await page.locator(".article-detail-body:visible").waitFor({state:"hidden"});
    assert(Math.abs(await page.locator("#main-content").evaluate(e => e.scrollTop) - before) <= 2);
  });
  await check("explicit mobile record editing opens the editor directly", async () => {
    await go("/history"); await healthy(".history-card");
    await page.getByRole("button",{name:`更多操作：${anchorDate}`,exact:true}).click();
    await page.getByRole("menuitem",{name:"编辑记录",exact:true}).click();
    await page.getByLabel("今日记录标题",{exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("tab"),"edit");
    assert(await page.locator(".cm-editor").isVisible());
    await page.getByRole("button",{name:"返回阅读",exact:true}).click();
    await page.locator(".today-reading-title").waitFor();
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has("tab"));
    assert.equal(await page.locator(".cm-editor").count(),0);
  });
  await check("mobile review focuses one question and keeps the answer readable", async () => {
    await go("/review"); await healthy(".rs-page");
    await page.getByRole("button",{name:"开始复习",exact:true}).click();
    await page.locator(".rs-prompt .markdown-content").waitFor();
    assert(await page.locator(".rs-sidebar").isHidden());
    await page.getByRole("button",{name:/^显示答案/}).click();
    await page.locator(".rs-answer .markdown-content").waitFor();
    const grade=page.locator(".rs-grade-grid button").first(); await grade.scrollIntoViewIfNeeded();
    const bounds=await grade.boundingBox(),nav=await page.locator(".shell-mobile-nav").boundingBox();
    assert(bounds&&bounds.y>=0&&bounds.y+bounds.height<=nav.y+1,"grading never enters the navigation area");
    await shot("review-reading-first");
  });
  await check("mobile period review opens its document before management controls", async () => {
    await go("/reviews"); await page.locator(".rp-period-copy h3 button").first().click();
    await page.locator(".rp-viewer .review-viewer-body .markdown-content").waitFor();
    const tools=page.getByRole("button",{name:"周期回顾阅读操作",exact:true});
    assert.equal(await tools.getAttribute("aria-expanded"),"false");
    await shot("period-reading-first");
    await tools.click();
    assert(await page.getByRole("button",{name:"编辑",exact:true}).isVisible());
    await page.getByRole("button",{name:"关闭操作面板",exact:true}).click();
    await page.getByRole("dialog",{name:"周期回顾阅读操作",exact:true}).waitFor({state:"hidden"});
    await page.getByRole("button",{name:"关闭复盘详情",exact:true}).click();
  });
  await check("mobile settings uses a complete, visible library category selector", async () => {
    await go("/settings?tab=appearance"); await healthy(".st-main");
    const selector=page.getByRole("combobox",{name:"设置分类",exact:true});
    const tab = await selector.boundingBox();
    assert(tab && tab.x >= 0 && tab.x + tab.width <= 391, "selected category remains visible");
    assert((await selector.innerText()).includes("外观"));
    await selector.click();assert.equal(await page.getByRole("option").count(),5,"all five categories remain discoverable");await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({state:"hidden"});
    await page.waitForFunction(element=>element===document.activeElement,await selector.elementHandle());
    assert(await selector.evaluate(e=>e===document.activeElement),"selector restores focus after dismissing its menu");
    await shot("settings-reading-first");
  });
  await check("image viewer supports nested dialogs, zoom, gallery and focus return", imageReadingRegression);
  await page.setViewportSize({width:1440,height:960});
  await check("Today panels preserve editing through focus and narrow layouts", async () => {
    await go(`/today?date=${anchorDate}`);await page.locator("#today-split").waitFor();
    await page.waitForFunction(expected=>Array.from(document.querySelectorAll(".cm-content .cm-line")).map(line=>line.textContent).join("\n")===expected,records.find(record=>record.date===anchorDate).content);
    const content=await page.locator(".cm-content").innerText();
    await page.getByRole("separator",{name:"调整编辑与预览区宽度",exact:true}).focus();await page.keyboard.press("ArrowLeft");
    await shot("today-wide-split");
    await page.setViewportSize({width:1024,height:960});await page.locator("#today-split").waitFor({state:"hidden"});
    await page.getByRole("button",{name:"编辑记录",exact:true}).click();assert.equal(await page.locator(".cm-content").innerText(),content);
    await page.getByRole("button",{name:"阅读预览",exact:true}).click();assert(await page.locator(".today-preview-pane").isVisible());assert(await page.locator(".today-editor-pane").isHidden());
    await page.setViewportSize({width:1440,height:960});
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await check("quick navigation loads on demand and restores keyboard focus", async () => {
    await go("/search");await healthy(".ft-search");
    const trigger=page.getByRole("button",{name:"打开快速跳转",exact:true});
    await trigger.click();await page.getByRole("dialog",{name:"快速导航",exact:true}).waitFor();
    await page.getByPlaceholder("跳转到页面…",{exact:true}).fill("知识");
    assert(await page.getByRole("option",{name:/知识/}).isVisible());
    await page.keyboard.press("Escape");await page.getByRole("dialog",{name:"快速导航",exact:true}).waitFor({state:"hidden"});
    assert(await trigger.evaluate(e=>e===document.activeElement));
  });
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
  }
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
