import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

test("Daily Planner is opt-in, read-only, and links only to owned open tasks", async ({ page }) => {
  const api = await installMockApi(page, {
    aiPlannerEnabled: true,
    initialTasks: [
      fixtureTask(11, "Finish API tests", "2026-11-28"),
      fixtureTask(12, "Review UI details", "2026-11-29"),
      { ...fixtureTask(13, "Already completed", "2026-11-27"), completed: true }
    ]
  });
  await signIn(page);
  const panel = page.getByRole("region", { name: "AI daily planner" });
  const toggle = panel.getByRole("button", { name: /Plan my day/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(api.calls.filter(call => call.pathname === "/api/ai/daily-focus")).toHaveLength(0);
  await toggle.click();
  const generate = panel.getByRole("button", { name: "Suggest today's priorities" });
  await expect(generate).toBeDisabled();
  await expect(panel).toContainText("up to 15 unfinished task titles");
  await panel.getByRole("checkbox", { name: /I agree to send up to 15 unfinished task titles/ }).check();
  await generate.click();
  await expect(panel.getByRole("heading", { name: "Your suggested focus" })).toBeVisible();
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await expect(panel).not.toContainText("Already completed");
  expect(api.tasks).toHaveLength(3);
  expect(api.tasks.find(task => task.id === 13).completed).toBe(true);
  const calls = api.calls.filter(call => call.pathname === "/api/ai/daily-focus");
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({ consent: true });
  expect(api.calls.filter(call => ["POST", "PUT", "PATCH", "DELETE"].includes(call.method) &&
    call.pathname.startsWith("/api/tasks"))).toHaveLength(0);
  await panel.getByRole("button", { name: /Finish API tests/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Daily Planner handles no unfinished tasks and reset without writing", async ({ page }) => {
  const api = await installMockApi(page, {
    aiPlannerEnabled: true,
    initialTasks: [{ ...fixtureTask(5, "Finished", "2026-11-27"), completed: true }]
  });
  await signIn(page);
  const panel = page.getByRole("region", { name: "AI daily planner" });
  await panel.getByRole("button", { name: /Plan my day/ }).click();
  await expect(panel.getByRole("button", { name: "Suggest today's priorities" })).toBeDisabled();
  expect(api.calls.filter(call => call.pathname === "/api/ai/daily-focus")).toHaveLength(0);
  expect(api.tasks).toHaveLength(1);
});

test("AI daily priorities remain absent from the zero-signup demo and fit mobile", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("region", { name: "AI daily planner" })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await installMockApi(page, { aiPlannerEnabled: true, initialTasks: [fixtureTask(20, "Mobile planning task", "2026-11-28")] });
  await signIn(page);
  const panel = page.getByRole("region", { name: "AI daily planner" });
  await panel.getByRole("button", { name: /Plan my day/ }).click();
  await panel.getByRole("checkbox", { name: /I agree to send up to 15 unfinished task titles/ }).check();
  await panel.getByRole("button", { name: "Suggest today's priorities" }).click();
  await expect(panel.getByRole("button", { name: /Mobile planning task/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
