import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

test("Focus Mode is an accessible, local-only timer with pause, reset and safe dismissal", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-27T15:00:00Z") });
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(5, "Finish portfolio checklist", "2026-12-01")]
  });
  await signIn(page);
  const panel = page.getByRole("region", { name: "Task management" });
  const launch = panel.getByRole("button", { name: "Focus on Finish portfolio checklist" });
  await launch.focus();
  await launch.click();
  const focus = page.getByRole("dialog", { name: "Finish portfolio checklist" });
  await expect(focus).toBeVisible();
  await expect(focus.getByRole("timer", { name: "Time remaining" })).toHaveText("25:00");
  await expect(focus.getByRole("heading", { name: "Finish portfolio checklist" })).toBeFocused();
  await focus.getByRole("button", { name: "15 min" }).click();
  await expect(focus.getByRole("timer")).toHaveText("15:00");
  await focus.getByRole("button", { name: "Start focus" }).click();
  await page.clock.fastForward(61000);
  await expect(focus.getByRole("timer")).toHaveText("13:59");
  await focus.getByRole("button", { name: "Pause" }).click();
  await page.clock.fastForward(15000);
  await expect(focus.getByRole("timer")).toHaveText("13:59");
  await focus.getByRole("button", { name: "Reset" }).click();
  await expect(focus.getByRole("timer")).toHaveText("15:00");
  await page.keyboard.press("Escape");
  await expect(focus).toHaveCount(0);
  await expect(launch).toBeFocused();
  expect(api.calls.filter(c => c.method !== "GET" && c.pathname.startsWith("/api/tasks"))).toHaveLength(0);
  expect(api.tasks[0].completed).toBe(false);
});

test("Focus Mode marks complete through existing API and confirms success only after save", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(12, "Review launch plan", "2026-12-01")]
  });
  await signIn(page);
  await page.getByRole("button", { name: "Focus on Review launch plan" }).click();
  const focus = page.getByRole("dialog", { name: "Review launch plan" });
  await focus.getByRole("button", { name: "Mark task complete" }).click();
  await expect(focus.getByRole("status")).toContainText("Task complete. Nice work!");
  await expect(focus.getByRole("button", { name: "Completed" })).toBeDisabled();
  expect(api.tasks.find(task => task.id === 12).completed).toBe(true);
  expect(api.calls.filter(c => c.method === "PUT" && c.pathname === "/api/tasks/12")).toHaveLength(1);
  await focus.getByRole("button", { name: "Close focus mode" }).click();
  await expect(page.getByRole("button", { name: "Mark incomplete: Review launch plan" })).toBeVisible();
});

test("failed completion rolls back and keeps Focus Mode available", async ({ page }) => {
  const api = await installMockApi(page, {
    initialTasks: [fixtureTask(17, "Protected task", "2026-12-01")],
    failTaskToggles: 1
  });
  await signIn(page);
  await page.getByRole("button", { name: "Focus on Protected task" }).click();
  const focus = page.getByRole("dialog", { name: "Protected task" });
  await focus.getByRole("button", { name: "Mark task complete" }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn't update task");
  await expect(focus.getByRole("button", { name: "Mark task complete" })).toBeEnabled();
  await expect(focus.getByText("Task complete. Nice work!")).toHaveCount(0);
  expect(api.tasks[0].completed).toBe(false);
});

test("Focus Mode fits 320px screens, displays checklist and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const task = {
    ...fixtureTask(22, "Practice writing JavaScript", "2026-12-01"),
    checklist: [{ id: "s1", text: "Review arrays", completed: true },
      { id: "s2", text: "Solve a practice problem", completed: false }]
  };
  const api = await installMockApi(page, { initialTasks: [task] });
  await signIn(page);
  await page.getByRole("button", { name: "Focus on Practice writing JavaScript" }).click();
  const focus = page.getByRole("dialog", { name: "Practice writing JavaScript" });
  await expect(focus.getByRole("region", { name: "Task checklist" })).toContainText("1/2 completed");
  await expect(focus).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await focus.getByRole("button", { name: "Open task details" }).click();
  await expect(page.locator("dialog.focus-dialog")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Practice writing JavaScript" })).toBeVisible();
  expect(api.tasks[0].checklist).toHaveLength(2);
});
