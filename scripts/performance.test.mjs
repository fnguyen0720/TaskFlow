import test from "node:test";
import assert from "node:assert/strict";
import { measureReadOnlyLatency, summarizeLatencies, performanceSummaryMarkdown } from "./performance.mjs";

const frontendUrl = "https://task-flow-pi-lake.vercel.app";
const apiUrl = "https://taskflow-k63f.onrender.com";

test("percentiles are computed on sorted finite samples, without altering input", () => {
  const samples = [50, 10, 90, 20, 40];
  assert.deepEqual(summarizeLatencies(samples), {
    count: 5, minMs: 10, medianMs: 40, p95Ms: 90, maxMs: 90,
  });
  assert.deepEqual(samples, [50, 10, 90, 20, 40]);
  assert.throws(() => summarizeLatencies([]));
  assert.throws(() => summarizeLatencies([NaN]));
  assert.throws(() => summarizeLatencies([-1]));
});

test("synthetic sampling uses only public GET endpoints and reports no response contents", async () => {
  const requests = [];
  let clock = 0;
  const fetchImpl = async (url, options) => {
    requests.push({ url, method: options.method, auth: options.headers.Authorization });
    clock += 8;
    return new Response("SECRET-MUST-NOT-APPEAR", { status: 200 });
  };
  const results = await measureReadOnlyLatency({
    frontendUrl, apiUrl, fetchImpl, samplesPerTarget: 3,
    now: () => clock,
  });
  assert.equal(requests.length, 9);
  assert(requests.every(r => r.method === "GET" && r.auth === undefined));
  assert.deepEqual([...new Set(requests.map(r => new URL(r.url).pathname))],
    ["/", "/health/live", "/health/ready"]);
  assert.equal(results.length, 3);
  assert.equal(results[0].medianMs, 8);
  const report = performanceSummaryMarkdown(results);
  assert.match(report, /P95/);
  assert.doesNotMatch(report, /SECRET|task-flow-pi-lake|taskflow-k63f/);
});

test("invalid origins, custom endpoints, and failed status are rejected", async () => {
  const args = { frontendUrl, apiUrl, fetchImpl: async () => new Response("", { status: 503 }), samplesPerTarget: 1 };
  await assert.rejects(() => measureReadOnlyLatency(args), /expected HTTP 200, got 503/);
  await assert.rejects(() => measureReadOnlyLatency({ ...args, frontendUrl: "https://example.com/path" }), /HTTPS origins/);
  await assert.rejects(() => measureReadOnlyLatency({ ...args, targets: [{ name: "API liveness", path: "/api/tasks", kind: "api" }] }), /approved public read-only/);
  await assert.rejects(() => measureReadOnlyLatency({ ...args, samplesPerTarget: 100 }), /1 to 10/);
});
