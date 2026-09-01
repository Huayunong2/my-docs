import HistoryPage from "./HistoryPage";

/**
 * Compatibility wrapper for legacy imports. The route itself redirects to
 * HistoryPage; keeping this wrapper prevents an old caller from resurrecting
 * the removed, duplicate archive browser.
 */
export default function ArchivePage({ onEditDate }: { onEditDate: (date: string) => void }) {
  return <HistoryPage initialView="month" onEditDate={onEditDate} />;
}
