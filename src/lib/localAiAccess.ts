export const LOCAL_AI_ACCESS_QUERY_PARAM = "local_ai_token";
export const LOCAL_AI_TOKEN_SESSION_KEY = "daily-summary-local-ai-token";

// This is deliberately a documented, non-secret test value. The server only
// accepts it when the explicit loopback-only test mode is enabled.
export const LOCAL_AI_TEST_TOKEN = "daily-summary-local-ai-test-token";

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function isLocalHttpLocation(value: { protocol: string; hostname: string }): boolean {
  return (value.protocol === "http:" || value.protocol === "https:") && isLoopbackHostname(value.hostname);
}

export function isLoopbackHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("/")) return false;
  try {
    return isLocalHttpLocation(new URL(trimmed));
  } catch {
    return false;
  }
}

/**
 * Consume the one-time URL bootstrap value before React starts making API
 * requests. The caller owns persistence and URL replacement so this helper is
 * straightforward to test without a browser environment.
 */
export function consumeLocalAiTokenFromUrl(url: URL, saveToken: (token: string) => boolean): boolean {
  const rawToken = url.searchParams.get(LOCAL_AI_ACCESS_QUERY_PARAM);
  if (rawToken === null) return false;

  const token = rawToken.trim();
  if (token && isLocalHttpLocation(url)) saveToken(token);
  url.searchParams.delete(LOCAL_AI_ACCESS_QUERY_PARAM);
  return true;
}
