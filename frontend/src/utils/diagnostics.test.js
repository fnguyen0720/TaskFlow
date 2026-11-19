import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDiagnostic, newCorrelationId } from "./diagnostics.js";

test("produces a valid anonymous correlation ID", () => {
  assert.match(newCorrelationId(), /^[a-f0-9]{32}$/);
});

test("only approved codes and areas leave the browser", () => {
  const id = "0123456789abcdef0123456789abcdef";
  assert.deepEqual(sanitizeDiagnostic("react_render", "ui", id),
    { code: "react_render", area: "ui", correlationId: id });
  assert.equal(sanitizeDiagnostic("error with token=secret", "ui", id), null);
  assert.equal(sanitizeDiagnostic("react_render", "task title goes here", id), null);
  assert.equal(sanitizeDiagnostic("react_render", "ui", "arbitrary-user-value"), null);
});
