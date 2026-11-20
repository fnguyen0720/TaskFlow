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

test("failed task loading never shows false dashboard totals, and retry restores the workspace", async ({ page }) => {
  await installMockApi(page, {
    initialTasks: [fixtureTask(12, "Recover the workspace", "2026-11-19")],
    failTaskReads: 1,
  });
  await signIn(page);
  await expect(page.getByRole("alert")).toContainText("Unable to load your tasks");
  await expect(page.locator(".overview")).toHaveCount(0);
  await expect(page.locator(".dashboard-intro")).toHaveCount(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".overview")).toBeVisible();
  await expect(page.locator(".overview")).toContainText("1");
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Recover the workspace");
});

test("workspace loading placeholder fits a narrow mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await installMockApi(page);
  await page.route("**/mock-api/api/tasks", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise(resolve => setTimeout(resolve, 250));
    return route.fallback();
  });
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Task views" })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(320);
});

test("stale task reads cannot overwrite a new sign-in session", async ({ page }) => {
  await installMockApi(page);
  let reads = 0;
  await page.route("**/mock-api/api/tasks", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    const readNumber = ++reads;
    if (readNumber === 1) {
      // Simulate an old session's in-flight request finishing last.
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    const task = fixtureTask(readNumber === 1 ? 41 : 42,
      readNumber === 1 ? "Old session task" : "Current session task", "2026-11-19");
    try {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([task]) });
    } catch {
      // The browser may have already aborted the first request on logout.
    }
  });

  await signIn(page);
  await expect.poll(() => reads).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: /Log out/ }).click();
  await signIn(page);
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Current session task");
  await page.waitForTimeout(800);
  await expect(page.getByRole("list", { name: "Tasks" })).not.toContainText("Old session task");
});

test("failed inline edit keeps all draft fields and retries without retyping", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(31, "Original title", "2026-11-19")],
    failTaskEdits: 1,
  });
  await signIn(page);
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Original title");
  await page.getByRole("button", { name: "Edit Original title" }).click();
  await page.getByRole("textbox", { name: "Edit title for Original title" }).fill("Draft survives failure");
  await page.getByRole("combobox", { name: "Priority for Original title" }).selectOption("High");
  await page.getByRole("combobox", { name: "Category for Original title" }).selectOption("Work");
  await page.getByRole("button", { name: "Save changes to Original title" }).click();

  await expect(page.getByRole("alert")).toContainText("Your edits are still here");
  await expect(page.getByRole("textbox", { name: "Edit title for Original title" })).toHaveValue("Draft survives failure");
  await expect(page.getByRole("combobox", { name: "Priority for Original title" })).toHaveValue("High");
  await expect(page.getByRole("combobox", { name: "Category for Original title" })).toHaveValue("Work");
  expect(api.tasks[0].title).toBe("Original title");

  await page.getByRole("button", { name: "Save changes to Original title" }).click();
  await expect(page.getByRole("button", { name: "Edit Draft survives failure" })).toBeVisible();
  expect(api.tasks[0].title).toBe("Draft survives failure");
  expect(api.tasks[0].priority).toBe("High");
  expect(api.calls.filter(call => call.pathname === "/api/tasks/31/title")).toHaveLength(2);
});

test("failed inline edit remains cancellable without saving draft", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(32, "Stored title", "2026-11-19")],
    failTaskEdits: 1,
  });
  await signIn(page);
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Stored title");
  await page.getByRole("button", { name: "Edit Stored title" }).click();
  await page.getByRole("textbox", { name: "Edit title for Stored title" }).fill("Unsaved draft");
  await page.getByRole("button", { name: "Save changes to Stored title" }).click();
  await expect(page.getByRole("alert")).toContainText("Your edits are still here");
  await page.getByRole("button", { name: "Cancel editing Stored title" }).click();
  await expect(page.getByRole("button", { name: "Edit Stored title" })).toBeVisible();
  expect(api.tasks[0].title).toBe("Stored title");
});

test("new-task draft survives a failed request and can be saved on retry", async ({ page }) => {
  const api = await installMockApi(page, { failTaskCreates: 1 });
  await signIn(page);
  await page.getByRole("textbox", { name: "New task title" }).fill("Preserve my new task");
  await page.getByRole("combobox", { name: "Priority", exact: true }).selectOption("High");
  await page.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toHaveValue("Preserve my new task");
  await expect(page.getByRole("combobox", { name: "Priority", exact: true })).toHaveValue("High");
  await expect(page.getByRole("button", { name: "Discard draft" })).toBeEnabled();
  expect(api.tasks).toHaveLength(0);
  await page.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toHaveValue("");
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Preserve my new task");
  expect(api.tasks).toHaveLength(1);
});

test("logout and explicit discard require confirmation for new task draft", async ({ page }) => {
  await installMockApi(page);
  await signIn(page);
  await page.getByRole("textbox", { name: "New task title" }).fill("Unsubmitted task");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: /Log out/ }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toHaveValue("Unsubmitted task");
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toHaveValue("Unsubmitted task");

  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toHaveValue("Unsubmitted task");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toHaveValue("");
});

test("task details protect changed notes and checklist from accidental close", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(55, "Keep notes", "2026-11-19")],
  });
  await signIn(page);
  await page.getByRole("button", { name: "Keep notes", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Keep notes" });
  await detail.getByRole("textbox", { name: "Notes" }).fill("Important unsaved note");
  await detail.getByRole("button", { name: "Add step" }).click();
  await detail.getByRole("textbox", { name: "Step 1" }).fill("Review details");
  page.once("dialog", dialog => dialog.dismiss());
  await detail.getByRole("button", { name: "Close task details" }).click();
  await expect(detail.getByRole("textbox", { name: "Notes" })).toHaveValue("Important unsaved note");
  await expect(detail.getByRole("textbox", { name: "Step 1" })).toHaveValue("Review details");
  page.once("dialog", dialog => dialog.accept());
  await detail.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(detail).toHaveCount(0);
  expect(api.tasks[0].notes).toBe("");
});

test("task details retain changes after a failed save and close after retry", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(56, "Save notes", "2026-11-19")],
    failTaskDetails: 1,
  });
  await signIn(page);
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Save notes" });
  await detail.getByRole("textbox", { name: "Notes" }).fill("Notes survive network errors");
  await detail.getByRole("button", { name: "Save details" }).click();
  await expect(detail.getByRole("alert")).toContainText("Couldn't save task details");
  await expect(detail.getByRole("textbox", { name: "Notes" })).toHaveValue("Notes survive network errors");
  await detail.getByRole("button", { name: "Save details" }).click();
  await expect(detail).toHaveCount(0);
  expect(api.tasks[0].notes).toBe("Notes survive network errors");
});

test("switching task views asks before discarding inline edits", async ({ page }) => {
  await installMockApi(page, { initialTasks: [fixtureTask(57, "Edit in progress", "2026-11-19")] });
  await signIn(page);
  await page.getByRole("button", { name: "Edit Edit in progress" }).click();
  await page.getByRole("textbox", { name: "Edit title for Edit in progress" }).fill("Uncommitted edit");
  const calendar = page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ });
  page.once("dialog", dialog => dialog.dismiss());
  await calendar.click();
  await expect(page.getByRole("textbox", { name: "Edit title for Edit in progress" })).toHaveValue("Uncommitted edit");
  page.once("dialog", dialog => dialog.accept());
  await calendar.click();
  await expect(calendar).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Edit title for Edit in progress" })).toHaveCount(0);
});
