/**
 * Copy text through the asynchronous Clipboard API when it is available.
 *
 * The legacy command is deliberately used only when the page is not a secure
 * context or when the modern API is missing. If writeText() rejects, falling
 * through after the await can lose the click's transient user activation;
 * some remote browsers then report execCommand("copy") as successful without
 * actually updating the system clipboard.
 */
export async function copyText(text: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  const secureContext = typeof window === "undefined" || window.isSecureContext !== false;

  if (clipboard?.writeText && secureContext) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Do not run the synchronous fallback after an awaited rejection. The
      // browser may already have consumed the user activation for this click.
      throw new Error("clipboard unavailable");
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
