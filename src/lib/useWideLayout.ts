import { useSyncExternalStore } from "react";
const query = "(min-width: 1280px)";
function subscribe(changed: () => void) {
  const media = window.matchMedia(query); media.addEventListener("change",changed);
  return () => media.removeEventListener("change",changed);
}
export function useWideLayout() { return useSyncExternalStore(subscribe,()=>window.matchMedia(query).matches,()=>false); }
