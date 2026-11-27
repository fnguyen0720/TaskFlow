import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

test("AI suggestions remain read-only until an explicit reviewed selection is confirmed", async ({ page }) => {
  const api = await installMockApi(page, { aiPlannerEnabled: true, initialProjects: [{ id: 9, name: "Portfolio" }] });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI task breakdown" });
  await page.getByRole("navigation", { name: "AI tools" }).getByRole("button", { name: /Break down a goal/ }).click();
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
  await expect(planner.getByRole("button", { name: "View created tasks" })).toBeVisible();
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
  await page.getByRole("navigation", { name: "AI tools" }).getByRole("button", { name: /Break down a goal/ }).click();
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
  await page.getByRole("navigation", { name: "AI tools" }).getByRole("button", { name: /Break down a goal/ }).click();
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
  await expect(page.getByRole("navigation", { name: "AI tools" }).getByRole("button", { name: /Break down a goal/ })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("navigation", { name: "AI tools" }).getByRole("button", { name: /Break down a goal/ }).click();
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
  await page.getByRole("navigation", { name: "AI tools" }).getByRole("button", { name: /Break down a goal/ }).click();
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


test("View created tasks focuses only the new AI batch, then Show all tasks restores existing work", async ({ page }) => {
  const oldTask = fixtureTask(42, "Existing work must remain visible later", "2026-12-05");
  const api = await installMockApi(page, { aiPlannerEnabled: true, initialTasks: [oldTask] });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI task breakdown" });
  const taskPanel = page.getByRole("region", { name: "Task management" });

  // Simulate an unrelated current view, search and filter that would hide new
  // unscheduled AI tasks unless View created tasks clears the view state.
  await page.getByRole("navigation", { name: "Task views" }).getByRole("button", { name: /Today/ }).click();
  await page.getByRole("navigation", { name: "AI tools" }).getByRole("button", { name: /Break down a goal/ }).click();
  await planner.getByRole("textbox", { name: "What's your goal?" })
    .fill("Create a complete programming portfolio");
  await planner.getByRole("checkbox", { name: /Send only the goal I typed to OpenAI/ }).check();
  await planner.getByRole("button", { name: "Generate plan" }).click();
  const review = planner.getByLabel("Review AI task suggestions");
  await expect(review.locator(".ai-plan-item")).toHaveCount(3);
  page.once("dialog", dialog => dialog.accept());
  await review.getByRole("button", { name: "Create 3 selected tasks" }).click();
  await expect(planner.getByRole("heading", { name: "Plan created!" })).toBeVisible();

  await planner.getByRole("button", { name: "View created tasks" }).click();
  await expect(taskPanel.getByRole("heading", { name: "Newly created tasks" })).toBeVisible();
  await expect(taskPanel.getByRole("heading", { name: "Newly created tasks" })).toBeFocused();
  const list = taskPanel.getByRole("list", { name: "Tasks" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list).toContainText("Design the interface");
  await expect(list).not.toContainText(oldTask.title);
  await expect(taskPanel.getByRole("button", { name: "Show all tasks" })).toBeVisible();
  expect(api.tasks).toHaveLength(4);
  expect(api.tasks.find(task => task.id === 42).title).toBe(oldTask.title);
  expect(api.calls.filter(call => call.pathname === "/api/ai/plans/commit")).toHaveLength(1);

  await taskPanel.getByRole("button", { name: "Show all tasks" }).click();
  await expect(taskPanel.getByRole("heading", { name: "All tasks" })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(list).toContainText(oldTask.title);
  await expect(taskPanel.getByRole("button", { name: "Show all tasks" })).toHaveCount(0);
});

test("newly created task focus is responsive and switching tabs clears the temporary scope", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const api = await installMockApi(page, {
    aiPlannerEnabled: true, initialTasks: [fixtureTask(101, "Earlier task", "2026-12-01")]
  });
  await signIn(page);
  const planner = page.getByRole("region", { name: "AI task breakdown" });
  await page.getByRole("navigation", { name: "AI tools" }).getByRole("button", { name: /Break down a goal/ }).click();
  await planner.getByRole("textbox", { name: "What's your goal?" })
    .fill("Build a helpful portfolio website");
  await planner.getByRole("checkbox", { name: /Send only the goal I typed to OpenAI/ }).check();
  await planner.getByRole("button", { name: "Generate plan" }).click();
  page.once("dialog", dialog => dialog.accept());
  await planner.getByRole("button", { name: "Create 3 selected tasks" }).click();
  const actions = planner.locator(".ai-plan-finished-actions");
  await expect(actions.getByRole("button", { name: "View created tasks" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Plan another goal" })).toBeVisible();
  const firstBox = await actions.getByRole("button", { name: "View created tasks" }).boundingBox();
  const secondBox = await actions.getByRole("button", { name: "Plan another goal" }).boundingBox();
  expect(secondBox.y).toBeGreaterThan(firstBox.y + firstBox.height - 1);

  await actions.getByRole("button", { name: "View created tasks" }).click();
  const taskPanel = page.getByRole("region", { name: "Task management" });
  await expect(taskPanel.getByRole("heading", { name: "Newly created tasks" })).toBeFocused();
  await expect(taskPanel.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.getByRole("navigation", { name: "Mobile quick navigation" })
    .getByRole("button", { name: /Upcoming/ }).click();
  await expect(taskPanel.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await expect(taskPanel.getByRole("button", { name: "Show all tasks" })).toHaveCount(0);
  expect(api.calls.filter(call => call.pathname === "/api/ai/plans/commit")).toHaveLength(1);
});
