import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

test("TaskFlow AI starts as one compact hub and selecting a tool never generates automatically", async ({ page }) => {
  const api = await installMockApi(page, {
    aiPlannerEnabled: true,
    initialTasks: [fixtureTask(12, "Prepare portfolio", "2026-11-28")]
  });
  await signIn(page);
  const hub = page.getByRole("region", { name: "TaskFlow AI" });
  const choices = hub.getByRole("navigation", { name: "AI tools" });
  await expect(choices.getByRole("button")).toHaveCount(3);
  await expect(choices.getByRole("button", { name: /Break down a goal/ })).toHaveAttribute("aria-pressed", "false");
  await expect(choices.getByRole("button", { name: /Plan my day/ })).toHaveAttribute("aria-pressed", "false");
  await expect(choices.getByRole("button", { name: /Smart schedule/ })).toHaveAttribute("aria-pressed", "false");
  await expect(hub.getByRole("textbox", { name: "What's your goal?" })).toHaveCount(0);
  const forbidden = () => api.calls.filter(c =>
    c.pathname === "/api/ai/plans/generate" ||
    c.pathname === "/api/ai/daily-focus" ||
    c.pathname === "/api/ai/smart-schedule" ||
    c.pathname === "/api/ai/plans/commit");
  expect(forbidden()).toHaveLength(0);

  await choices.getByRole("button", { name: /Plan my day/ }).click();
  await expect(hub.getByRole("region", { name: "AI daily planner" })).toBeVisible();
  await expect(hub.getByRole("region", { name: "AI smart scheduling" })).toHaveCount(0);
  await choices.getByRole("button", { name: /Smart schedule/ }).click();
  await expect(hub.getByRole("region", { name: "AI smart scheduling" })).toBeVisible();
  await choices.getByRole("button", { name: /Break down a goal/ }).click();
  await expect(hub.getByRole("textbox", { name: "What's your goal?" })).toBeVisible();
  expect(forbidden()).toHaveLength(0);
  await hub.getByRole("button", { name: "Close", exact: true }).click();
  await expect(hub.getByRole("textbox", { name: "What's your goal?" })).toHaveCount(0);
  expect(forbidden()).toHaveLength(0);
});

test("Switching AI tools preserves goal drafts, consents and editable scheduling previews", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-27T12:00:00Z") });
  const api = await installMockApi(page, {
    aiPlannerEnabled: true,
    initialTasks: [fixtureTask(21, "Ship my portfolio", "2026-11-30")]
  });
  await signIn(page);
  const hub = page.getByRole("region", { name: "TaskFlow AI" });
  const tools = hub.getByRole("navigation", { name: "AI tools" });

  await tools.getByRole("button", { name: /Break down a goal/ }).click();
  const breakdown = hub.getByRole("region", { name: "AI task breakdown" });
  await breakdown.getByRole("textbox", { name: "What's your goal?" })
    .fill("Prepare a technical portfolio for employers");
  await breakdown.getByRole("checkbox", { name: /Send only the goal I typed to OpenAI/ }).check();
  await tools.getByRole("button", { name: /Smart schedule/ }).click();
  const scheduler = hub.getByRole("region", { name: "AI smart scheduling" });
  await scheduler.getByRole("checkbox", { name: /Send up to 15 unfinished task titles/ }).check();
  await scheduler.getByRole("button", { name: "Preview schedule" }).click();
  const schedule = scheduler.getByLabel("Suggested work dates");
  await expect(schedule.locator(".ai-smart-slot")).toHaveCount(1);
  await schedule.getByLabel("Work date for Ship my portfolio").fill("2026-11-29");

  await tools.getByRole("button", { name: /Plan my day/ }).click();
  const daily = hub.getByRole("region", { name: "AI daily planner" });
  await expect(daily.getByRole("button", { name: "Suggest today's priorities" })).toBeDisabled();
  await tools.getByRole("button", { name: /Smart schedule/ }).click();
  await expect(scheduler.getByLabel("Work date for Ship my portfolio")).toHaveValue("2026-11-29");
  await tools.getByRole("button", { name: /Break down a goal/ }).click();
  await expect(breakdown.getByRole("textbox", { name: "What's your goal?" }))
    .toHaveValue("Prepare a technical portfolio for employers");
  await expect(breakdown.getByRole("checkbox", { name: /Send only the goal I typed to OpenAI/ })).toBeChecked();
  expect(api.calls.filter(c => c.pathname === "/api/ai/smart-schedule")).toHaveLength(1);
  expect(api.calls.filter(c => c.pathname === "/api/ai/plans/generate" ||
    c.pathname === "/api/ai/daily-focus")).toHaveLength(0);
  expect(api.calls.filter(c => c.method !== "GET" && c.pathname.startsWith("/api/tasks"))).toHaveLength(0);
});

test("AI hub remains usable at 320px and is absent from the demo", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("region", { name: "TaskFlow AI" })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await installMockApi(page, { aiPlannerEnabled: true, initialTasks: [
    fixtureTask(13, "Small-screen planning", "2026-11-29")
  ] });
  await signIn(page);
  const hub = page.getByRole("region", { name: "TaskFlow AI" });
  const choices = hub.getByRole("navigation", { name: "AI tools" });
  await expect(choices.getByRole("button")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await choices.getByRole("button", { name: /Smart schedule/ }).click();
  await expect(hub.getByRole("region", { name: "AI smart scheduling" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await choices.getByRole("button", { name: /Plan my day/ }).click();
  await expect(hub.getByRole("region", { name: "AI daily planner" })).toBeVisible();
});
