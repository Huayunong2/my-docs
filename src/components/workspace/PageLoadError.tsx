import { Link } from "@tanstack/react-router";
import { FileWarning, RefreshCw } from "lucide-react";

/** Keep route failures inside the workspace instead of replacing navigation. */
export default function PageLoadError() {
  return (
    <section className="ft-page" role="alert">
      <div className="ft-empty ix-route-error">
        <FileWarning size={28} strokeWidth={1.6} />
        <h1>页面暂时未能加载</h1>
        <p>重新加载此页，或从侧边栏进入其他页面。</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="ui-button-primary"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={15} />
            重新加载
          </button>
          <Link
            to="/today"
            search={{} as never}
            className="ui-button-secondary"
          >
            返回今日
          </Link>
        </div>
      </div>
    </section>
  );
}
