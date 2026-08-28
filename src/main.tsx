import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import router from "./router";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

// Web Share Target：把从其他 App 分享进来的文字暂存，等 Today 页加载完成后消费。
// 只清理分享参数，保留路由自己的 search 状态，避免刷新/跳转时误删筛选条件。
const MAX_PENDING_SHARE_CHARS = 200_000;

function capturePendingShare() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("share-target")) return;

  const text = (url.searchParams.get("text") || "").slice(0, MAX_PENDING_SHARE_CHARS);
  const title = (url.searchParams.get("title") || "").trim().slice(0, 200);
  let stored = !text && !title;
  if (text || title) {
    const payload = JSON.stringify({ text, title, ts: Date.now() });
    const storages: Storage[] = [];
    try { storages.push(window.localStorage); } catch { /* 继续尝试 sessionStorage */ }
    try { storages.push(window.sessionStorage); } catch { /* 两种存储都不可用时保留 URL */ }
    for (const storage of storages) {
      if (stored) break;
      try {
        storage.setItem("pendingShare", payload);
        stored = true;
      } catch {
        // 隐私模式或存储配额不足时尝试另一种存储；都失败则保留 URL 供用户重试。
      }
    }
  }

  if (!stored) return;
  url.searchParams.delete("share-target");
  url.searchParams.delete("text");
  url.searchParams.delete("title");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

capturePendingShare();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

// PWA：注册 Service Worker（静态资源离线缓存）
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* 离线缓存注册失败不阻塞应用 */
    });
  });
}
