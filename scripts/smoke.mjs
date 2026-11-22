// Production smoke checks are deliberately read-only: no login, account
// registration, task creation or mutation and no credentials are required.
// Node 22+, no dependencies.
import { pathToFileURL } from "node:url";
import { measureReadOnlyLatency, performanceSummaryMarkdown } from "./performance.mjs";

const DEFAULT_FRONTEND = "https://task-flow-pi-lake.vercel.app";
const DEFAULT_API = "https://taskflow-k63f.onrender.com";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(fetchImpl, url, options = {}) {
  const start = performance.now();
  const response = await fetchImpl(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { "Cache-Control": "no-cache", ...(options.headers || {}) },
  });
  const duration = Math.round(performance.now() - start);
  return { response, duration };
}

async function expectRequest(fetchImpl, name, url, expectedStatus, options = {}, inspect = async () => {}) {
  const { response, duration } = await request(fetchImpl, url, options);
  if (response.status !== expectedStatus) {
    throw new Error(`${name}: expected HTTP ${expectedStatus}, got ${response.status}`);
  }
  await inspect(response);
  return { name, status: response.status, durationMs: duration };
}

export async function runSmoke({
  frontendUrl = DEFAULT_FRONTEND,
  apiUrl = DEFAULT_API,
  fetchImpl = fetch,
  attempts = 15,
  intervalMs = 15_000,
  onAttempt = () => {},
} = {}) {
  const frontend = new URL(frontendUrl);
  const api = new URL(apiUrl);
  for (const url of [frontend, api]) {
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
        url.search || url.hash) {
      throw new Error("Smoke URLs must be HTTPS origins without paths or credentials.");
    }
  }
  const checks = [
    () => expectRequest(fetchImpl, "Frontend HTML", frontend.href, 200, {}, async response => {
      const html = await response.text();
      if (!/<div\s+id=["']root["']\s*>/i.test(html)) {
        throw new Error("Frontend HTML: React root element was not found");
      }
    }),
    () => expectRequest(fetchImpl, "API liveness", new URL("/health/live", api).href, 200, {}, async response => {
      if ((await response.json()).status !== "alive") throw new Error("API liveness: invalid response");
    }),
    () => expectRequest(fetchImpl, "API database readiness", new URL("/health/ready", api).href, 200, {}, async response => {
      if ((await response.json()).status !== "ready") throw new Error("API database readiness: database not ready");
    }),
    () => expectRequest(fetchImpl, "API bearer-token protection", new URL("/api/tasks", api).href, 401),
    () => expectRequest(fetchImpl, "Browser CORS preflight", new URL("/api/tasks", api).href, 204, {
      method: "OPTIONS",
      headers: {
        Origin: frontend.origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    }, async response => {
      if (response.headers.get("access-control-allow-origin") !== frontend.origin) {
        throw new Error("Browser CORS preflight: trusted origin not allowed");
      }
    }),
  ];
  const results = [];
  for (const check of checks) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await check();
        results.push({ ...result, attempts: attempt });
        onAttempt({ ...result, attempt, success: true });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        onAttempt({ error: error.message, attempt, success: false });
        if (attempt < attempts) await sleep(intervalMs);
      }
    }
    if (lastError) throw lastError;
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runSmoke({
      frontendUrl: process.env.TASKFLOW_FRONTEND_URL || DEFAULT_FRONTEND,
      apiUrl: process.env.TASKFLOW_API_URL || DEFAULT_API,
      onAttempt: outcome => {
        if (!outcome.success) console.warn(`Attempt ${outcome.attempt}: ${outcome.error}`);
      },
    });
    for (const check of result) {
      console.log(`PASS ${check.name}: HTTP ${check.status}, ${check.durationMs}ms, attempt ${check.attempts}`);
    }
    // Public, read-only sampling never uses credentials or any task endpoints.
    const latency = await measureReadOnlyLatency({
      frontendUrl: process.env.TASKFLOW_FRONTEND_URL || DEFAULT_FRONTEND,
      apiUrl: process.env.TASKFLOW_API_URL || DEFAULT_API,
    });
    for (const item of latency) console.log(`LATENCY ${item.name}: median ${item.medianMs}ms; p95 ${item.p95Ms}ms (${item.count} samples)`);
    // GitHub provides failure notifications for Actions workflows. Never log secrets.
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import("node:fs/promises");
      const rows = result.map(x => `| ${x.name} | ${x.status} | ${x.durationMs} ms | ${x.attempts} |`).join("\n");
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `## TaskFlow production smoke checks\n\n| Check | HTTP | Latency | Attempts |\n|---|---:|---:|---:|\n${rows}\n\n${performanceSummaryMarkdown(latency)}`);
    }
  } catch (error) {
    console.error(`SMOKE FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
