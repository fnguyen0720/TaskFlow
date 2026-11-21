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
  await expect(page.getByRole("alert")).toContainText("Could not verify your task list");
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
  await page.route("**/mock-api/api/tasks?*", async (route) => {
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
  await page.route("**/mock-api/api/tasks?*", async route => {
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
  page.once("dialog", dialog => dialog.accept());
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
  await detail.getByRole("button", { name: "Retry save" }).click();
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

test("Cmd/Ctrl+K searches tasks and Enter opens the selected task", async ({ page }) => {
  await installMockApi(page, { initialTasks: [
    fixtureTask(101, "Prepare the release", "2026-11-19"),
    fixtureTask(102, "Write documentation", "2026-11-19"),
  ] });
  await signIn(page);
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Prepare the release");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();
  const search = palette.getByRole("combobox", { name: "Search tasks and commands" });
  await expect(search).toBeFocused();
  await search.fill("documentation");
  await expect(palette.getByRole("option", { name: /Write documentation/ })).toBeVisible();
  await search.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Write documentation" })).toBeVisible();
});

test("command palette supports arrow navigation, Escape, and explicit launcher", async ({ page }) => {
  await installMockApi(page);
  await signIn(page);
  const launcher = page.getByRole("button", { name: "Open search and commands" });
  await launcher.click();
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  const search = palette.getByRole("combobox", { name: "Search tasks and commands" });
  await search.fill("calendar");
  await search.press("ArrowDown");
  await expect(palette.getByRole("option", { name: /Go to Calendar/ })).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowUp");
  await expect(palette.getByRole("option", { name: /Go to Calendar/ })).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Meta+k");
  await expect(palette).toBeVisible();
  await search.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

test("quick-create command focuses the existing form and preserves its draft", async ({ page }) => {
  await installMockApi(page);
  await signIn(page);
  const title = page.getByRole("textbox", { name: "New task title" });
  await title.fill("Keep this draft");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await palette.getByRole("combobox", { name: "Search tasks and commands" }).fill("create");
  await palette.getByRole("option", { name: /Create a new task/ }).click();
  await expect(palette).toHaveCount(0);
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("Keep this draft");
});

test("command navigation respects declined unsaved-edit discard", async ({ page }) => {
  await installMockApi(page, { initialTasks: [fixtureTask(103, "Do not lose this edit", "2026-11-19")] });
  await signIn(page);
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Do not lose this edit");
  await page.getByRole("button", { name: "Edit Do not lose this edit" }).click();
  const title = page.getByRole("textbox", { name: "Edit title for Do not lose this edit" });
  await title.fill("Unsubmitted edit");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await palette.getByRole("combobox", { name: "Search tasks and commands" }).fill("calendar");
  page.once("dialog", dialog => dialog.dismiss());
  await palette.getByRole("option", { name: /Go to Calendar/ }).click();
  await expect(palette).toBeVisible();
  await expect(title).toHaveValue("Unsubmitted edit");
  page.once("dialog", dialog => dialog.accept());
  await palette.getByRole("option", { name: /Go to Calendar/ }).click();
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ })).toHaveAttribute("aria-pressed", "true");
});

test("command palette has a useful empty state on narrow mobile screens", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await installMockApi(page);
  await signIn(page);
  await page.getByRole("button", { name: "Open search and commands" }).click();
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await palette.getByRole("combobox", { name: "Search tasks and commands" }).fill("no matching task xyz");
  await expect(palette.getByRole("status")).toContainText("No matching tasks or commands");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(320);
  await palette.getByRole("button", { name: "Close command palette" }).click();
  await expect(palette).toHaveCount(0);
});

test("productivity insights show current category and due-date snapshot", async ({ page }) => {
  const tasks = [
    fixtureTask(201, "Late project", "2026-11-18"),
    fixtureTask(202, "Today task", "2026-11-19"),
    fixtureTask(203, "Future project", "2026-11-23"),
  ];
  tasks[0].category = "Work";
  tasks[1].category = "Work";
  tasks[2].category = "Personal";
  tasks[2].completed = true;
  await installMockApi(page, { initialTasks: tasks });
  await signIn(page);
  const section = page.getByRole("region", { name: "Productivity insights" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("button", { name: "Show insights" })).toHaveAttribute("aria-expanded", "false");
  await section.getByRole("button", { name: "Show insights" }).click();
  await expect(section.getByRole("button", { name: "Hide insights" })).toHaveAttribute("aria-expanded", "true");
  await expect(section.getByRole("region", { name: "Tasks by category" })).toContainText("Work");
  await expect(section.getByRole("region", { name: "Active task schedule" })).toContainText("Overdue");
  await expect(section.getByRole("region", { name: "Active task schedule" })).toContainText("Due today");
  await expect(section).toContainText("Current task snapshot");
  await section.getByRole("button", { name: "Hide insights" }).click();
  await expect(section.getByRole("region", { name: "Tasks by category" })).toHaveCount(0);
});

test("productivity insights fit 320px mobile and show an empty workspace safely", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await installMockApi(page);
  await signIn(page);
  const section = page.getByRole("region", { name: "Productivity insights" });
  await section.getByRole("button", { name: "Show insights" }).click();
  await expect(section).toContainText("Add a task to see the category breakdown.");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(320);
});

test("month mode navigates months, opens tasks and quick-adds a chosen date", async ({ page }) => {
  await installMockApi(page, { initialTasks: [
    fixtureTask(301, "November review", "2026-11-19"),
    fixtureTask(302, "December delivery", "2026-12-01"),
  ] });
  await signIn(page);
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  await page.getByRole("group", { name: "Calendar display" }).getByRole("button", { name: "Month" }).click();
  const month = page.getByRole("region", { name: "Monthly task calendar" });
  await expect(month).toContainText("November review");
  await expect(month.getByRole("heading", { name: "November 2026" })).toBeVisible();
  await month.getByRole("button", { name: "Next month" }).click();
  await expect(month.getByRole("heading", { name: "December 2026" })).toBeVisible();
  await expect(month).toContainText("December delivery");
  await month.getByRole("button", { name: "Add task for Tuesday, December 1, 2026" }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toBeFocused();
  await expect(page.getByLabel("Due date")).toHaveValue("2026-12-01");
  await month.getByRole("button", { name: "This month" }).click();
  await expect(month.getByRole("heading", { name: "November 2026" })).toBeVisible();
});

test("month mode reschedules through keyboard-accessible date input", async ({ page }) => {
  const api = await installMockApi(page, { initialTasks: [fixtureTask(303, "Monthly move", "2026-11-19")] });
  await signIn(page);
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  await page.getByRole("group", { name: "Calendar display" }).getByRole("button", { name: "Month" }).click();
  const month = page.getByRole("region", { name: "Monthly task calendar" });
  await month.getByRole("button", { name: "Move Monthly move to date" }).click();
  await month.locator("#month-move-303").fill("2026-11-20");
  await month.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => api.calls.filter(call => call.pathname === "/api/tasks/303/due-date").length).toBe(1);
  await expect(month.getByRole("region", { name: "Friday, November 20, 2026" })).toContainText("Monthly move");
});

test("weekly date jump from PR12 selects a distant week and fits mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await installMockApi(page, { initialTasks: [fixtureTask(304, "Future target", "2027-01-01")] });
  await signIn(page);
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  await page.getByLabel("Jump to date").fill("2027-01-01");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  const week = page.getByRole("region", { name: "Weekly task calendar" });
  await expect(week).toContainText("Future target");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(320);
});

test("PWA manifest and raster icons are available with correct dimensions", async ({ page }) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.name).toContain("TaskFlow");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(entry => entry.sizes === size + "x" + size);
    expect(icon).toBeDefined();
    const response = await page.request.get(icon.src);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
  const workerResponse = await page.request.get("/sw.js");
  expect(workerResponse.ok()).toBe(true);
  const worker = await workerResponse.text();
  expect(worker).not.toContain("caches.open");
  expect(worker).not.toContain("localStorage");
});

test("month view scrolls inside its own region on narrow mobile screens", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await installMockApi(page, { initialTasks: [fixtureTask(400, "Mobile calendar task", "2026-11-19")] });
  await signIn(page);
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  await page.getByRole("group", { name: "Calendar display" }).getByRole("button", { name: "Month" }).click();
  const scroll = page.getByRole("region", { name: "Scrollable month grid" });
  await expect(scroll).toBeVisible();
  const dimensions = await scroll.evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    viewportWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  expect(dimensions.viewportWidth).toBeLessThanOrEqual(320);
  await scroll.focus();
  await scroll.press("ArrowRight");
  await expect(scroll).toBeFocused();
});

test("mobile bottom navigation changes views and quick-add focuses task creation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 780 });
  await installMockApi(page, { initialTasks: [fixtureTask(501, "Mobile navigation task", "2026-11-19")] });
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Mobile quick navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "All" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Today" }).click();
  await expect(nav.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Calendar" }).click();
  await expect(page.getByRole("region", { name: "Weekly task calendar" })).toBeVisible();
  const title = page.getByRole("textbox", { name: "New task title" });
  await title.fill("Preserve mobile draft");
  await nav.getByRole("button", { name: "Quick add task" }).click();
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("Preserve mobile draft");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
});

test("mobile view switch honors canceled discard confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 780 });
  await installMockApi(page, { initialTasks: [fixtureTask(502, "Unsaved mobile edit", "2026-11-19")] });
  await signIn(page);
  await page.getByRole("button", { name: "Edit Unsaved mobile edit" }).click();
  const field = page.getByRole("textbox", { name: "Edit title for Unsaved mobile edit" });
  await field.fill("Still editing");
  const nav = page.getByRole("navigation", { name: "Mobile quick navigation" });
  page.once("dialog", dialog => dialog.dismiss());
  await nav.getByRole("button", { name: "Calendar" }).click();
  await expect(field).toHaveValue("Still editing");
  await expect(nav.getByRole("button", { name: "All" })).toHaveAttribute("aria-current", "page");
  page.once("dialog", dialog => dialog.accept());
  await nav.getByRole("button", { name: "Calendar" }).click();
  await expect(nav.getByRole("button", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
});

test("mobile bottom bar hides on desktop and behind task details", async ({ page }) => {
  await installMockApi(page, { initialTasks: [fixtureTask(503, "Mobile details", "2026-11-19")] });
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Mobile quick navigation" });
  await expect(nav).toBeHidden();
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(nav).toBeVisible();
  await page.getByRole("button", { name: "Mobile details", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Mobile details" })).toBeVisible();
  await expect(nav).toHaveCount(0);
});

test("mobile task form keeps due date and repeat controls in separate rows", async ({ page }) => {
  await installMockApi(page);
  await signIn(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 780 });
    const form = page.getByRole("form", { name: "Add a new task" });
    const due = form.getByLabel("Due date");
    const repeat = form.getByRole("combobox", { name: "Repeat task" });
    const reminder = form.getByRole("combobox", { name: "Task reminder" });
    const shell = form.locator(".create-date-shell");
    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();
    const dueBox = await due.boundingBox();
    const repeatBox = await repeat.boundingBox();
    const reminderBox = await reminder.boundingBox();
    expect(dueBox).not.toBeNull();
    const formBox = await form.boundingBox();
    expect(formBox).not.toBeNull();
    // Verify the native date control stays inside the form, not merely above Repeat.
    expect(shellBox.x).toBeGreaterThanOrEqual(formBox.x);
    expect(shellBox.x + shellBox.width).toBeLessThanOrEqual(formBox.x + formBox.width - 1);
    expect(dueBox.x).toBeGreaterThanOrEqual(shellBox.x - 1);
    expect(dueBox.x + dueBox.width).toBeLessThanOrEqual(shellBox.x + shellBox.width + 1);
    expect(await shell.evaluate(el => getComputedStyle(el).overflowX)).toBe("hidden");
    expect(dueBox.x).toBeGreaterThanOrEqual(formBox.x - 1);
    expect(dueBox.x + dueBox.width).toBeLessThanOrEqual(formBox.x + formBox.width - 1);
    expect(dueBox.width).toBeGreaterThan(100);
    expect(repeatBox).not.toBeNull();
    expect(reminderBox).not.toBeNull();
    expect(dueBox.y + dueBox.height).toBeLessThanOrEqual(repeatBox.y - 4);
    expect(repeatBox.x + repeatBox.width).toBeLessThanOrEqual(reminderBox.x - 4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await due.fill("2026-11-26");
    await repeat.selectOption("Weekly");
    await reminder.selectOption("1");
    await expect(due).toHaveValue("2026-11-26");
    await expect(repeat).toHaveValue("Weekly");
  }
});

test("mobile details editor contains date control, supports clearing, and protects unsaved work", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const api = await installMockApi(page, { initialTasks: [fixtureTask(611, "Mobile details workflow", "2026-11-19")] });
  await signIn(page);
  await page.getByRole("button", { name: "Mobile details workflow", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Mobile details workflow" });
  const due = detail.getByLabel("Due date");
  const shell = detail.locator(".task-detail-date-shell");
  await expect(detail.getByText("Tap the date to change it.")).toBeVisible();
  const box = await detail.boundingBox();
  const shellBox = await shell.boundingBox();
  expect(box).not.toBeNull();
  expect(shellBox).not.toBeNull();
  expect(shellBox.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(shellBox.x + shellBox.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await shell.evaluate(node => getComputedStyle(node).overflowX)).toBe("hidden");
  await detail.getByRole("button", { name: "Clear date" }).click();
  await expect(due).toHaveValue("");
  await expect(detail.getByText("Optional — tap the field to choose a date.")).toBeVisible();
  await expect(detail.getByRole("status")).toContainText("Unsaved changes");
  page.once("dialog", dialog => dialog.dismiss());
  await detail.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(detail).toBeVisible();
  await due.fill("2026-11-27");
  await detail.getByRole("button", { name: "Save details" }).click();
  await expect(detail).toHaveCount(0);
  expect(api.tasks[0].dueDate?.slice(0, 10)).toBe("2026-11-27");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("mobile details failed save retains notes and checklist, announces retry, then saves", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 750 });
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(612, "Mobile safe retry", "2026-11-19")],
    failTaskDetails: 1,
  });
  await signIn(page);
  await page.getByRole("button", { name: "Mobile safe retry", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Mobile safe retry" });
  await detail.getByRole("textbox", { name: "Notes" }).fill("Draft survives outage");
  await detail.getByRole("button", { name: "Add step" }).click();
  await detail.getByRole("textbox", { name: "Step 1" }).fill("Keep checklist too");
  await detail.getByRole("button", { name: "Save details" }).click();
  await expect(detail.getByRole("alert")).toContainText("Your changes are still here");
  await expect(detail.getByRole("button", { name: "Retry save" })).toBeEnabled();
  await expect(detail.getByRole("textbox", { name: "Notes" })).toHaveValue("Draft survives outage");
  await expect(detail.getByRole("textbox", { name: "Step 1" })).toHaveValue("Keep checklist too");
  await detail.getByRole("button", { name: "Retry save" }).click();
  await expect(detail).toHaveCount(0);
  expect(api.tasks[0].notes).toBe("Draft survives outage");
  expect(api.tasks[0].checklist[0].text).toBe("Keep checklist too");
});

test("mobile inline task editor controls remain inside viewport and recover from failed save", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(613, "Mobile inline edit", "2026-11-19")],
    failTaskEdits: 1,
  });
  await signIn(page);
  await page.getByRole("button", { name: "Edit Mobile inline edit" }).click();
  const field = page.getByRole("textbox", { name: "Edit title for Mobile inline edit" });
  await field.fill("Mobile change kept");
  const date = page.getByLabel("Due date for Mobile inline edit");
  const shell = page.locator(".edit-due-shell");
  const shellBox = await shell.boundingBox();
  expect(shellBox).not.toBeNull();
  expect(shellBox.x + shellBox.width).toBeLessThanOrEqual(320);
  await date.fill("2026-11-25");
  await page.getByRole("button", { name: "Save changes to Mobile inline edit" }).click();
  await expect(page.getByRole("alert")).toContainText("Your edits are still here");
  await expect(page.getByRole("alert")).toContainText("retry without retyping");
  await expect(field).toHaveValue("Mobile change kept");
  await expect(date).toHaveValue("2026-11-25");
  await page.getByRole("button", { name: "Save changes to Mobile inline edit" }).click();
  await expect(page.getByRole("button", { name: "Edit Mobile change kept" })).toBeVisible();
  expect(api.tasks[0].dueDate?.slice(0, 10)).toBe("2026-11-25");
});

test("mobile due date caption and displayed value stay centered without overflowing", async ({ page }) => {
  await installMockApi(page);
  await signIn(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 780 });
    const form = page.getByRole("form", { name: "Add a new task" });
    const due = form.getByLabel("Due date", { exact: true });
    const shell = form.locator(".create-date-shell");
    const display = form.locator(".create-date-display");
    await expect(form.locator(".create-date-label")).toBeVisible();
    await expect(display).toHaveText("Choose a date");
    await due.fill("2026-11-21");
    await expect(due).toHaveValue("2026-11-21");
    await expect(display).toContainText("Nov 21, 2026");
    const shellBox = await shell.boundingBox();
    const displayBox = await display.boundingBox();
    const formBox = await form.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(displayBox).not.toBeNull();
    expect(formBox).not.toBeNull();
    expect(shellBox.height).toBeLessThanOrEqual(46);
    expect(shellBox.x + shellBox.width).toBeLessThanOrEqual(formBox.x + formBox.width + 1);
    expect(Math.abs(displayBox.y + displayBox.height / 2 - (shellBox.y + shellBox.height / 2))).toBeLessThanOrEqual(2);
    expect(await display.evaluate(node => getComputedStyle(node).pointerEvents)).toBe("none");
    expect(await due.evaluate(node => getComputedStyle(node).opacity)).toBe("0");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await due.fill("");
    await expect(display).toHaveText("Choose a date");
  }
});

test("server-confirmed empty account is explicit and can recover without modifying tasks", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(701, "Existing protected record", "2026-11-19")],
    emptyTaskReads: 1,
  });
  await signIn(page);
  await expect(page.getByText("Server returned no tasks for this signed-in account.")).toBeVisible();
  await expect(page.getByText("This result does not mean your tasks were deleted.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your space is ready." })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Loading workspace" })).toHaveCount(0);
  await expect(page.locator(".overview")).toBeVisible();
  await expect(page.getByRole("region", { name: "Productivity insights" })).toBeVisible();
  expect(api.tasks).toHaveLength(1);
  await page.getByRole("button", { name: "Check server again" }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Existing protected record");
  await expect(page.getByText("1 task in your workspace")).toBeVisible();
  expect(api.tasks).toHaveLength(1);
  expect(api.calls.filter(call => call.method === "GET" && call.pathname === "/api/tasks")).toHaveLength(2);
});

test("malformed 200 task response never masquerades as an empty account", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(702, "Still on server", "2026-11-19")],
    invalidTaskReads: 1,
  });
  await signIn(page);
  await expect(page.getByRole("alert")).toContainText("Could not verify your task list");
  await expect(page.getByText("Task count unavailable — please retry the server check.")).toBeVisible();
  await expect(page.getByText("Server returned no tasks for this signed-in account.")).toHaveCount(0);
  await expect(page.locator(".overview")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Still on server");
  expect(api.tasks).toHaveLength(1);
});

test("failed task read exposes no fabricated zero count and retry restores the tasks", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(703, "Retry protected record", "2026-11-19")],
    failTaskReads: 1,
  });
  await signIn(page);
  await expect(page.getByRole("alert")).toContainText("Could not verify your task list");
  await expect(page.locator(".panel-subtitle")).toContainText("Task count unavailable");
  await expect(page.locator(".overview")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Retry protected record");
  expect(api.tasks).toHaveLength(1);
});

test("expired API session returns to sign-in with an honest recovery message", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(801, "Protected task", "2026-11-19")],
    unauthorizedTaskReads: 1,
  });
  await page.goto("/");
  await page.getByPlaceholder("Email address").fill("tester@example.com");
  await page.getByPlaceholder("Password").fill("ValidPassword123!");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator(".auth-form [role=status]")).toContainText("Your session expired. Sign in again");
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Task views" })).toHaveCount(0);
  expect(api.tasks).toHaveLength(1);
  await page.getByPlaceholder("Password").fill("ValidPassword123!");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Protected task");
});

test("temporary login outage explains retry and succeeds without changing tasks", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(802, "Persisted task", "2026-11-19")],
    failLoginAttempts: 1,
  });
  await page.goto("/");
  await page.getByPlaceholder("Email address").fill("tester@example.com");
  await page.getByPlaceholder("Password").fill("ValidPassword123!");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByPlaceholder("Password")).toHaveValue("ValidPassword123!");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Persisted task");
  expect(api.tasks).toHaveLength(1);
});

test("sign-out in another tab immediately removes protected workspace data", async ({ page, context }) => {
  await installMockApi(page, { initialTasks: [fixtureTask(803, "Private task", "2026-11-19")] });
  await signIn(page);
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Private task");
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await otherTab.evaluate(() => localStorage.removeItem("taskflow_token"));
  await expect(page.getByRole("navigation", { name: "Task views" })).toHaveCount(0);
  await expect(page.locator(".auth-form [role=status]")).toContainText("signed out in another tab");
  await otherTab.close();
});

test("account identity shows the authenticated email without exposing it after logout", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(901, "Private account task", "2026-11-19")],
  });
  await signIn(page);
  await expect(page.getByText("Signed in as")).toContainText("tester@example.com");
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Private account task");
  await page.getByRole("button", { name: /Log out/ }).click();
  await expect(page.getByText("tester@example.com")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Task views" })).toHaveCount(0);
  expect(api.tasks).toHaveLength(1);
  expect(api.calls.filter(call => call.pathname === "/api/account/me").length).toBeGreaterThan(0);
});

test("failed identity lookup offers retry without hiding or changing tasks", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(902, "Stable record", "2026-11-19")],
    failAccountReads: 1,
  });
  await signIn(page);
  await expect(page.locator(".account-identity-unavailable")).toContainText("Account unavailable");
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Stable record");
  await page.locator(".account-identity").getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".account-identity-email")).toContainText("tester@example.com");
  expect(api.tasks).toHaveLength(1);
  expect(api.calls.filter(call => call.method === "GET" && call.pathname === "/api/account/me")).toHaveLength(2);
});

test("account identity never exposes stale email after another tab signs out", async ({ page, context }) => {
  await installMockApi(page);
  await signIn(page);
  await expect(page.locator(".account-identity-email")).toContainText("tester@example.com");
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await otherTab.evaluate(() => localStorage.removeItem("taskflow_token"));
  await expect(page.locator(".account-identity")).toHaveCount(0);
  await otherTab.close();
});

test("large workspace loads every bounded page before exposing complete filters and counts", async ({ page }) => {
  const fixtures = Array.from({ length: 205 }, (_, index) => ({
    ...fixtureTask(index + 1001, `Task number ${index + 1}`, "2026-11-19"),
    completed: index < 25,
    category: index === 204 ? "Study" : "General",
    priority: index === 204 ? "High" : "Medium",
  }));
  const api = await installMockApi(page, { initialTasks: fixtures });
  await signIn(page);
  await expect(page.getByText("205 tasks in your workspace")).toBeVisible();
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(50);
  await expect(page.locator(".task-page-controls")).toContainText("Showing 50 of 205 tasks");
  await expect(page.locator(".overview")).toContainText("180");
  const reads = api.calls.filter(call => call.method === "GET" && call.pathname === "/api/tasks");
  expect(reads.map(call => new URLSearchParams(call.search).get("offset"))).toEqual(["0", "100", "200"]);
  expect(reads.every(call => new URLSearchParams(call.search).get("limit") === "100")).toBe(true);

  await page.getByRole("button", { name: "Show more tasks" }).click();
  await expect(page.locator(".task-page-controls")).toContainText("Showing 100 of 205 tasks");
  await page.getByRole("button", { name: "Show more tasks" }).click();
  await page.getByRole("button", { name: "Show more tasks" }).click();
  await page.getByRole("button", { name: "Show more tasks" }).click();
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(205);

  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Task number 205");
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Task number 205");
  await expect(page.getByRole("list", { name: "Tasks" })).not.toContainText("Task number 204");
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("");
  await page.getByRole("combobox", { name: "Filter category" }).selectOption("Study");
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Task number 205");
  expect(api.tasks).toHaveLength(205);
});

test("failed second page never displays a truncated workspace and retry reloads all pages", async ({ page }) => {
  const fixtures = Array.from({ length: 112 }, (_, index) =>
    fixtureTask(index + 2001, `Protected task ${index + 1}`, "2026-11-19"));
  const api = await installMockApi(page, { initialTasks: fixtures });
  let failedOnce = false;
  await page.route("**/mock-api/api/tasks?*", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.searchParams.get("offset") === "100" && !failedOnce) {
      failedOnce = true;
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    }
    return route.fallback();
  });
  await signIn(page);
  await expect(page.getByRole("alert")).toContainText("Could not verify your task list");
  await expect(page.getByText("Task count unavailable — please retry the server check.")).toBeVisible();
  await expect(page.locator(".overview")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Tasks" })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("112 tasks in your workspace")).toBeVisible();
  await expect(page.locator(".task-page-controls")).toContainText("Showing 50 of 112 tasks");
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Protected task 112");
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Protected task 112");
  expect(api.tasks).toHaveLength(112);
});

test("inline concurrent edit refuses stale overwrite and preserves draft until deliberate reload", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(4301, "Shared task", "2026-11-19")],
  });
  await signIn(page);
  await page.getByRole("button", { name: "Edit Shared task" }).click();
  const draft = page.getByRole("textbox", { name: "Edit title for Shared task" });
  await draft.fill("My unsaved draft");
  api.tasks[0].title = "Updated in second tab";
  api.changeVersion(api.tasks[0]);
  await page.getByRole("button", { name: "Save changes to Shared task" }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(draft).toHaveValue("My unsaved draft");
  expect(api.tasks[0].title).toBe("Updated in second tab");
  const guarded = api.calls.find(call => call.pathname === "/api/tasks/4301/title" && call.method === "PUT");
  expect(guarded).toBeTruthy();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Discard draft and reload latest" }).click();
  await expect(draft).toHaveValue("My unsaved draft");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Discard draft and reload latest" }).click();
  await expect(draft).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Updated in second tab");
  expect(api.tasks[0].title).toBe("Updated in second tab");
});

test("details conflict retains notes/checklist and reload requires explicit consent", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(4302, "Shared details", "2026-11-19")],
  });
  await signIn(page);
  await page.getByRole("button", { name: "Shared details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Shared details" });
  await dialog.getByRole("textbox", { name: "Notes" }).fill("Draft note from this device");
  await dialog.getByRole("button", { name: "Add step" }).click();
  await dialog.getByRole("textbox", { name: "Step 1" }).fill("Draft checklist item");
  api.tasks[0].notes = "Newer note from second tab";
  api.changeVersion(api.tasks[0]);
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed elsewhere");
  await expect(dialog.getByRole("textbox", { name: "Notes" })).toHaveValue("Draft note from this device");
  await expect(dialog.getByRole("textbox", { name: "Step 1" })).toHaveValue("Draft checklist item");
  expect(api.tasks[0].notes).toBe("Newer note from second tab");
  page.once("dialog", prompt => prompt.dismiss());
  await dialog.getByRole("button", { name: "Discard draft and reload latest" }).click();
  await expect(dialog).toBeVisible();
  page.once("dialog", prompt => prompt.accept());
  await dialog.getByRole("button", { name: "Discard draft and reload latest" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Shared details", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Shared details" }).getByRole("textbox", { name: "Notes" })).toHaveValue("Newer note from second tab");
});
