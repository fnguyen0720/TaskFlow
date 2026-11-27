import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

test("momentum displays recorded activity and credits only finished local sessions", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-19T12:00:00Z") });
  const api = await installMockApi(page, { initialTasks: [fixtureTask(5, "Focus task", "2026-12-01")] });
  await signIn(page);
  const momentum = page.getByRole("region", { name: "Productivity momentum" });
  await expect(momentum.getByRole("img")).toBeVisible();
  await expect(momentum).toContainText("0/7");
  await page.getByRole("button", { name: "Focus on Focus task" }).click();
  const focus = page.getByRole("dialog", { name: "Focus task" });
  await focus.getByRole("button", { name: "15 min" }).click();
  await focus.getByRole("button", { name: "Start focus" }).click();
  await page.clock.fastForward(15 * 60 * 1000);
  await expect(focus.getByText("Session finished")).toBeVisible();
  await page.clock.fastForward(1000);
  await focus.getByRole("button", { name: "Close focus mode" }).click();
  await expect(momentum).toContainText("15 min");
  expect(api.calls.filter(c => c.method !== "GET" && c.pathname.startsWith("/api/tasks"))).toHaveLength(0);
  await page.reload();
  await expect(momentum).toContainText("0 min");
});

test("momentum shows unavailable history rather than invented zeros on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await installMockApi(page, { failCompletionHistory: true });
  await signIn(page);
  const momentum = page.getByRole("region", { name: "Productivity momentum" });
  await expect(momentum.getByText("Recent progress unavailable.")).toBeVisible();
  await expect(momentum.getByRole("button", { name: "Retry progress" })).toBeVisible();
  await expect(momentum.getByRole("img")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("momentum and insights share one history snapshot and refresh together", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(9, "Review progress", "2026-11-19")],
    initialActivities: [{ id: 1, taskId: 9, kind: "completed", occurredAt: "2026-11-19T10:00:00Z" }]
  });
  await signIn(page);
  const momentum = page.getByRole("region", { name: "Productivity momentum" });
  await expect(momentum.getByRole("img")).toHaveAttribute("aria-label", /2026-11-19: 1 completion events/);
  await expect(momentum).toContainText("1/7");
  await expect(momentum).toContainText("Your busiest day this week!");
  const reads = () => api.calls.filter(call => call.pathname === "/api/analytics/completions").length;
  const initial = reads();
  await page.getByRole("button", { name: "Insights & rewards" }).click();
  const insights = page.getByRole("region", { name: "Productivity insights" });
  await insights.getByRole("button", { name: "Show insights" }).click();
  const history = insights.getByRole("region", { name: "Completion history" });
  await expect(history.getByRole("img")).toBeVisible();
  expect(reads()).toBe(initial);
  await history.getByRole("button", { name: "Refresh trend" }).click();
  await expect.poll(reads).toBe(initial + 1);
  await expect(momentum.getByRole("img")).toBeVisible();
  await expect(history.getByRole("img")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
