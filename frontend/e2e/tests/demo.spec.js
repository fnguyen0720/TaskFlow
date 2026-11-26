import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-19T12:00:00Z") });
});

test("zero-signup demo stays local through add, complete, edit, delete, reload, and exit", async ({ page }) => {
  const calls = [];
  page.on("request", request => {
    if (request.url().includes("/mock-api/")) calls.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Try interactive demo" })).toBeVisible();
  await page.getByRole("button", { name: "Try interactive demo" }).click();
  await expect(page).toHaveURL(/demo=1/);
  await expect(page.getByRole("navigation", { name: "Task views" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("progressbar", { name: "Overall task completion" })).toHaveAttribute("aria-valuenow", "25");

  await page.getByRole("button", { name: "Mark complete: Plan the week" }).click();
  await expect(page.getByRole("progressbar", { name: "Overall task completion" })).toHaveAttribute("aria-valuenow", "50");
  await page.getByRole("textbox", { name: "New task title" }).fill("Explore filters");
  await page.getByRole("form", { name: "Add a new task" }).getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Explore filters");
  await page.getByRole("button", { name: "Edit Explore filters" }).click();
  await page.getByRole("textbox", { name: "Edit title for Explore filters" }).fill("Try local editing");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).toContainText("Try local editing");
  await page.getByRole("button", { name: "Delete Try local editing" }).click();
  await expect(page.getByRole("list", { name: "Tasks" })).not.toContainText("Try local editing");
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(4);

  await page.reload();
  await expect(page.getByRole("progressbar", { name: "Overall task completion" })).toHaveAttribute("aria-valuenow", "25");
  await expect(page.getByRole("button", { name: "Mark complete: Plan the week" })).toBeVisible();
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("taskflow_token"))).toBeNull();
  await page.getByRole("button", { name: "Sign in / Register" }).click();
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/demo=1/);
});

test("demo calendar, date quick-add, search, and reset are all local", async ({ page }) => {
  const apiCalls = [];
  page.on("request", request => {
    if (request.url().includes("/mock-api/")) apiCalls.push(request.url());
  });
  await page.goto("/?demo=1");
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Calendar/ }).click();
  await expect(page.getByRole("region", { name: "Weekly task calendar" })).toContainText("Plan the week");
  await page.getByRole("button", { name: "Move Plan the week to another day" }).click();
  await page.getByRole("combobox", { name: "Move to" }).selectOption("2026-11-20");
  await expect(page.getByRole("button", { name: "Undo move" })).toBeVisible();
  await page.getByRole("button", { name: "Undo move" }).click();
  await expect(page.getByRole("button", { name: "Undo move" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add task for Friday, November 20, 2026" }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toBeFocused();
  await expect(page.getByLabel("Demo due date")).toHaveValue("2026-11-20");
  await page.getByRole("textbox", { name: "New task title" }).fill("Demo calendar task");
  await page.getByRole("form", { name: "Add a new task" }).getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByRole("region", { name: "Weekly task calendar" })).toContainText("Demo calendar task");
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByRole("region", { name: "Monthly task calendar" })).toContainText("Demo calendar task");
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /All tasks/ }).click();
  await page.getByRole("searchbox", { name: "Search demo tasks" }).fill("calendar task");
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("searchbox", { name: "Search demo tasks" })).toHaveValue("");
  expect(apiCalls).toEqual([]);
});

test("direct demo URL is isolated even when a real-session token exists", async ({ page }) => {
  const apiCalls = [];
  page.on("request", request => {
    if (request.url().includes("/mock-api/")) apiCalls.push(request.url());
  });
  await page.addInitScript(() => localStorage.setItem("taskflow_token", "existing-session-must-not-be-read"));
  await page.goto("/?demo=1");
  await expect(page.getByRole("navigation", { name: "Task views" })).toBeVisible();
  await page.getByRole("button", { name: "Mark complete: Plan the week" }).click();
  expect(apiCalls).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("taskflow_token"))).toBe("existing-session-must-not-be-read");
});

test("demo is usable on a 320px mobile viewport with keyboard-accessible task details", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1");
  await expect(page.getByRole("navigation", { name: "Mobile quick navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quick add task" })).toBeVisible();
  await page.getByRole("button", { name: "Quick add task" }).click();
  await expect(page.getByRole("textbox", { name: "New task title" })).toBeFocused();
  await page.getByRole("button", { name: "Plan the week", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan the week" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("existing authenticated sign-in remains unaffected by the demo entry", async ({ page }) => {
  await installMockApi(page);
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Task views" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try interactive demo" })).toHaveCount(0);
});


test("demo Add Task options stay stacked and aligned on desktop and narrow mobile", async ({ page }) => {
  for (const width of [1280, 768, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?demo=1");
    const form = page.getByRole("form", { name: "Add a new task" });
    const more = form.getByRole("button", { name: "More options" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(form.getByRole("button", { name: "Fewer options" })).toHaveAttribute("aria-expanded", "true");

    const row = form.locator(".demo-add-row");
    const toggle = form.locator(".demo-options-row");
    const fields = form.locator(".demo-form-options");
    const [formBox, rowBox, toggleBox, fieldsBox] = await Promise.all(
      [form, row, toggle, fields].map(locator => locator.boundingBox())
    );
    expect(formBox).not.toBeNull();
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(toggleBox.y + 1);
    expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(fieldsBox.y + 1);
    expect(fieldsBox.x).toBeGreaterThanOrEqual(formBox.x - 1);
    expect(fieldsBox.x + fieldsBox.width).toBeLessThanOrEqual(formBox.x + formBox.width + 1);
    expect(fieldsBox.width).toBeGreaterThan(formBox.width * 0.85);
    const priority = fields.getByLabel("Priority");
    const dueDate = fields.getByLabel("Due date");
    const [priorityBox, dateBox] = await Promise.all([priority.boundingBox(), dueDate.boundingBox()]);
    if (width >= 768) {
      expect(Math.abs(priorityBox.y - dateBox.y)).toBeLessThan(4);
      expect(priorityBox.width).toBeGreaterThan(180);
    } else {
      expect(dateBox.y).toBeGreaterThan(priorityBox.y + priorityBox.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await form.getByRole("button", { name: "Fewer options" }).click();
    await expect(fields).toHaveCount(0);
    expect((await form.boundingBox()).height).toBeLessThan(formBox.height);
  }
});

test("completed demo tasks hide stale overdue or today labels and retain their due dates", async ({ page }) => {
  await page.goto("/?demo=1");
  const list = page.getByRole("list", { name: "Tasks" });
  const completed = list.getByRole("listitem").filter({ hasText: "Explore TaskFlow" });
  await expect(completed).toHaveClass(/completed/);
  await expect(completed.locator(".task-due-date")).toHaveCount(0);
  await expect(completed).not.toContainText("Overdue");

  const today = list.getByRole("listitem").filter({ hasText: "Plan the week" });
  await expect(today).toContainText("Today");
  await today.getByRole("button", { name: "Mark complete: Plan the week" }).click();
  await expect(today.locator(".task-due-date")).toHaveCount(0);
  await today.getByRole("button", { name: "Mark incomplete: Plan the week" }).click();
  await expect(today).toContainText("Today");
  await completed.getByRole("button", { name: "Mark incomplete: Explore TaskFlow" }).click();
  await expect(completed).toContainText("Overdue");
});

test("authenticated completed tasks hide warning labels but preserve underlying due dates", async ({ page }) => {
  const task = fixtureTask(7431, "Previously due task", "2026-11-18");
  task.completed = true;
  const api = await installMockApi(page, { initialTasks: [task] });
  await signIn(page);
  const item = page.getByRole("list", { name: "Tasks" }).getByRole("listitem").filter({ hasText: task.title });
  await expect(item.locator(".task-due-date")).toHaveCount(0);
  await item.getByRole("button", { name: "Mark incomplete: " + task.title }).click();
  await expect(item).toContainText("Overdue");
  await item.getByRole("button", { name: "Mark complete: " + task.title }).click();
  await expect(item.locator(".task-due-date")).toHaveCount(0);
  expect(api.tasks[0].dueDate).toBe("2026-11-18T00:00:00Z");
});


test("demo date picker paints readable text while retaining an accessible native date input on narrow screens", async ({ page }) => {
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/?demo=1");
    const form = page.getByRole("form", { name: "Add a new task" });
    await form.getByRole("button", { name: "More options" }).click();

    const shell = form.locator(".demo-date-shell");
    const display = shell.locator(".demo-date-display");
    const picker = form.getByRole("textbox", { name: "Demo due date" }).or(form.locator('input[type="date"]'));
    await expect(display).toHaveText("Choose a date");
    await expect(display).toBeVisible();
    await expect(picker).toHaveAttribute("type", "date");
    await expect(picker).toHaveValue("");
    await expect(picker).toHaveCSS("opacity", "0");
    const [shellBox, displayBox] = await Promise.all([shell.boundingBox(), display.boundingBox()]);
    expect(shellBox.width).toBeGreaterThan(130);
    expect(displayBox.width).toBeGreaterThan(130);
    expect(displayBox.x).toBeGreaterThanOrEqual(shellBox.x - 1);
    expect(displayBox.x + displayBox.width).toBeLessThanOrEqual(shellBox.x + shellBox.width + 1);

    await picker.fill("2026-12-05");
    await expect(display).toHaveText("Dec 5, 2026");
    await form.getByRole("button", { name: "Fewer options" }).click();
    await expect(form.locator(".demo-options-summary")).toContainText("2026-12-05");
    await form.getByRole("button", { name: "More options" }).click();
    await expect(display).toHaveText("Dec 5, 2026");
    await picker.fill("");
    await expect(display).toHaveText("Choose a date");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
