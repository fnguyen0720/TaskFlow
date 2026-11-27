import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-27T12:00:00Z") });
});

test("smart scheduling is opt-in, fully read-only, and protects existing deadlines", async ({ page }) => {
  const api = await installMockApi(page, { aiPlannerEnabled: true, initialTasks: [
    fixtureTask(51, "Ship portfolio", "2026-11-28"),
    fixtureTask(52, "Test mobile views", "2026-11-30"),
    { ...fixtureTask(53, "Previously completed", "2026-11-27"), completed: true },
  ] });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI smart scheduling" });
  await expect(planner.getByRole("button", { name: /Smart scheduling/ })).toHaveAttribute("aria-expanded", "false");
  expect(api.calls.filter(c => c.pathname === "/api/ai/smart-schedule")).toHaveLength(0);
  await planner.getByRole("button", { name: /Smart scheduling/ }).click();
  const generate = planner.getByRole("button", { name: "Preview schedule" });
  await expect(generate).toBeDisabled();
  await planner.getByRole("checkbox", { name: /Send up to 15 unfinished task titles/ }).check();
  await generate.click();
  const preview = planner.getByLabel("Suggested work dates");
  await expect(preview.locator(".ai-smart-slot")).toHaveCount(2);
  await expect(preview).toContainText("Existing deadline: 2026-11-28");
  await expect(preview).not.toContainText("Previously completed");
  const original = api.tasks.map(t => ({ id: t.id, dueDate: t.dueDate, completed: t.completed }));
  const date = preview.getByLabel("Work date for Ship portfolio");
  await expect(date).toHaveValue("2026-11-27");
  await expect(preview.locator(".ai-smart-date-display").first()).toContainText("Nov 27, 2026");
  await date.fill("2026-11-29");
  await expect(date).toHaveValue("2026-11-29");
  await expect(preview).toContainText("Suggested work date is after the deadline.");
  expect(api.tasks.map(t => ({ id: t.id, dueDate: t.dueDate, completed: t.completed }))).toEqual(original);
  expect(api.calls.filter(c => c.pathname === "/api/ai/smart-schedule").map(c => c.body))
    .toEqual([{ consent: true, today: "2026-11-27", dailyCapacity: 2 }]);
  expect(api.calls.filter(c => ["POST","PUT","PATCH","DELETE"].includes(c.method) &&
    c.pathname.startsWith("/api/tasks"))).toHaveLength(0);
  await preview.getByRole("button", { name: "Discard preview" }).click();
  await expect(preview).toHaveCount(0);
});

test("capacity edits invalidate preview and may identify overloaded days", async ({ page }) => {
  const api = await installMockApi(page, { aiPlannerEnabled: true, initialTasks: [
    fixtureTask(10, "Do overdue work", "2026-11-26"),
    fixtureTask(11, "Review code", "2026-11-27"),
    fixtureTask(12, "Existing commitment", "2026-11-27"),
  ] });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI smart scheduling" });
  await planner.getByRole("button", { name: /Smart scheduling/ }).click();
  const cap = planner.getByRole("combobox", { name: /How many tasks/ });
  await cap.selectOption("1");
  const consent = planner.getByRole("checkbox", { name: /Send up to 15 unfinished task titles/ });
  await expect(consent).not.toBeChecked();
  await consent.check();
  await planner.getByRole("button", { name: "Preview schedule" }).click();
  await expect(planner.getByLabel("Suggested work dates").locator(".ai-smart-slot")).toHaveCount(3);
  await expect(planner).toContainText("Deadline already passed.");
  await cap.selectOption("3");
  await expect(consent).not.toBeChecked();
  await expect(planner.getByLabel("Suggested work dates")).toHaveCount(0);
  expect(api.calls.filter(c => c.pathname === "/api/ai/smart-schedule")).toHaveLength(1);
  expect(api.tasks).toHaveLength(3);
});

test("smart scheduling is absent in zero-signup demo, and Safari-safe dates fit mobile", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("region", { name: "AI smart scheduling" })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await installMockApi(page, { aiPlannerEnabled: true, initialTasks: [
    fixtureTask(22, "Finish small-screen testing", "2026-11-28")
  ] });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI smart scheduling" });
  await planner.getByRole("button", { name: /Smart scheduling/ }).click();
  await planner.getByRole("checkbox", { name: /Send up to 15 unfinished task titles/ }).check();
  await planner.getByRole("button", { name: "Preview schedule" }).click();
  const preview = planner.getByLabel("Suggested work dates");
  const date = preview.getByLabel("Work date for Finish small-screen testing");
  await expect(date).toHaveCSS("opacity","0");
  await expect(preview.locator(".ai-smart-date-display")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await preview.getByRole("button", { name: "Finish small-screen testing" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});


test("seven-day workload timeline explains overloaded days with exact other-due and planned counts", async ({ page }) => {
  const initialTasks = Array.from({ length: 7 }, (_, index) =>
    fixtureTask(200 + index, "Deadline task " + (index + 1), "2026-11-27"));
  const api = await installMockApi(page, { aiPlannerEnabled: true, initialTasks });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI smart scheduling" });
  await planner.getByRole("button", { name: /Smart scheduling/ }).click();
  await planner.getByRole("combobox", { name: /How many tasks/ }).selectOption("3");
  await planner.getByRole("checkbox", { name: /Send up to 15 unfinished task titles/ }).check();
  await planner.getByRole("button", { name: "Preview schedule" }).click();

  const preview = planner.getByLabel("Suggested work dates");
  const strip = preview.getByLabel("Seven-day workload");
  await expect(strip.locator(".ai-smart-day")).toHaveCount(7);
  await expect(strip.getByRole("button", { name: /Friday, Nov 27: 7 of 3 task slots, 2 other tasks due, 5 planned/ })).toBeVisible();
  await expect(strip).toContainText("2 due · 5 planned");
  await expect(strip).toContainText("+4 over");
  await expect(preview).toContainText("7 task slots against your 3-task limit (2 other unfinished tasks due + 5 planned sessions).");
  await expect(strip.getByRole("button", { name: /Friday, Nov 27/ })).toHaveAttribute("aria-pressed", "false");

  const date = preview.getByLabel("Work date for Deadline task 1");
  await date.fill("2026-11-28");
  await expect(strip.getByRole("button", { name: /Friday, Nov 27: 6 of 3 task slots, 2 other tasks due, 4 planned/ })).toBeVisible();
  await expect(strip.getByRole("button", { name: /Saturday, Nov 28: 1 of 3 task slots, 0 other tasks due, 1 planned/ })).toBeVisible();
  await expect(preview).toContainText("Suggested work date is after the deadline.");
  await strip.getByRole("button", { name: /Saturday, Nov 28/ }).click();
  await expect(preview.locator(".ai-smart-slot")).toHaveCount(1);
  await expect(strip.getByRole("button", { name: /Saturday, Nov 28/ })).toHaveAttribute("aria-pressed", "true");
  await preview.getByRole("button", { name: "Show all suggested tasks" }).click();
  await expect(preview.locator(".ai-smart-slot")).toHaveCount(5);
  expect(api.tasks.map(t => t.dueDate)).toEqual(initialTasks.map(t => t.dueDate));
  expect(api.calls.filter(c => c.pathname === "/api/ai/smart-schedule")).toHaveLength(1);
  expect(api.calls.filter(c => c.method !== "GET" &&
    c.pathname.startsWith("/api/tasks"))).toHaveLength(0);
});

test("mobile seven-day strip scrolls horizontally without overflowing the page", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await installMockApi(page, { aiPlannerEnabled: true, initialTasks: [
    fixtureTask(20, "Check responsive layout", "2026-11-28")
  ] });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI smart scheduling" });
  await planner.getByRole("button", { name: /Smart scheduling/ }).click();
  await planner.getByRole("checkbox", { name: /Send up to 15 unfinished task titles/ }).check();
  await planner.getByRole("button", { name: "Preview schedule" }).click();
  const strip = planner.getByLabel("Seven-day workload");
  await expect(strip.locator(".ai-smart-day")).toHaveCount(7);
  const scroll = await strip.locator(".ai-smart-days").evaluate(el => ({
    contentWidth: el.scrollWidth, containerWidth: el.clientWidth
  }));
  expect(scroll.contentWidth).toBeGreaterThan(scroll.containerWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await strip.getByRole("button", { name: /Thursday, Dec 3/ }).click();
  await expect(strip.getByRole("button", { name: /Thursday, Dec 3/ })).toHaveAttribute("aria-pressed","true");
});
