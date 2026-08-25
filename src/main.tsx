import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

// Web Share Target：从其他 App 分享的文字暂存，等 Today 页消费
{
  const params = new URLSearchParams(window.location.search);
  if (params.get("share-target") !== null) {
    const text = params.get("text") || "";
    const title = params.get("title") || "";
    if (text || title) {
      localStorage.setItem("pendingShare", JSON.stringify({ text, title, ts: Date.now() }));
    }
    window.history.replaceState({}, "", window.location.pathname);
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
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
