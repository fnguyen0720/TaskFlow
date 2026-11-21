// An isolated in-browser HTTP stand-in for the TaskFlow API.
// No tests below send requests to production Render or create real users.
export async function installMockApi(page, { initialTasks = [], failTaskReads = 0, failTaskEdits = 0, failTaskCreates = 0, failTaskDetails = 0, invalidTaskReads = 0, emptyTaskReads = 0, unauthorizedTaskReads = 0, failLoginAttempts = 0, accountEmail = "tester@example.com", failAccountReads = 0 } = {}) {
  let remainingFailedReads = failTaskReads;
  let remainingUnauthorizedReads = unauthorizedTaskReads;
  let remainingFailedLogins = failLoginAttempts;
  let remainingFailedAccountReads = failAccountReads;
  let remainingInvalidReads = invalidTaskReads;
  let remainingEmptyReads = emptyTaskReads;
  let remainingFailedEdits = failTaskEdits;
  let remainingFailedCreates = failTaskCreates;
  let remainingFailedDetails = failTaskDetails;
  const tasks = structuredClone(initialTasks);
  let revision = 1;
  for (const task of tasks) task.version ??= `rev-${revision++}`;
  const changeVersion = task => { task.version = `rev-${revision++}`; };
  let nextId = Math.max(0, ...tasks.map(task => Number(task.id) || 0)) + 1;
  const calls = [];

  await page.route("**/mock-api/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace("/mock-api", "");
    const method = request.method();
    const body = ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
    calls.push({ method, pathname, search: new URL(request.url()).search, body });

    const respond = async (status, data) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });

    if (pathname === "/register" && method === "POST") return respond(200, {});
    if (pathname === "/login" && method === "POST") {
      if (remainingFailedLogins > 0) { remainingFailedLogins--; return respond(503, { title: "Unavailable" }); }
      if (body.email !== "tester@example.com" || body.password !== "ValidPassword123!") {
        return respond(401, { title: "Unauthorized", status: 401 });
      }
      return respond(200, { accessToken: "e2e-isolated-token", tokenType: "Bearer", expiresIn: 3600 });
    }

    if (pathname === "/api/account/me" && method === "GET") {
      if (request.headers().authorization !== "Bearer e2e-isolated-token") return respond(401, {});
      if (remainingFailedAccountReads > 0) { remainingFailedAccountReads--; return respond(503, { title: "Unavailable" }); }
      return respond(200, { email: accountEmail });
    }

    if (pathname === "/api/tasks" && method === "GET") {
      if (request.headers().authorization !== "Bearer e2e-isolated-token") return respond(401, {});
      if (remainingUnauthorizedReads > 0) { remainingUnauthorizedReads--; return respond(401, {}); }
      if (remainingFailedReads > 0) {
        remainingFailedReads--;
        return respond(503, { title: "Service temporarily unavailable" });
      }
      if (remainingInvalidReads > 0) { remainingInvalidReads--; return respond(200, { tasks: [] }); }
      if (remainingEmptyReads > 0) { remainingEmptyReads--; return respond(200, []); }
      const query = new URL(request.url()).searchParams;
      const offset = Number(query.get("offset") ?? 0);
      const limit = Number(query.get("limit") ?? tasks.length);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) return respond(400, {});
      return respond(200, tasks.slice(offset, offset + limit));
    }
    if (pathname === "/api/tasks" && method === "POST") {
      if (remainingFailedCreates > 0) {
        remainingFailedCreates--;
        return respond(503, { title: "Temporarily unavailable" });
      }
      const task = {
        id: nextId++, title: body.title, priority: body.priority,
        category: body.category, dueDate: body.dueDate, completed: false,
        notes: "", checklist: [], checklistJson: "[]",
        version: `rev-${revision++}`,
      };
      tasks.push(task);
      return respond(201, task);
    }

    const edit = /^\/api\/tasks\/(\d+)\/title$/.exec(pathname);
    if (edit && method === "PUT") {
      const task = tasks.find(item => item.id === Number(edit[1]));
      if (!task) return respond(404, {});
      if (remainingFailedEdits > 0) {
        remainingFailedEdits--;
        return respond(503, { title: "Temporarily unavailable" });
      }
      if (request.headers()["if-match"] && request.headers()["if-match"] !== `"${task.version}"`) return respond(409, { title: "Conflict" });
      Object.assign(task, {
        title: body.title, priority: body.priority, category: body.category,
        dueDate: body.dueDate ? body.dueDate + "T00:00:00Z" : null,
        recurrenceRule: body.recurrenceRule, reminderDaysBefore: body.reminderDaysBefore,
      });
      changeVersion(task);
      return respond(200, task);
    }

    const details = /^\/api\/tasks\/(\d+)\/details$/.exec(pathname);
    if (details && method === "PUT") {
      const task = tasks.find(item => item.id === Number(details[1]));
      if (!task) return respond(404, {});
      if (remainingFailedDetails > 0) {
        remainingFailedDetails--;
        return respond(503, { title: "Temporarily unavailable" });
      }
      if (request.headers()["if-match"] && request.headers()["if-match"] !== `"${task.version}"`) return respond(409, { title: "Conflict" });
      task.notes = body.notes;
      task.checklist = body.checklist;
      if (body.updateDueDate) task.dueDate = body.dueDate ? body.dueDate + "T00:00:00Z" : null;
      changeVersion(task);
      return respond(200, task);
    }

    const dueDate = /^\/api\/tasks\/(\d+)\/due-date$/.exec(pathname);
    if (dueDate && method === "PATCH") {
      const task = tasks.find(item => item.id === Number(dueDate[1]));
      if (!task) return respond(404, {});
      if (task.dueDate?.slice(0, 10) !== body.expectedDueDate) return respond(409, {});
      task.dueDate = body.dueDate ? body.dueDate + "T00:00:00Z" : null;
      changeVersion(task);
      return respond(200, { dueDate: task.dueDate });
    }

    return respond(404, { title: "Unexpected mock API request", method, pathname });
  });

  return { tasks, calls, changeVersion };
}

export async function signIn(page) {
  await page.goto("/");
  await page.getByPlaceholder("Email address").fill("tester@example.com");
  await page.getByPlaceholder("Password").fill("ValidPassword123!");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.getByRole("navigation", { name: "Task views" }).waitFor();
}

export function fixtureTask(id, title, dueDate) {
  return {
    id, title, dueDate: dueDate + "T00:00:00Z",
    completed: false, priority: "Medium", category: "General",
    notes: "", checklist: [], checklistJson: "[]",
  };
}
