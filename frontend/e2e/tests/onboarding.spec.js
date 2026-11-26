import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

test("tour is optional, keyboard accessible, and never changes tasks", async ({ page }) => {
  const api = await installMockApi(page, { initialTasks: [fixtureTask(871, "Keep existing data")] });
  await signIn(page);
  await expect(page.getByRole("dialog", { name: /Add your first task/ })).toHaveCount(0);
  const open = page.getByRole("button", { name: "Open quick tour" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Add your first task" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Mark it done" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Find your day" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(api.tasks).toHaveLength(1);
  expect(api.tasks[0].title).toBe("Keep existing data");
  expect(api.calls.filter(call => ["POST", "PUT", "PATCH", "DELETE"].includes(call.method) && call.pathname.startsWith("/api/tasks"))).toHaveLength(0);
});

test("tour works at 320px and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMockApi(page);
  await signIn(page);
  await page.getByRole("button", { name: "Open quick tour" }).click();
  const dialog = page.getByRole("dialog", { name: "Add your first task" });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(dialog.locator(".quick-tour-illustration")).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
