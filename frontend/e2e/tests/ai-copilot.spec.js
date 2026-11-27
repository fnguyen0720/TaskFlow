import { test, expect } from "@playwright/test";
import { fixtureTask, installMockApi, signIn } from "./support/mockApi.js";

test("Copilot requires consent, supports follow-ups and does not mutate tasks", async ({ page }) => {
  const api = await installMockApi(page, { aiPlannerEnabled: true, initialTasks: [fixtureTask(8, "Study AWS", "2026-12-01")] });
  const requests = [];
  await page.route("**/api/ai/copilot", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { reply: "Start with Study AWS." } });
  });
  await signIn(page);
  await page.getByRole("button", { name: /Ask Copilot/ }).click();
  const chat = page.getByRole("region", { name: "AI Productivity Copilot" });
  await chat.getByRole("button", { name: "What should I work on next?" }).click();
  await expect(chat.getByRole("button", { name: "Send question" })).toBeDisabled();
  expect(requests).toHaveLength(0);
  await chat.getByRole("checkbox").check();
  await chat.getByRole("button", { name: "Send question" }).click();
  await expect(chat.getByRole("log")).toContainText("Start with Study AWS.");
  await chat.getByRole("textbox", { name: "Ask a question" }).fill("Why?");
  await chat.getByRole("button", { name: "Send question" }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(chat.getByRole("log")).toContainText("Why?");
  expect(requests[1].messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
  expect(requests[1].consent).toBe(true);
  expect(api.calls.filter(c => c.method !== "GET" && c.pathname.startsWith("/api/tasks"))).toHaveLength(0);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await chat.getByRole("button", { name: "Clear chat" }).click();
  await expect(chat.getByRole("log")).not.toContainText("Study AWS");
  await expect(chat.getByRole("checkbox")).not.toBeChecked();
});
