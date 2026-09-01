/**
 * Copy text in browsers that expose the Clipboard API as well as older or
 * insecure HTTP contexts where that API is unavailable or denied.
 */
export async function copyText(text: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path. Some remote deployments expose the
      // API but still reject it because the page is not a secure context or
      // the browser's Permissions Policy does not allow clipboard access.
    }
  }

  if (typeof document !== "undefined" && document.body && typeof document.execCommand === "function") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    try {
      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      if (document.execCommand("copy")) return;
    } finally {
      textarea.remove();
    }
  }

  throw new Error("clipboard unavailable");
}
