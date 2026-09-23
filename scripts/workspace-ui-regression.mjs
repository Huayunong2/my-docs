// Isolated browser regression: API calls are intercepted in memory; no real records are changed.
// Run against the loopback Vite development server. See docs/knowledge-ui-redesign.md.
const { chromium } = await import(
  process.env.KNOWLEDGE_PLAYWRIGHT_MODULE || "playwright-core"
);
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const out =
  process.env.KNOWLEDGE_UI_OUTPUT || "/tmp/daily-summary-workspace-audit";
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
cards[0].related_ids = [cards[1].id];
cards[0].declared_related_ids = [cards[1].id];
const originalCards = structuredClone(cards);
let deletedCards = [];
let writes = [],
  requests = [],
  failUpdate = false,
  failList = false,
  failLabelLookup = false;
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
    if (path === "/knowledge-cards/labels") {
      if (failLabelLookup) {
        failLabelLookup = false;
        return send({ error: "Synthetic title-index failure" }, 503);
      }
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
          daily: [],
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
  if (url.hostname === "127.0.0.1" && url.port === "5173")
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
  await page.goto(`http://127.0.0.1:5173${path}`);
  await page.waitForTimeout(250);
}
async function shot(name) {
  await page.waitForTimeout(350); // Capture after the shared theme transition settles.
  await page.screenshot({ path: `${out}/${name}.png` });
}
try {
  for (const [route, selector, name] of [
    ["/knowledge", ".kl-card", "knowledge"],
    ["/review", ".rs-ready", "review-ready"],
    ["/reviews", ".rp-period", "reviews"],
    ["/settings?tab=connect", "#server-url", "settings"],
  ]) {
    await go(route);
    await page.locator(selector).first().waitFor();
    await shot(name);
    await check(`${route} renders on the shared canvas`, async () => {
      const colors = await page
        .locator(route === "/knowledge" ? ".knowledge-hub" : ".wb-page")
        .evaluate((el) => ({
          actual: getComputedStyle(el).backgroundColor,
          canvas: getComputedStyle(document.querySelector(".app-shell"))
            .backgroundColor,
        }));
      assert.equal(colors.actual, colors.canvas);
    });
  }
  await go("/knowledge");
  await page.getByRole("button", { name: "导入知识", exact: true }).click();
  await page.locator(".ki-method-grid").waitFor();
  await shot("import-choose");
  await check(
    "import starts with an explicit choice and no writes",
    async () => {
      assert.equal(await page.locator(".ki-method").count(), 2);
      assert.equal(writes.length, 0);
    },
  );
  await page.locator(".ki-method").first().click();
  await page.getByRole("tab", { name: "单条文本", exact: true }).click();
  await page
    .getByRole("textbox", { name: "单条文本知识条目标题" })
    .fill("RAII 与资源生命周期");
  await page
    .getByRole("textbox", { name: "单条文本 导入内容" })
    .fill("将资源释放绑定到对象生命周期，减少手动管理造成的遗漏。");
  await shot("import-manual");
  await check("manual preview is not a data write", async () => {
    await page.getByRole("button", { name: "预览并核对" }).click();
    assert.equal(writes.length, 0);
    assert.equal(await page.locator(".ki-source-editor").isVisible(), false);
    await shot("import-preview");
  });
  await check("cancel protects unimported content", async () => {
    await page.getByRole("button", { name: "关闭导入知识条目" }).click();
    await page.getByRole("button", { name: "继续编辑", exact: true }).waitFor();
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "导入 1 个有效草稿" }).isVisible(),
      true,
    );
  });
  await check("import commits only after explicit confirmation", async () => {
    await page.getByRole("button", { name: "导入 1 个有效草稿" }).click();
    await page.locator(".ki-dialog").waitFor({ state: "detached" });
    assert(writes.some((w) => w.path === "/knowledge-cards/import"));
    assert(
      cards.some(
        (c) => c.title === "RAII 与资源生命周期" && c.status === "draft",
      ),
    );
  });
  const fullKnowledgeReadsBeforeReview = requests.filter(
    (request) => request.path === "/knowledge-cards" && request.method === "GET",
  ).length;
  await go("/review");
  await page.locator(".rs-ready").waitFor();
  await check("review does not download the full knowledge library on entry", async () => {
    assert.equal(
      requests.filter((request) => request.path === "/knowledge-cards" && request.method === "GET").length,
      fullKnowledgeReadsBeforeReview,
    );
  });
  await check("review does not reveal or grade before starting", async () => {
    await page.locator("h1").click();
    await page.keyboard.press("Space");
    await page.keyboard.press("1");
    assert.equal(await page.locator(".rs-answer").count(), 0);
    assert.equal(writes.filter((w) => w.path.endsWith("/grade")).length, 0);
  });
  await page.getByRole("button", { name: "开始复习", exact: true }).click();
  await page.locator(".rs-question").waitFor();
  await shot("review-question");
  await check(
    "hint and answer are deliberate; rapid rating is locked",
    async () => {
      await page.getByRole("button", { name: "给我一点提示" }).click();
      assert.equal(await page.locator(".rs-hint p").count(), 1);
      await page.locator(".rs-question").focus();
      await page.keyboard.press("Space");
      await page.locator(".rs-answer").waitFor();
      await page.locator(".rs-evidence summary").click();
      await page.getByRole("button", { name: cards[1].title }).waitFor();
      assert(requests.some((request) => request.path === "/knowledge-cards/labels" && request.q.includes("id=demo-2")));
      await page.waitForTimeout(100);
      await shot("review-answer");
      const before = writes.filter((w) => w.path.endsWith("/grade")).length;
      await page.keyboard.press("3");
      await page.keyboard.press("3");
      await page.waitForTimeout(200);
      assert.equal(
        writes.filter((w) => w.path.endsWith("/grade")).length,
        before + 1,
      );
      assert.equal(queue.length, 2);
    },
  );
  await page.getByRole("button", { name: "显示答案", exact: true }).click();
  await page.locator(".rs-evidence summary").click();
  failLabelLookup = true;
  await page.getByRole("button", { name: "编辑知识条目", exact: true }).click();
  await page.getByText(/无法加载知识条目编辑信息/).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "知识标题", exact: true }).count(), 0);
  await page.getByRole("button", { name: "编辑知识条目", exact: true }).click();
  await page.getByRole("textbox", { name: "知识标题", exact: true }).waitFor();
  assert(requests.some((request) => request.path === "/knowledge-cards/labels" && request.q === "?all=true"));
  await check(
    "review shortcuts ignore text entry inside the editor",
    async () => {
      const before = writes.filter((w) => w.path.endsWith("/grade")).length;
      await page
        .getByRole("textbox", { name: "知识标题", exact: true })
        .fill("1 2 3 4 输入不评分");
      await page.keyboard.press("1");
      await page.keyboard.press("Space");
      assert.equal(
        writes.filter((w) => w.path.endsWith("/grade")).length,
        before,
      );
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    },
  );
  await check("failed rating keeps the answer and queue", async () => {
    failGrade = true;
    await page.locator(".rs-grade-grid [data-grade=good]").click();
    await page.waitForTimeout(180);
    assert.equal(await page.locator(".rs-answer").count(), 1);
    assert.equal(queue.length, 2);
    failGrade = false;
    await page.locator(".rs-grade-grid [data-grade=again]").click();
    await page.waitForTimeout(200);
    assert.equal(queue.length, 2);
  });
  await go("/reviews");
  await page.locator(".rp-period").first().waitFor();
  await check(
    "period archive retains confirmed baseline and historical versions",
    async () => {
      assert.equal(await page.locator(".rp-baseline").count(), 1);
      await page.getByRole("button", { name: /^2 个版本/ }).click();
      await page.locator('[id^="review-versions-"]').waitFor();
      await page.getByRole("button", { name: "版本对比", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
    },
  );
  await page.locator(".rp-read-action").first().click();
  await page.locator(".rp-viewer").waitFor();
  await shot("reviews-reader");
  await check("review reading and unsaved edit protection", async () => {
    assert.equal(await page.locator("#review-editor-title").count(), 0);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.locator("#review-editor-title").fill("尚未保存的复盘标题");
    await page.getByRole("button", { name: "取消编辑", exact: true }).click();
    await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    assert.equal(await page.locator("#review-editor-title").count(), 0);
    await page.getByRole("button", { name: "关闭复盘详情" }).click();
  });
  await check(
    "review filters preserve server query and reset affordance",
    async () => {
      await page.getByRole("tab", { name: "月复盘", exact: true }).click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator(".rp-period").count(), 1);
      assert(new URL(page.url()).searchParams.get("reviewKind") === "monthly");
      await page.getByRole("button", { name: "清除筛选", exact: true }).click();
      await page.waitForTimeout(300);
      assert.equal(await page.locator(".rp-period").count(), 2);
    },
  );
  await go("/settings?tab=connect");
  await page.locator("#server-url").waitFor();
  await check(
    "settings search locates category without losing form state",
    async () => {
      await page.locator("#server-url").fill("http://127.0.0.1:5173/api");
      await page.getByRole("searchbox", { name: "搜索设置分类" }).fill("模型");
      await page.locator(".st-search-results button").click();
      await page.locator("#ai-model").waitFor();
      await page.getByRole("tab", { name: /连接服务/ }).click();
      assert.equal(
        await page.locator("#server-url").inputValue(),
        "http://127.0.0.1:5173/api",
      );
    },
  );
  await check(
    "failed connection test does not persist draft values",
    async () => {
      failConnection = true;
      await page
        .getByRole("button", { name: "测试并保存", exact: true })
        .click();
      await page.waitForTimeout(160);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("server_url")),
        "/api",
      );
      failConnection = false;
      await page.locator("#server-url").fill("/api");
    },
  );
  await check(
    "appearance uses visual options and persists preference",
    async () => {
      await page.getByRole("tab", { name: "外观", exact: true }).click();
      await page.getByRole("button", { name: "深色", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "深色", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      await shot("settings-appearance-dark");
    },
  );
  await check(
    "data management navigation does not trigger destructive operations",
    async () => {
      const before = writes.length;
      await page.getByRole("tab", { name: "备份与迁移", exact: true }).click();
      await page.getByRole("tab", { name: "导出与迁移", exact: true }).click();
      await page.getByRole("tab", { name: "备份与恢复", exact: true }).click();
      assert.equal(writes.length, before);
      await shot("settings-data-dark");
    },
  );
  for (const [route, selector, name] of [
    ["/knowledge", ".kl-card", "knowledge-dark"],
    ["/review", ".rs-ready", "review-dark"],
    ["/reviews", ".rp-period", "reviews-dark"],
  ]) {
    await go(route);
    await page.locator(selector).first().waitFor();
    await shot(name);
    await check(`dark ${route} shares canvas`, async () => {
      const colors = await page
        .locator(route === "/knowledge" ? ".knowledge-hub" : ".wb-page")
        .evaluate((el) => ({
          actual: getComputedStyle(el).backgroundColor,
          canvas: getComputedStyle(document.querySelector(".app-shell"))
            .backgroundColor,
        }));
      assert.equal(colors.actual, colors.canvas);
    });
  }
  await go("/knowledge");
  await page.getByRole("button", { name: "导入知识", exact: true }).click();
  await page.locator(".ki-method-grid").waitFor();
  await shot("import-dark");
  await page.locator(".ki-method").last().click();
  await page
    .locator(".ki-source-editor .cm-content")
    .fill("将资源释放绑定到对象生命周期。");
  holdJob = true;
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await page.getByRole("button", { name: "放到后台" }).waitFor();
  await check("AI import can resume a background job", async () => {
    await page.getByRole("button", { name: "放到后台" }).click();
    await page.locator(".ki-dialog").waitFor({ state: "detached" });
    holdJob = false;
    await page.getByRole("button", { name: "导入知识", exact: true }).click();
    await page.getByRole("textbox", { name: "候选知识条目标题" }).waitFor();
    await shot("import-candidates");
    assert.equal(
      await page
        .getByRole("textbox", { name: "候选知识条目标题" })
        .inputValue(),
      "RAII 与资源生命周期",
    );
  });
  await check("AI candidate validity blocks incomplete import", async () => {
    await page.getByRole("textbox", { name: "候选知识条目标题" }).fill("");
    assert.equal(
      await page
        .getByRole("button", { name: "导入 1 个有效草稿" })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("textbox", { name: "候选知识条目标题" })
      .fill("已核对的知识标题");
    await page.getByRole("button", { name: "导入 1 个有效草稿" }).click();
    await page.locator(".ki-dialog").waitFor({ state: "detached" });
  });
  await check(
    "long review answers keep rating controls visible on mobile",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await go("/review");
      await page.getByRole("button", { name: "开始复习", exact: true }).click();
      await page.getByRole("button", { name: "显示答案", exact: true }).click();
      const rect = await page.locator(".rs-grade-grid").boundingBox();
      assert(rect.y + rect.height < 790, JSON.stringify(rect));
      await shot("review-answer-mobile");
    },
  );
  await check(
    "the selected mobile settings category remains in view",
    async () => {
      await go("/settings?tab=appearance");
      await page.getByRole("tab", { name: "外观", exact: true }).waitFor();
      const rect = await page
        .getByRole("tab", { name: "外观", exact: true })
        .boundingBox();
      assert(rect.x >= 0 && rect.x + rect.width <= 390);
      await page.getByRole("tab", { name: "外观", exact: true }).focus();
      await page.keyboard.press("Home");
      assert.equal(
        await page
          .getByRole("tab", { name: "连接服务", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
    },
  );
  await check(
    "backup restore still requires explicit confirmation",
    async () => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await go("/settings?tab=data");
      await page.getByRole("button", { name: "恢复", exact: true }).click();
      const before = writes.length;
      await page
        .getByRole("button", { name: "恢复此快照", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(writes.length, before);
    },
  );
  await check(
    "manual JSON preview explains partial validation without writing",
    async () => {
      await go("/knowledge");
      await page.getByRole("button", { name: "导入知识", exact: true }).click();
      await page.locator(".ki-method").first().click();
      await page.locator(".ki-source-editor .cm-content").fill(
        JSON.stringify({
          cards: [
            { title: "有效条目", content: "这条知识具有标题和正文。" },
            { title: "缺少正文" },
          ],
        }),
      );
      const before = writes.length;
      await page.getByRole("button", { name: "预览并核对" }).click();
      assert.equal(writes.length, before);
      assert.equal(
        await page
          .getByRole("button", { name: "导入 1 个有效草稿" })
          .isEnabled(),
        true,
      );
      await page.getByRole("button", { name: "关闭导入知识条目" }).click();
      await page.getByRole("button", { name: "放弃并关闭" }).click();
    },
  );
  await check(
    "AI configuration roundtrip preserves the unsubmitted source",
    async () => {
      aiConfigured = false;
      await page.getByRole("button", { name: "导入知识", exact: true }).click();
      await page.locator(".ki-method").last().click();
      await page
        .locator(".ki-source-editor .cm-content")
        .fill("前往设置之前的原文，需要保留。");
      assert.equal(
        await page
          .getByRole("button", { name: "开始分析", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByRole("button", { name: "去设置 AI", exact: true })
        .click();
      await page.waitForURL((url) => url.pathname === "/settings");
      aiConfigured = true;
      await go("/knowledge");
      await page.getByRole("button", { name: "导入知识", exact: true }).click();
      await page.locator(".ki-source-editor .cm-content").waitFor();
      assert(
        (
          await page.locator(".ki-source-editor .cm-content").innerText()
        ).includes("前往设置之前的原文"),
      );
      await page.getByRole("button", { name: "关闭导入知识条目" }).click();
      await page.getByRole("button", { name: "放弃并关闭" }).click();
    },
  );

  for (const width of [1280, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
    for (const [path, selector, name] of [
      ["/knowledge", ".kl-library", "knowledge"],
      ["/review", ".rs-main", "review"],
      ["/reviews", ".rp-main", "reviews"],
      ["/settings?tab=appearance", ".st-main", "settings"],
    ]) {
      await go(path);
      await page.locator(selector).waitFor();
      await check(
        `${name} ${width}px no overflow or clipped workspace`,
        async () => {
          const dims = await page.locator(selector).evaluate((el) => ({
            right: el.getBoundingClientRect().right,
            width: document.documentElement.scrollWidth,
            viewport: innerWidth,
          }));
          assert(dims.width <= dims.viewport + 1, JSON.stringify(dims));
          assert(dims.right <= dims.viewport + 1, JSON.stringify(dims));
        },
      );
      if (width === 390) await shot(`${name}-mobile`);
    }
  }
  await go("/knowledge");
  await page.getByRole("button", { name: "导入知识", exact: true }).click();
  await page.locator(".ki-method-grid").waitFor();
  await shot("import-mobile");
  await check(
    "mobile import is contained and keyboard dismissal restores focus",
    async () => {
      const rect = await page.locator(".ki-dialog").boundingBox();
      assert(rect.width <= 360);
      await page.keyboard.press("Escape");
      await page.locator(".ki-dialog").waitFor({ state: "detached" });
      assert(
        await page
          .getByRole("button", { name: "导入知识", exact: true })
          .evaluate((el) => el === document.activeElement),
      );
    },
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.deepEqual(errors, []);
  console.log("All checks passed:", checks.length);
} catch (error) {
  console.error(error);
  await shot("failure");
  await fs.writeFile(
    `${out}/failure-dom.txt`,
    await page.locator("body").innerText(),
  );
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    `${out}/browser-report.json`,
    JSON.stringify(
      {
        checks,
        errors,
        requests,
        writes: writes.map(({ path, method }) => ({ path, method })),
      },
      null,
      2,
    ),
  );
  await browser.close();
}
