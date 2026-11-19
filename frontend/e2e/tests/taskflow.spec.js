import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

// Pin the browser clock so the weekly calendar stays deterministic year-round.
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-19T12:00:00Z") });
});

test("rejects incorrect credentials and allows a valid sign-in", async ({ page }) => {
  await installMockApi(page);
  await page.goto("/");
  await page.getByPlaceholder("Email address").fill("tester@example.com");
  await page.getByPlaceholder("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByPlaceholder("Password").fill("ValidPassword123!");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("navigation", { name: "Task views" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Unable to load your tasks");
});

test("registers and returns to sign-in without an authenticated session", async ({ page }) => {
  await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Need an account\? Register/ }).click();
  await page.getByPlaceholder("Email address").fill("new@example.com");
  await page.getByPlaceholder("Password").fill("ValidPassword123!");
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page.getByRole("alert")).toContainText("Account created!");
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("creates a task and displays it in the weekly calendar", async ({ page }) => {
  const api = await installMockApi(page);
  await signIn(page);
  await page.getByRole("textbox", { name: "New task title" }).fill("Write browser coverage");
  await page.getByRole("textbox", { name: "New task title" }).press("Tab");
  await page.getByLabel("Due date").fill("2026-11-19");
  await page.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Write browser coverage");
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  await expect(page.getByRole("region", { name: "Weekly task calendar" })).toContainText("Write browser coverage");
  await expect(page.locator(".calendar-task-count")).toContainText("1 task scheduled");
  expect(api.tasks).toHaveLength(1);
  expect(api.tasks[0].dueDate).toBe("2026-11-19");
});

test("calendar navigation and quick-add prefill the selected date", async ({ page }) => {
  await installMockApi(page);
  await signIn(page);
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  await page.getByRole("button", { name: "Next week" }).click();
  await page.getByRole("button", { name: "Add task for Monday, November 23, 2026" }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toBeFocused();
  await expect(page.getByLabel("Due date")).toHaveValue("2026-11-23");
  await page.getByRole("button", { name: "This week" }).click();
  await expect(page.getByRole("button", { name: "This week" })).toBeDisabled();
});

test("keyboard Move reschedules, then Undo restores the original day", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(7, "Keyboard review", "2026-11-17")],
  });
  await signIn(page);
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  const moveButton = page.getByRole("button", { name: "Move Keyboard review to another day" });
  await moveButton.focus();
  await page.keyboard.press("Enter");
  await expect(moveButton).toHaveAttribute("aria-expanded", "true");
  const chooser = page.getByRole("combobox", { name: "Move to" });
  await chooser.focus();
  // Native select provides a keyboard-operable alternative to HTML drag-and-drop.
  await chooser.selectOption("2026-11-18");
  await expect(page.getByRole("button", { name: "Undo move" })).toBeVisible();
  await expect(page.locator(".calendar-day").nth(2).getByRole("button", { name: "Keyboard review", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo move" }).click();
  await expect(page.locator(".calendar-day").nth(1).getByRole("button", { name: "Keyboard review", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo move" })).toHaveCount(0);
  expect(api.calls.filter(call => call.pathname === "/api/tasks/7/due-date").map(call => call.body)).toEqual([
    { dueDate: "2026-11-18", expectedDueDate: "2026-11-17" },
    { dueDate: "2026-11-17", expectedDueDate: "2026-11-18" },
  ]);
});

test("drag-and-drop moves a task and Undo restores it", async ({ page }) => {
  await installMockApi(page, {
    initialTasks: [fixtureTask(8, "Drag review", "2026-11-17")],
  });
  await signIn(page);
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  await page.getByRole("button", { name: "Drag review", exact: true }).dragTo(page.locator(".calendar-day").nth(3));
  await expect(page.locator(".calendar-day").nth(3).getByRole("button", { name: "Drag review", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo move" }).click();
  await expect(page.locator(".calendar-day").nth(1).getByRole("button", { name: "Drag review", exact: true })).toBeVisible();
});

test("move control remains usable on a 320px mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await installMockApi(page, {
    initialTasks: [fixtureTask(9, "Long mobile task title that must remain readable and accessible", "2026-11-17")],
  });
  await signIn(page);
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  const button = page.getByRole("button", { name: /Move Long mobile task title/ });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByRole("combobox", { name: "Move to" })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(320);
});
