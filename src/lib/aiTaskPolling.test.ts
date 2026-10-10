import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { summarizeWithAI, waitAiTask, type AiTaskView } from "./api";

const task = (status: string, result: unknown = null): AiTaskView => ({
  id: "synthetic-job", task: "daily_summary", status, result,
  progress_percent: status === "completed" ? 100 : 0,
  error: null, analysis_job_id: null, usage: null,
  usage_complete: false, estimated_cost_cny: null,
});
const response = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, dispatchEvent: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "server_url" ? "https://summary.test/api" : null });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("returns the summary after status-only polling reports completion", async () => {
  vi.useFakeTimers();
  let polled = false;
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    requests.push(url);
    if (options?.method === "POST") return response(task("running"));
    if (url.endsWith("?summary=true")) {
      polled = true;
      return response(task("completed"));
    }
    return response(polled ? task("completed", { summary: "来自原文的总结" }) : task("running"));
  }));
  const result = summarizeWithAI({ content: "合成记录", date: "2026-10-10" });
  await vi.advanceTimersByTimeAsync(800);
  await expect(result).resolves.toEqual({ summary: "来自原文的总结" });
  expect(requests.at(-1)).toBe("https://summary.test/api/ai/tasks/synthetic-job");
});

it("fetches the result when reopening a completed task summary", async () => {
  const fetchMock = vi.fn(async () => response(task("completed", { summary: "已完成结果" })));
  vi.stubGlobal("fetch", fetchMock);
  await expect(waitAiTask(task("completed"))).resolves.toMatchObject({ result: { summary: "已完成结果" } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not fetch results for a failed or cancelled task", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(waitAiTask({ ...task("failed"), error: "模拟失败" })).rejects.toThrow("模拟失败");
  await expect(waitAiTask(task("cancelled"))).rejects.toThrow("任务已取消");
  expect(fetchMock).not.toHaveBeenCalled();
});
