import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

const API = "http://127.0.0.1:5143";
const password = "IntegrationPassword123!";
const createEmail = () => `e2e-${randomUUID()}@example.test`;

async function register(request, email) {
  const result = await request.post(`${API}/register`, {
    data: { email, password },
  });
  expect(result.ok(), `registration: ${result.status()}`).toBeTruthy();
}

async function tokenFor(request, email) {
  const response = await request.post(`${API}/login?useCookies=false`, {
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  const tokens = await response.json();
  expect(tokens.accessToken).toBeTruthy();
  return tokens.accessToken;
}

async function signIn(page, email) {
  await page.goto("/");
  await page.getByPlaceholder("Email address").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("navigation", { name: "Task views" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-19T12:00:00Z") });
});

test("real registration, login, create, calendar Move and Undo persist in PostgreSQL", async ({ page, request }) => {
  const email = createEmail();
  await page.goto("/");
  await page.getByRole("button", { name: /Need an account\? Register/ }).click();
  await page.getByPlaceholder("Email address").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page.getByRole("alert")).toContainText("Account created!");
  await signIn(page, email);

  const title = `Real end to end ${randomUUID().slice(0, 8)}`;
  await page.getByRole("textbox", { name: "New task title" }).fill(title);
  await page.getByLabel("Due date").fill("2026-11-17");
  await page.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText(title);

  const token = await tokenFor(request, email);
  const headers = { Authorization: `Bearer ${token}` };
  const tasksBefore = await request.get(`${API}/api/tasks`, { headers });
  expect(tasksBefore.status()).toBe(200);
  const storedBefore = (await tasksBefore.json()).find(task => task.title === title);
  expect(storedBefore).toBeTruthy();
  expect(storedBefore.dueDate).toMatch(/^2026-11-17/);

  await page.getByRole("navigation", { name: "Task views" })
    .getByRole("button", { name: /Calendar/ }).click();
  const move = page.getByRole("button", { name: `Move ${title} to another day` });
  await move.click();
  await page.getByRole("combobox", { name: "Move to" }).selectOption("2026-11-18");
  await expect(page.getByRole("button", { name: "Undo move" })).toBeVisible();

  const moved = await request.get(`${API}/api/tasks`, { headers });
  expect((await moved.json()).find(task => task.title === title).dueDate)
    .toMatch(/^2026-11-18/);

  await page.getByRole("button", { name: "Undo move" }).click();
  await expect(page.getByRole("button", { name: "Undo move" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("navigation", { name: "Task views" })
    .getByRole("button", { name: /Calendar/ }).click();
  await expect(page.getByRole("region", { name: "Weekly task calendar" })).toContainText(title);

  const storedAfter = await request.get(`${API}/api/tasks`, { headers });
  expect((await storedAfter.json()).find(task => task.title === title).dueDate)
    .toMatch(/^2026-11-17/);
});

test("a second real user cannot see or modify the first user's tasks", async ({ page, request }) => {
  const ownerEmail = createEmail();
  const otherEmail = createEmail();
  await register(request, ownerEmail);
  await register(request, otherEmail);
  const ownerToken = await tokenFor(request, ownerEmail);
  const title = `Private task ${randomUUID().slice(0, 8)}`;
  const created = await request.post(`${API}/api/tasks`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { title, priority: "Medium", category: "Work", dueDate: "2026-11-19" },
  });
  expect(created.status()).toBe(201);
  const task = await created.json();

  await signIn(page, otherEmail);
  await expect(page.locator("body")).not.toContainText(title);
  const otherToken = await tokenFor(request, otherEmail);
  const denied = await request.patch(`${API}/api/tasks/${task.id}/due-date`, {
    headers: { Authorization: `Bearer ${otherToken}` },
    data: { dueDate: "2026-11-20", expectedDueDate: "2026-11-19" },
  });
  expect(denied.status()).toBe(404);
  const persisted = await request.get(`${API}/api/tasks`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  expect((await persisted.json()).find(item => item.id === task.id).dueDate)
    .toMatch(/^2026-11-19/);
});

test("real browser can configure recurrence and see its in-app reminder", async ({ page, request }) => {
  const email = createEmail();
  await register(request, email);
  await signIn(page, email);

  const title = `Repeat and remind ${randomUUID().slice(0, 8)}`;
  await page.getByRole("textbox", { name: "New task title" }).fill(title);
  await page.getByLabel("Due date").fill("2026-11-20");
  await page.getByRole("combobox", { name: "Repeat task" }).selectOption("Daily");
  await page.getByRole("combobox", { name: "Task reminder" }).selectOption("1");
  await page.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText(title);
  await expect(page.locator(".task-reminder-banner")).toContainText(title);

  const token = await tokenFor(request, email);
  const headers = { Authorization: `Bearer ${token}` };
  const before = await request.get(`${API}/api/tasks`, { headers });
  const task = (await before.json()).find(item => item.title === title);
  expect(task.recurrenceRule).toBe("Daily");
  expect(task.reminderDaysBefore).toBe(1);

  await page.getByRole("button", { name: `Mark complete: ${title}` }).click();
  await expect.poll(async () => {
    const response = await request.get(`${API}/api/tasks`, { headers });
    return (await response.json()).filter(item => item.title === title).length;
  }).toBe(2);
  const after = await request.get(`${API}/api/tasks`, { headers });
  const occurrences = (await after.json()).filter(item => item.title === title);
  expect(occurrences.find(item => !item.completed).dueDate).toMatch(/^2026-11-21/);
});

test("account recovery clearly remains disabled until an email sender is configured", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByText("Email recovery isn't available yet. No emails are being sent.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeDisabled();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

  const response = await request.get(`${API}/api/account/capabilities`);
  expect(response.status()).toBe(200);
  expect((await response.json()).emailDeliveryEnabled).toBe(false);
});

test("reset link opened during an active session is consumed and scrubbed from URL", async ({ page, request }) => {
  const email = createEmail();
  await register(request, email);
  await signIn(page, email);
  const fragment = "#resetPassword=example-token&email=" + encodeURIComponent(email);
  await page.goto("/" + fragment);
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await expect(page.getByRole("button", { name: "Back to TaskFlow" })).toBeVisible();
  await page.getByRole("button", { name: "Back to TaskFlow" }).click();
  await expect(page.getByRole("navigation", { name: "Task views" })).toBeVisible();
});
