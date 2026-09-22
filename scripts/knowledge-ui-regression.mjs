// Isolated browser regression: API calls are intercepted in memory; no real records are changed.
// Run against the loopback Vite development server. See docs/knowledge-ui-redesign.md.
const { chromium } = await import(
  process.env.KNOWLEDGE_PLAYWRIGHT_MODULE || "playwright-core"
);
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const out =
  process.env.KNOWLEDGE_UI_OUTPUT || "/tmp/daily-summary-knowledge-audit";
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
await page.goto("http://127.0.0.1:5173/knowledge");
await page.locator(".kl-card").first().waitFor({ timeout: 30000 });
await page.screenshot({ path: `${out}/knowledge-desktop.png` });
console.log(
  "Initial page",
  await page.title(),
  "cards",
  await page.locator(".kl-card").count(),
  "errors",
  errors,
);
await fs.writeFile(
  `${out}/initial-dom.txt`,
  await page.locator("body").innerText(),
);
const checks = [];
async function check(name, run) {
  await run();
  checks.push(name);
  console.log("PASS", name);
}
async function overflow() {
  return page.evaluate(() => ({
    body: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
}
try {
  await check("browse-first: no implicit selection or write", async () => {
    assert.equal(await page.locator(".kl-detail").count(), 0);
    assert.equal(await page.locator(".cm-editor").count(), 0);
    assert.equal(writes.length, 0);
  });
  await check("gallery and list preference persists", async () => {
    await page.getByRole("button", { name: "列表视图", exact: true }).click();
    assert.equal(
      await page.locator(".kl-collection").getAttribute("data-layout"),
      "compact",
    );
    await page.reload();
    await page.locator(".kl-card").first().waitFor();
    assert.equal(
      await page.locator(".kl-collection").getAttribute("data-layout"),
      "compact",
    );
    await page.getByRole("button", { name: "卡片视图", exact: true }).click();
  });
  await check("pagination retains server page boundaries", async () => {
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".kl-card").length === 6,
    );
    assert.equal(new URL(page.url()).searchParams.get("page"), "2");
    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".kl-card").length === 24,
    );
  });
  await check("keyboard search and IME guard", async () => {
    await page.locator("h1").click();
    await page.keyboard.press("/");
    assert.equal(
      await page
        .locator(".kl-search input")
        .evaluate((el) => document.activeElement === el),
      true,
    );
    await page.locator(".kl-search input").fill("PCIe");
    const prevented = await page.locator(".kl-search input").evaluate((el) => {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(prevented, true);
    assert.equal(new URL(page.url()).searchParams.get("q"), null);
    await page.keyboard.press("Enter");
    await page.waitForURL(/q=PCIe/);
    await page.waitForFunction(
      () => document.querySelectorAll(".kl-card").length === 5,
    );
  });
  await check("clear query restores server-paginated results", async () => {
    await page.getByRole("button", { name: "清除搜索", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".kl-card").length === 24,
    );
    assert.equal(new URL(page.url()).searchParams.get("q"), null);
  });
  await check(
    "reading is separate from editing and retains filters",
    async () => {
      await page.locator('[data-card-id="demo-1"]').click();
      await page.locator("#knowledge-reading-title").waitFor();
      assert.equal(await page.locator(".cm-editor").count(), 0);
      assert.notEqual(
        new URL(page.url()).searchParams.get("status"),
        "confirmed",
      );
      await page.screenshot({ path: `${out}/knowledge-reader.png` });
    },
  );
  await check("focus view and return to context", async () => {
    await page.getByRole("button", { name: "专注阅读", exact: true }).click();
    assert.equal(await page.locator(".kl-library").isVisible(), false);
    await page
      .getByRole("button", { name: "退出专注阅读", exact: true })
      .click();
    assert.equal(await page.locator(".kl-library").isVisible(), true);
  });
  await check(
    "editable canvas and autosave use existing endpoint",
    async () => {
      await page.getByRole("button", { name: "编辑", exact: true }).click();
      await page
        .locator("#knowledge-card-title")
        .fill("所有权与资源生命周期：已编辑");
      await page.waitForFunction(
        () =>
          document.querySelector(".kl-save-state")?.textContent === "已同步",
      );
      assert.equal(
        cards.find((c) => c.id === "demo-1").title,
        "所有权与资源生命周期：已编辑",
      );
      assert(
        writes.some(
          (r) =>
            r.path === "/knowledge-cards/demo-1" &&
            ["PUT", "PATCH"].includes(r.method),
        ),
      );
      await page.screenshot({ path: `${out}/knowledge-editor.png` });
    },
  );
  await check(
    "failed save blocks closing; retry preserves the draft",
    async () => {
      failUpdate = true;
      await page
        .locator("#knowledge-card-title")
        .fill("保存失败后仍保留的知识标题");
      await page.waitForFunction(
        () =>
          document.querySelector(".kl-save-state")?.textContent === "保存失败",
      );
      await page
        .getByRole("button", { name: "返回知识库", exact: true })
        .click();
      assert.equal(await page.locator(".kl-detail").count(), 1);
      assert.equal(
        await page.locator("#knowledge-card-title").inputValue(),
        "保存失败后仍保留的知识标题",
      );
      failUpdate = false;
      await page.getByRole("button", { name: "重试保存", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector(".kl-save-state")?.textContent === "已同步",
      );
    },
  );
  await check("review tools remain available independently", async () => {
    await page.getByRole("button", { name: "复习", exact: true }).click();
    await page.locator(".kl-review").waitFor();
    assert.equal(await page.locator(".cm-editor").count(), 0);
    await page.getByRole("button", { name: "返回知识库", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/knowledge");
    await page.locator(".kl-card").first().waitFor();
  });
  await check(
    "filter sheet restores focus; status survives reading",
    async () => {
      await page.getByRole("button", { name: "打开搜索与筛选" }).click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "关闭筛选" }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "打开搜索与筛选" })
          .evaluate((el) => document.activeElement === el),
        true,
      );
      await page.getByRole("tab", { name: /待确认/ }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".kl-card").length === 6,
      );
      await page.locator(".kl-card-link").first().click();
      await page.locator("#knowledge-reading-title").waitFor();
      await page
        .getByRole("button", { name: "返回知识库", exact: true })
        .click();
      await page.waitForURL((url) => url.pathname === "/knowledge");
      assert.equal(new URL(page.url()).searchParams.get("status"), "draft");
      await page.getByRole("tab", { name: /^全部/ }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".kl-card").length === 24,
      );
    },
  );
  await check("batch actions operate on explicit selection", async () => {
    await page
      .getByRole("checkbox", { name: "选择当前页全部知识条目" })
      .check();
    await page.getByRole("button", { name: "批量操作", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: /^添加标签/ }).click();
    await page.getByRole("textbox", { name: "要添加的标签" }).fill("回归验证");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await page.waitForTimeout(300);
    assert(
      writes.some(
        (r) =>
          r.path === "/knowledge-cards/batch" &&
          JSON.parse(r.body).action === "add_tags",
      ),
    );
    if (await page.getByRole("button", { name: "关闭批量处理" }).isVisible())
      await page.getByRole("button", { name: "关闭批量处理" }).click();
  });
  await check("new entry validation and creation", async () => {
    await page.getByRole("button", { name: "新建条目", exact: true }).click();
    await page.locator("#knowledge-card-title").waitFor();
    await page.getByRole("button", { name: "创建草稿", exact: true }).click();
    await page.locator("#knowledge-validation-summary").waitFor();
    assert.equal(
      await page.locator("#knowledge-validation-summary li").count(),
      2,
    );
    await page.locator("#knowledge-card-title").fill("隔离测试新建知识");
    await page
      .locator(".cm-content")
      .fill("这是一条用于浏览器回归验证的模拟知识，不会写入真实数据库。");
    await page.getByRole("button", { name: "创建草稿", exact: true }).click();
    await page.waitForURL(/demo-new-/);
    assert(cards.some((c) => c.title === "隔离测试新建知识"));
  });
  await check(
    "delete current entry returns to library and undo reopens it",
    async () => {
      const id = new URL(page.url()).pathname.split("/").pop();
      await page.getByRole("button", { name: "当前条目更多操作" }).click();
      await page.getByRole("menuitem", { name: "移入回收站" }).click();
      await page
        .getByRole("button", { name: "移入回收站", exact: true })
        .click();
      await page.waitForURL((url) => url.pathname === "/knowledge");
      assert(!cards.some((c) => c.id === id));
      await page.getByRole("button", { name: "撤销", exact: true }).click();
      await page.waitForURL((url) => url.pathname === `/knowledge/${id}`);
      await page.locator("#knowledge-reading-title").waitFor();
      assert(cards.some((c) => c.id === id));
    },
  );
  await check(
    "incomplete source opens the right editor; optional source can confirm",
    async () => {
      const card = cards.find((c) => c.id === "demo-2");
      card.source_date = "2026-09-22";
      await page.goto("http://127.0.0.1:5173/knowledge/demo-2");
      await page.locator("#knowledge-reading-title").waitFor();
      await page.getByRole("button", { name: "确认沉淀", exact: true }).click();
      await page.locator("#knowledge-validation-summary").waitFor();
      assert.equal(card.status, "draft");
      assert.equal(
        await page.locator(".kl-source-editor").getAttribute("open"),
        "",
      );
      await page.locator("#knowledge-source-date").fill("");
      await page.getByRole("button", { name: "确认沉淀", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector(".kl-save-state")?.textContent === "已同步",
      );
      await page
        .getByRole("button", { name: "确认沉淀", exact: true })
        .waitFor({ state: "detached" });
      assert.equal(
        cards.find((item) => item.id === card.id).status,
        "confirmed",
      );
    },
  );
  cards = structuredClone(originalCards);
  await page.goto("http://127.0.0.1:5173/knowledge");
  await page.locator(".kl-card").first().waitFor();
  for (const width of [1600, 1280, 1024, 768, 390, 360])
    await check(`responsive ${width}px has no page overflow`, async () => {
      await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
      await page.waitForTimeout(120);
      const size = await overflow();
      assert(size.body <= size.viewport, JSON.stringify(size));
      if (width === 390)
        await page.screenshot({ path: `${out}/knowledge-mobile.png` });
    });
  await check("mobile opens a dedicated reading view", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".kl-card-link").first().click();
    await page.locator("#knowledge-reading-title").waitFor();
    assert.equal(await page.locator(".kl-library").isVisible(), false);
    await page.screenshot({ path: `${out}/knowledge-mobile-reader.png` });
    await page.getByRole("button", { name: "返回知识库", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/knowledge");
  });
  await check("dark theme and reduced motion", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: /深色模式/ })
      .first()
      .click();
    await page.waitForTimeout(200);
    assert((await page.locator(".dark").count()) > 0);
    await page.screenshot({ path: `${out}/knowledge-dark.png` });
    await page
      .getByRole("button", { name: /浅色模式/ })
      .first()
      .click();
  });
  await check("missing deep link does not show a different card", async () => {
    await page.goto("http://127.0.0.1:5173/knowledge/does-not-exist");
    await page.waitForFunction(
      () =>
        document.querySelector(".kl-detail .kl-empty h3")?.textContent ===
        "暂时无法打开这条知识",
    );
    assert.equal(await page.locator("#knowledge-reading-title").count(), 0);
  });
  await check("API failure has a distinct recoverable state", async () => {
    failList = true;
    await page.goto("http://127.0.0.1:5173/knowledge");
    await page.waitForFunction(
      () =>
        document.querySelector(".kl-library .kl-empty h3")?.textContent ===
        "暂时无法读取知识库",
    );
    failList = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.locator(".kl-card-link").first().waitFor();
  });
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
    `${out}/browser-report.json`,
    JSON.stringify({ checks, errors, writes, requests }, null, 2),
  );
  await browser.close();
}
