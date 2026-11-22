// Read-only synthetic latency measurements. No accounts, credentials, task
// records, request URLs, response bodies, or IP addresses are logged.
const DEFAULT_TARGETS = Object.freeze([
  { name: "Frontend HTML", path: "/", kind: "frontend" },
  { name: "API liveness", path: "/health/live", kind: "api" },
  { name: "API database readiness", path: "/health/ready", kind: "api" },
]);

export function summarizeLatencies(samples) {
  if (!Array.isArray(samples) || samples.length === 0 ||
      samples.some(x => !Number.isFinite(x) || x < 0)) {
    throw new Error("Latency samples must be finite nonnegative numbers.");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = p => sorted[Math.ceil(sorted.length * p) - 1];
  return {
    count: sorted.length,
    minMs: Math.round(sorted[0]),
    medianMs: Math.round(percentile(0.5)),
    p95Ms: Math.round(percentile(0.95)),
    maxMs: Math.round(sorted[sorted.length - 1]),
  };
}

function validateOrigin(text) {
  const url = new URL(text);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Performance targets must be HTTPS origins without paths or credentials.");
  }
  return url;
}

export async function measureReadOnlyLatency({
  frontendUrl,
  apiUrl,
  fetchImpl = fetch,
  samplesPerTarget = 3,
  now = () => performance.now(),
  targets = DEFAULT_TARGETS,
} = {}) {
  const frontend = validateOrigin(frontendUrl);
  const api = validateOrigin(apiUrl);
  if (!Number.isInteger(samplesPerTarget) || samplesPerTarget < 1 || samplesPerTarget > 10) {
    throw new Error("samplesPerTarget must be 1 to 10.");
  }
  const results = [];
  for (const target of targets) {
    if (!DEFAULT_TARGETS.some(t => t.name === target.name && t.path === target.path && t.kind === target.kind)) {
      throw new Error("Only approved public read-only endpoints can be measured.");
    }
    const origin = target.kind === "frontend" ? frontend : api;
    const durations = [];
    for (let i = 0; i < samplesPerTarget; i++) {
      const begin = now();
      const response = await fetchImpl(new URL(target.path, origin).href, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
        headers: { "Cache-Control": "no-cache" },
      });
      if (response.status !== 200) {
        throw new Error(`${target.name}: expected HTTP 200, got ${response.status}`);
      }
      // Consume the small public endpoint body so the timing includes transfer.
      await response.arrayBuffer();
      durations.push(now() - begin);
    }
    results.push({ name: target.name, ...summarizeLatencies(durations) });
  }
  return results;
}

export function performanceSummaryMarkdown(results) {
  const rows = results.map(result =>
    `| ${result.name} | ${result.count} | ${result.medianMs} ms | ${result.p95Ms} ms | ${result.maxMs} ms |`
  ).join("\n");
  return `## Read-only synthetic latency samples

Measurements are synthetic observations, not real-user page experience. Cold starts, network conditions, and runner location affect results. No account or task content was accessed.

| Endpoint | Samples | Median | P95 | Max |
|---|---:|---:|---:|---:|
${rows}
`;
}
