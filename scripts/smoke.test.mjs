import test from "node:test";
import assert from "node:assert/strict";
import { runSmoke } from "./smoke.mjs";

const front = "https://task-flow-pi-lake.vercel.app";
const api = "https://taskflow-k63f.onrender.com";

function response(status, body, headers = {}) {
  return new Response(body, { status, headers });
}
function mockedFetch({ ready = true, cors = true, frontend = true, protectedApi = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: opts.method || "GET" });
    if (url === front + "/") return response(frontend ? 200 : 503, '<div id="root"></div>');
    if (path === "/health/live") return response(200, JSON.stringify({ status: "alive" }));
    if (path === "/health/ready") return response(ready ? 200 : 503,
      JSON.stringify({ status: ready ? "ready" : "unavailable" }));
    if (path === "/api/tasks" && opts.method === "OPTIONS") return response(204, null, {
      "access-control-allow-origin": cors ? front : "https://unknown.example"
    });
    if (path === "/api/tasks") return response(protectedApi ? 401 : 200, "{}");
    return response(404, "");
  };
  return { fetchImpl, calls };
}

test("checks frontend, backend liveness/readiness, auth protection and CORS without writes", async () => {
  const mock = mockedFetch();
  const results = await runSmoke({ frontendUrl: front, apiUrl: api, fetchImpl: mock.fetchImpl, attempts: 1 });
  assert.equal(results.length, 5);
  assert(mock.calls.every(x => x.method === "GET" || x.method === "OPTIONS"));
});

for (const [label, variant, expected] of [
  ["database unavailable", { ready: false }, /database readiness: expected HTTP 200, got 503/i],
  ["frontend unavailable", { frontend: false }, /Frontend HTML: expected HTTP 200, got 503/i],
  ["CORS regressed", { cors: false }, /trusted origin not allowed/i],
  ["unprotected tasks", { protectedApi: false }, /bearer-token protection: expected HTTP 401, got 200/i],
]) {
  test(`fails when ${label}`, async () => {
    const mock = mockedFetch(variant);
    await assert.rejects(() => runSmoke({
      frontendUrl: front, apiUrl: api, fetchImpl: mock.fetchImpl, attempts: 1
    }), expected);
  });
}

test("refuses insecure URL configuration", async () => {
  await assert.rejects(
    () => runSmoke({ frontendUrl: "http://localhost:5173", apiUrl: api, attempts: 1 }),
    /HTTPS origins/
  );
});
