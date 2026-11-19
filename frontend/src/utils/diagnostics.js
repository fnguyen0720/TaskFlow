// Deliberately tiny, data-minimal diagnostics. Never send Error.message,
// stack traces, URLs, query parameters, user/task data, tokens or cookies.
const API_BASE = import.meta.env?.VITE_API_URL || "http://localhost:5143";
const CODES = new Set(["unexpected_js", "unhandled_rejection", "react_render", "network_failure", "api_failure"]);
const AREAS = new Set(["ui", "authentication", "tasks", "calendar", "details", "deletion"]);
const recent = new Map();
const MAX_EVENTS_PER_MINUTE = 5;

export function newCorrelationId() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function sanitizeDiagnostic(code, area, correlationId) {
  if (!CODES.has(code) || !AREAS.has(area) ||
      typeof correlationId !== "string" || !/^[a-f0-9]{32}$/i.test(correlationId)) {
    return null;
  }
  return { code, area, correlationId: correlationId.toLowerCase() };
}

export function reportDiagnostic(code, area, correlationId = newCorrelationId()) {
  const payload = sanitizeDiagnostic(code, area, correlationId);
  if (!payload || typeof window === "undefined" || !window.location) return;
  // Only emit from actual deployed browser sessions, never from localhost/test mocks.
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
  const now = Date.now();
  for (const [key, timestamp] of recent) if (now - timestamp > 60_000) recent.delete(key);
  if (recent.size >= MAX_EVENTS_PER_MINUTE || recent.has(code + ":" + area)) return;
  recent.set(code + ":" + area, now);
  // Fire-and-forget is intentional: telemetry must never disrupt the app.
  void fetch(`${API_BASE}/api/diagnostics/frontend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

export async function fetchWithDiagnostics(url, options = {}, area = "tasks") {
  // The caller retains ownership of credentials and request bodies.
  const correlationId = newCorrelationId();
  const headers = new Headers(options.headers || {});
  headers.set("X-Request-ID", correlationId);
  try {
    const response = await fetch(url, { ...options, headers });
    if (response.status >= 500) {
      const serverId = response.headers.get("X-Request-ID");
      reportDiagnostic("api_failure", area,
        sanitizeDiagnostic("api_failure", area, serverId)?.correlationId || correlationId);
    }
    return response;
  } catch (error) {
    if (error?.name !== "AbortError") reportDiagnostic("network_failure", area, correlationId);
    throw error;
  }
}

export function installGlobalDiagnostics(target = window) {
  target.addEventListener("error", () => reportDiagnostic("unexpected_js", "ui"));
  target.addEventListener("unhandledrejection", () => reportDiagnostic("unhandled_rejection", "ui"));
}
