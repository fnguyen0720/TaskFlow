import { test, expect } from "@playwright/test";
import { installMockApi, signIn } from "./support/mockApi.js";

test("AI suggestions remain read-only until an explicit reviewed selection is confirmed", async ({ page }) => {
  const api = await installMockApi(page, { aiPlannerEnabled: true, initialProjects: [{ id: 9, name: "Portfolio" }] });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI task breakdown" });
  await planner.getByRole("button", { name: /AI task breakdown/ }).click();
  const goal = planner.getByRole("textbox", { name: "What's your goal?" });
  await expect(planner.getByRole("button", { name: "Generate plan" })).toBeDisabled();
  await expect(planner.getByLabel("AI plan steps")).toContainText("Goal");
  await goal.fill("Build an impressive portfolio website");
  await expect(planner.getByRole("button", { name: "Generate plan" })).toBeDisabled();
  await planner.getByRole("checkbox", {
    name: /Send only the goal I typed to OpenAI/
  }).check();
  await planner.getByRole("button", { name: "Generate plan" }).click();
  const review = planner.getByLabel("Review AI task suggestions");
  await expect(review.locator(".ai-plan-item")).toHaveCount(3);
  await expect(planner.getByRole("textbox", { name: "What's your goal?" })).toHaveCount(0);
  await expect(planner.getByLabel("AI plan steps").locator(".current")).toContainText("Review");
  expect(api.tasks).toHaveLength(0);
  expect(api.calls.filter(call => call.pathname === "/api/ai/plans/commit")).toHaveLength(0);
  const first = review.locator(".ai-plan-item").first();
  await first.getByRole("textbox", { name: "Task title" }).fill("Design the mobile interface");
  await review.locator(".ai-plan-item").nth(1).getByRole("checkbox", { name: "Include task 2" }).uncheck();
  await review.getByRole("combobox", { name: "Save into project (optional)" }).selectOption("9");
  await expect(review.getByRole("button", { name: "Create 2 selected tasks" })).toBeEnabled();
  page.once("dialog", dialog => dialog.accept());
  await review.getByRole("button", { name: "Create 2 selected tasks" }).click();
  await expect(planner.getByRole("status")).toContainText("2 tasks created.");
  await expect(planner.getByLabel("AI plan steps").locator(".current")).toContainText("Created");
  await expect(planner.getByRole("button", { name: "Plan another goal" })).toBeVisible();
  expect(api.tasks).toHaveLength(2);
  expect(api.tasks.map(t => t.title)).toEqual(["Design the mobile interface", "Test and deploy"]);
  expect(api.tasks.every(t => t.projectId === 9)).toBe(true);
  expect(api.calls.filter(call => call.pathname === "/api/ai/plans/commit")).toHaveLength(1);
  expect(api.calls.find(call => call.pathname === "/api/ai/plans/generate").body)
    .toEqual({ goal: "Build an impressive portfolio website", consent: true });
  expect(api.calls.find(call => call.pathname === "/api/ai/plans/commit").body.tasks).toHaveLength(2);
});

test("AI planning is disabled gracefully and no goal is sent without consent", async ({ page }) => {
  const api = await installMockApi(page, { aiPlannerEnabled: false });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI task breakdown" });
  await planner.getByRole("button", { name: /AI task breakdown/ }).click();
  await expect(planner).toContainText("AI planning is not configured for this workspace.");
  expect(api.calls.filter(call => call.pathname === "/api/ai/plans/generate")).toHaveLength(0);
  expect(api.tasks).toHaveLength(0);
});

test("AI task planner is absent in the zero-signup demo and works on narrow screens", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("region", { name: "AI task breakdown" })).toHaveCount(0);
  await installMockApi(page, { aiPlannerEnabled: true });
  await page.setViewportSize({ width: 320, height: 700 });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI task breakdown" });
  await planner.getByRole("button", { name: /AI task breakdown/ }).click();
  await planner.getByRole("textbox", { name: "What's your goal?" })
    .fill("Finish my personal portfolio website");
  await planner.getByRole("checkbox", { name: /Send only the goal I typed to OpenAI/ }).check();
  await planner.getByRole("button", { name: "Generate plan" }).click();
  await expect(planner.locator(".ai-plan-item")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});


test("planner keeps a small first step, requires consent after example changes, and lets users review without saving", async ({ page }) => {
  const api = await installMockApi(page, { aiPlannerEnabled: true });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI task breakdown" });
  await expect(planner.getByRole("button", { name: /AI task breakdown/ })).toHaveAttribute("aria-expanded", "false");
  await planner.getByRole("button", { name: /AI task breakdown/ }).click();
  const goal = planner.getByRole("textbox", { name: "What's your goal?" });
  await planner.getByRole("button", { name: "Portfolio website" }).click();
  await expect(goal).toHaveValue("Launch a personal portfolio website");
  const generate = planner.getByRole("button", { name: "Generate plan" });
  await expect(generate).toBeDisabled();
  await planner.getByRole("checkbox", { name: /Send only the goal I typed to OpenAI/ }).check();
  await generate.click();
  const review = planner.getByLabel("Review AI task suggestions");
  await expect(review.locator(".ai-plan-item")).toHaveCount(3);
  await review.getByRole("button", { name: "Clear selection" }).click();
  await expect(review.getByRole("button", { name: "Create 0 selected tasks" })).toBeDisabled();
  await review.getByRole("button", { name: "Select all" }).click();
  await expect(review.getByRole("button", { name: "Create 3 selected tasks" })).toBeEnabled();
  page.once("dialog", dialog => dialog.dismiss());
  await review.getByRole("button", { name: "Edit goal" }).click();
  await expect(review).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await review.getByRole("button", { name: "Edit goal" }).click();
  await expect(goal).toHaveValue("Launch a personal portfolio website");
  await expect(generate).toBeDisabled();
  expect(api.calls.filter(call => call.pathname === "/api/ai/plans/commit")).toHaveLength(0);
  expect(api.tasks).toHaveLength(0);
});

test("declined confirmation never creates tasks, and saved selection has an explicit next step", async ({ page }) => {
  const api = await installMockApi(page, { aiPlannerEnabled: true });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI task breakdown" });
  await planner.getByRole("button", { name: /AI task breakdown/ }).click();
  await planner.getByRole("textbox", { name: "What's your goal?" })
    .fill("Prepare for a challenging technical interview");
  await planner.getByRole("checkbox", { name: /Send only the goal I typed to OpenAI/ }).check();
  await planner.getByRole("button", { name: "Generate plan" }).click();
  const review = planner.getByLabel("Review AI task suggestions");
  await expect(review.locator(".ai-plan-item")).toHaveCount(3);
  page.once("dialog", dialog => dialog.dismiss());
  await review.getByRole("button", { name: "Create 3 selected tasks" }).click();
  expect(api.tasks).toHaveLength(0);
  page.once("dialog", dialog => dialog.accept());
  await review.getByRole("button", { name: "Create 3 selected tasks" }).click();
  await expect(planner.getByRole("heading", { name: "Plan created!" })).toBeVisible();
  await planner.getByRole("button", { name: "Plan another goal" }).click();
  await expect(planner.getByRole("textbox", { name: "What's your goal?" })).toHaveValue("");
  await expect(planner.getByRole("button", { name: "Generate plan" })).toBeDisabled();
  expect(api.calls.filter(call => call.pathname === "/api/ai/plans/commit")).toHaveLength(1);
  expect(api.tasks).toHaveLength(3);
});
