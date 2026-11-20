import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

const API = "http://127.0.0.1:5143";
const PASSWORD = "IntegrationPassword123!";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-19T12:00:00Z") });
});

async function createUserAndLogin(page, request) {
  const email = `notify-${randomUUID()}@example.test`;
  const register = await request.post(`${API}/register`, {
    data: { email, password: PASSWORD },
  });
  expect(register.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByPlaceholder("Email address").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("navigation", { name: "Task views" })).toBeVisible();
  return email;
}

test("notification bell allows mark read and dismiss, persists across reload", async ({ page, request }) => {
  await createUserAndLogin(page, request);
  const title = `Browser reminder ${randomUUID().slice(0,8)}`;
  await page.getByRole("textbox", { name: "New task title" }).fill(title);
  await page.getByLabel("Due date").fill("2026-11-19");
  await page.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText(title);
  await expect(page.getByRole("button", { name: /Notifications, 1 unread/ })).toBeVisible();
  await page.getByRole("button", { name: /Notifications, 1 unread/ }).click();
  const panel = page.getByRole("region", { name: "Notification center" });
  await expect(panel).toContainText(title);
  await panel.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(page.getByRole("button", { name: /Notifications, 0 unread/ })).toBeVisible();
  await panel.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(panel).not.toContainText(title);
  await page.reload();
  await page.getByRole("button", { name: /Notifications, 0 unread/ }).click();
  await expect(page.getByRole("region", { name: "Notification center" })).not.toContainText(title);
});

test("daily focus opens due tasks and notification state is private to owner", async ({ page, request }) => {
  await createUserAndLogin(page, request);
  const title = `Daily focus ${randomUUID().slice(0,8)}`;
  await page.getByRole("textbox", { name: "New task title" }).fill(title);
  await page.getByLabel("Due date").fill("2026-11-19");
  await page.getByRole("button", { name: /Add task/ }).click();
  const focus = page.getByRole("region", { name: "Daily focus" });
  await expect(focus).toContainText(title);
  await focus.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByRole("dialog")).toContainText(title);
});
