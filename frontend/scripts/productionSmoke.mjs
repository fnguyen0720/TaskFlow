import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const SITE = process.env.SITE_URL || "https://task-flow-pi-lake.vercel.app";
const API = process.env.API_URL || "https://taskflow-k63f.onrender.com";
const key = randomBytes(6).toString("hex");
const email = "taskflow.smoketest." + key + "@example.com";
const password = "Smoke-Prod-" + randomBytes(10).toString("hex") + "!Aa7";
const title = "SMOKE-" + key + "-task";
const editedTitle = "SMOKE-" + key + "-edited";
const dueDate = new Date(Date.now() + 12 * 86400000).toISOString().slice(0,10);
let browser;
let context;
let page;
let token = "";
let firstError = null;

const logPass = label => console.log("PASS: " + label);
const waitForDashboard = async () => {
  await page.getByRole("heading", {name:"Your tasks"}).waitFor({timeout:100000});
  await page.locator(".task-list").waitFor({timeout:100000});
};
const rowByTitle = name => page.getByRole("listitem").filter({hasText:name});
const refreshDashboard = async () => {
  await page.reload({waitUntil:"domcontentloaded"});
  await waitForDashboard();
};

try {
  browser = await chromium.launch({headless:true, args:["--no-sandbox"]});
  context = await browser.newContext({viewport:{width:375,height:820}, colorScheme:"dark"});
  page = await context.newPage();
  page.setDefaultTimeout(100000);
  page.on("pageerror", error => console.error("PAGE_ERROR:",error.message));

  const response = await page.goto(SITE,{waitUntil:"domcontentloaded",timeout:100000});
  assert.ok(response?.ok(),"Production website responded unsuccessfully");
  await page.getByRole("heading",{name:"TaskFlow"}).waitFor();
  logPass("Production site loads");

  await page.getByRole("button",{name:/Need an account\? Register/}).click();
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button",{name:"Create Account"}).click();
  await page.getByText("Account created! Please sign in.").waitFor({timeout:100000});
  logPass("Dedicated account registration");

  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button",{name:"Sign In"}).click();
  await waitForDashboard();
  token = await page.evaluate(() => localStorage.getItem("taskflow_token") || "");
  assert.ok(token,"Expected token after login");
  logPass("Login and authenticated task list");

  await page.getByRole("textbox",{name:"New task title"}).fill(title);
  await page.getByRole("combobox",{name:"Priority",exact:true}).selectOption("High");
  await page.getByRole("combobox",{name:"Category",exact:true}).selectOption("Work");
  await page.getByLabel("Due date",{exact:true}).fill(dueDate);
  await page.getByRole("button",{name:/Add task/}).click();
  await rowByTitle(title).waitFor();
  await page.getByRole("button",{name:"Edit "+title}).waitFor();
  logPass("Task creation with priority, category and due date");

  await page.getByRole("button",{name:"Edit "+title}).click();
  await page.getByRole("textbox",{name:"Edit title for "+title}).fill(editedTitle);
  await page.getByRole("combobox",{name:"Priority for "+title}).selectOption("Low");
  await page.getByRole("combobox",{name:"Category for "+title}).selectOption("Study");
  await page.getByRole("button",{name:"Save changes to "+title}).click();
  const row = rowByTitle(editedTitle);
  await row.waitFor();
  await page.getByRole("button",{name:"Edit "+editedTitle}).waitFor();
  assert.equal((await row.locator(".priority").innerText()).trim(),"Low");
  assert.equal((await row.locator(".category").innerText()).trim(),"Study");
  logPass("Edit task title, priority and category");

  await page.getByRole("button",{name:"Mark complete: "+editedTitle}).click();
  await page.getByRole("button",{name:"Mark incomplete: "+editedTitle}).waitFor();
  await refreshDashboard();
  const persistedRow = rowByTitle(editedTitle);
  await persistedRow.waitFor();
  assert.equal((await persistedRow.locator(".priority").innerText()).trim(),"Low");
  assert.equal((await persistedRow.locator(".category").innerText()).trim(),"Study");
  await page.getByRole("button",{name:"Mark incomplete: "+editedTitle}).waitFor();
  logPass("Completion and edited metadata survive refresh");

  await page.getByRole("button",{name:"Delete "+editedTitle}).click();
  await page.getByRole("button",{name:"Undo deleting "+editedTitle}).waitFor();
  await rowByTitle(editedTitle).waitFor({state:"detached"});
  await page.getByRole("button",{name:"Undo deleting "+editedTitle}).click();
  await rowByTitle(editedTitle).waitFor();
  await refreshDashboard();
  await rowByTitle(editedTitle).waitFor();
  await page.getByRole("button",{name:"Mark incomplete: "+editedTitle}).waitFor();
  logPass("Delete → Undo → refresh preserves task and completion");

  await page.getByRole("button",{name:"Delete "+editedTitle}).click();
  await page.getByRole("button",{name:"Undo deleting "+editedTitle}).waitFor();
  await refreshDashboard();
  await rowByTitle(editedTitle).waitFor();
  logPass("Refresh within 8 seconds cancels pending deletion");

  await page.getByRole("button",{name:"Delete "+editedTitle}).click();
  await page.locator(".undo-delete-item").waitFor();
  await page.locator(".undo-delete-item").waitFor({state:"detached",timeout:100000});
  await refreshDashboard();
  assert.equal(await rowByTitle(editedTitle).count(),0);
  logPass("Expired Undo window permanently removes task after refresh");

  await page.getByRole("button",{name:/Log out/}).click();
  await page.getByRole("button",{name:"Sign In"}).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("taskflow_token")),null);
  logPass("Logout removes token");

  console.log("FINAL RESULT: PASS — production smoke test succeeded");
} catch(error) {
  firstError = error;
  console.error("FINAL RESULT: FAIL —",error?.stack || String(error));
  process.exitCode = 1;
} finally {
  if (!token && page) {
    try { token = await page.evaluate(() => localStorage.getItem("taskflow_token") || ""); }
    catch {}
  }
  if (token) {
    try {
      const response = await fetch(API + "/api/tasks",{
        headers:{Authorization:"Bearer "+token},
        signal:AbortSignal.timeout(30000),
      });
      if (response.ok) {
        const tasks = await response.json();
        const leftovers = tasks.filter(task => typeof task.title === "string" && task.title.startsWith("SMOKE-"+key+"-"));
        let cleaned = 0;
        for(const task of leftovers) {
          const result = await fetch(API + "/api/tasks/" + encodeURIComponent(task.id),{
            method:"DELETE",
            headers:{Authorization:"Bearer "+token},
            signal:AbortSignal.timeout(30000),
          });
          if(result.ok) cleaned++;
        }
        console.log("CLEANUP:",cleaned,"test tasks removed;",leftovers.length-cleaned,"remaining");
      } else {
        console.warn("CLEANUP: test task query failed, status",response.status);
      }
    } catch(error) {
      console.warn("CLEANUP: failed to contact API:",error.message);
    }
  }
  await context?.close();
  await browser?.close();
  if(firstError) console.error("Note: test account was created only for this smoke run.");
}
