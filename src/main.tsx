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

// 清理旧版本留下的临时导入状态。当前版本不再提供跨应用导入入口，
// 也不应继续保留可能包含正文的浏览器存储或旧路由参数。
function clearLegacyTransientState() {
  try { window.localStorage?.removeItem("pendingShare"); } catch { /* 存储不可用 */ }
  try { window.sessionStorage?.removeItem("pendingShare"); } catch { /* 存储不可用 */ }

  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ["share-target", "text", "title"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

clearLegacyTransientState();

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
