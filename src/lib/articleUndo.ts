import { toast } from "sonner";
import * as api from "./api";

type ArticleUndoTarget = {
  id: string;
  date: string;
};

/**
 * Offer a real server-side restore action after an article is soft-deleted.
 * The callback lets the current view refresh its own list without making this
 * utility aware of a page's scroll or selection state.
 */
export function offerArticleUndo(
  article: ArticleUndoTarget,
  onRestored?: () => Promise<void> | void,
) {
  let restoring = false;
  toast.success(`已移入记录回收站：${article.date}`, {
    duration: 8_000,
    action: {
      label: "撤销删除",
      onClick: () => {
        if (restoring) return;
        restoring = true;
        void api.restoreArticle(article.id)
          .then(() => onRestored?.())
          .then(() => {
            toast.success(`已恢复 ${article.date} 的记录`, { duration: 2_600 });
          })
          .catch((error) => {
            restoring = false;
            toast.error(`恢复记录失败：${api.getErrorMessage(error)}`, { duration: 3_600 });
          });
      },
    },
  });
}
