import test from "node:test";
import assert from "node:assert/strict";
import { getAuthErrorMessage } from "../src/utils/authErrors.js";

const response = (status, body) => ({
  status,
  text: async () => typeof body === "string" ? body : JSON.stringify(body),
});

test("renders Identity registration password rules instead of raw validation JSON", async () => {
  const result = await getAuthErrorMessage(response(400, {
    title: "One or more validation errors occurred.",
    status: 400,
    errors: {
      PasswordTooShort: ["Passwords must be at least 6 characters."],
      PasswordRequiresDigit: ["Passwords must have at least one digit ('0'-'9')."],
    },
  }), { registering: true });
  assert.equal(result, "Passwords must be at least 6 characters. Passwords must have at least one digit ('0'-'9').");
  assert.ok(!result.includes("PasswordTooShort"));
  assert.ok(!result.includes("{"));
});

test("handles validation problem arrays and removes repeated messages", async () => {
  const result = await getAuthErrorMessage(response(400, {
    errors: { Email: ["The email field is required."], Other: ["The email field is required."] },
  }), { registering: true });
  assert.equal(result, "The email field is required.");
});

test("shows a friendly message for invalid credentials and generic problem details", async () => {
  const identityError = response(401, { title: "Unauthorized", status: 401 });
  assert.equal(await getAuthErrorMessage(identityError), "Invalid email or password.");
  assert.equal(await getAuthErrorMessage(response(400, { title: "Bad Request" }), { registering: true }),
    "Unable to create an account. Please check your details and try again.");
});

test("supports useful plaintext and problem detail messages without exposing HTML", async () => {
  assert.equal(await getAuthErrorMessage(response(400, "Account is locked."), { registering: true }), "Account is locked.");
  assert.equal(await getAuthErrorMessage(response(400, { detail: "Please use a different email address." }), { registering: true }),
    "Please use a different email address.");
  assert.equal(await getAuthErrorMessage(response(500, "<html>Server error</html>")), "Unable to sign in. Please try again.");
});

test("uses a fallback when a response body cannot be read", async () => {
  assert.equal(await getAuthErrorMessage({ status: 500, text: async () => { throw new Error("network error"); } }),
    "Unable to sign in. Please try again.");
});
