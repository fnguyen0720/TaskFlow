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
  const activities = [];
  const versions = [];
  let nextVersionId = 1;
  function snapshot(task) {
    return {
      title: task.title, completed: !!task.completed,
      priority: task.priority, dueDate: task.dueDate ?? null,
      category: task.category ?? "General",
      recurrenceRule: task.recurrenceRule ?? "None",
      reminderDaysBefore: task.reminderDaysBefore ?? null,
      notes: task.notes ?? "",
      checklistJson: JSON.stringify((task.checklist ?? []).map(({ text, completed }) => ({ text, completed })))
    };
  }
  function recordVersion(task, kind) {
    versions.push({ id: nextVersionId++, taskId: task.id, kind,
      recordedAt: "2026-11-19T12:00:00Z", fingerprint: task.version,
      snapshot: snapshot(task) });
  }
  function startHistory(task) {
    if (!versions.some(entry => entry.taskId === task.id)) recordVersion(task, "baseline");
  }
  let nextEventId = 1;
  const record = (taskId, kind) => activities.push({ id: nextEventId++, taskId, kind, occurredAt: "2026-11-19T12:00:00Z" });
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
    const versionRoute = /^\\/api\\/tasks\\/(\\d+)\\/versions$/.exec(pathname);
    if (versionRoute && method === "GET") {
      if (request.headers().authorization !== "Bearer e2e-isolated-token") return respond(401, {});
      if (!tasks.some(t => t.id === Number(versionRoute[1]))) return respond(404, {});
      return respond(200, versions.filter(v => v.taskId === Number(versionRoute[1]))
        .sort((a,b) => b.id - a.id).slice(0,50));
    }
    const restoreRoute = /^\\/api\\/tasks\\/(\\d+)\\/restore$/.exec(pathname);
    if (restoreRoute && method === "POST") {
      if (request.headers().authorization !== "Bearer e2e-isolated-token") return respond(401, {});
      const task = tasks.find(t => t.id === Number(restoreRoute[1]));
      if (!task) return respond(404, {});
      const header = request.headers()["if-match"];
      if (!header || !/^"[a-zA-Z0-9-]+"$/.test(header)) return respond(400, {});
      if (header !== `"${task.version}"`) return respond(409, {});
      const selected = versions.find(v => v.id === body.versionId && v.taskId === task.id);
      if (!selected) return respond(404, {});
      startHistory(task);
      const restored = structuredClone(selected.snapshot);
      Object.assign(task, restored, { checklist: JSON.parse(restored.checklistJson) });
      changeVersion(task);
      recordVersion(task, "restored");
      record(task.id, "edited");
      recordVersion(task, "edited");
      return respond(200, task);
    }
    const activity = /^\/api\/tasks\/(\d+)\/activity$/.exec(pathname);
    if (activity && method === "GET") {
      if (request.headers().authorization !== "Bearer e2e-isolated-token") return respond(401, {});
      if (!tasks.some(t => t.id === Number(activity[1]))) return respond(404, {});
      return respond(200, activities.filter(e => e.taskId === Number(activity[1]))
        .sort((a, b) => b.id - a.id).slice(0, 50).map(({ id, kind, occurredAt }) => ({ id, kind, occurredAt })));
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
      record(task.id, "created");
      recordVersion(task, "created");
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
      startHistory(task);
      Object.assign(task, {
        title: body.title, priority: body.priority, category: body.category,
        dueDate: body.dueDate ? body.dueDate + "T00:00:00Z" : null,
        recurrenceRule: body.recurrenceRule, reminderDaysBefore: body.reminderDaysBefore,
      });
      changeVersion(task);
      record(task.id, "edited");
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
      startHistory(task);
      const oldDate = task.dueDate;
      task.notes = body.notes;
      task.checklist = body.checklist;
      if (body.updateDueDate) task.dueDate = body.dueDate ? body.dueDate + "T00:00:00Z" : null;
      changeVersion(task);
      record(task.id, "edited");
      recordVersion(task, "edited");
      if (oldDate !== task.dueDate) record(task.id, "rescheduled");
      return respond(200, task);
    }

    const dueDate = /^\/api\/tasks\/(\d+)\/due-date$/.exec(pathname);
    if (dueDate && method === "PATCH") {
      const task = tasks.find(item => item.id === Number(dueDate[1]));
      if (!task) return respond(404, {});
      if (task.dueDate?.slice(0, 10) !== body.expectedDueDate) return respond(409, {});
      task.dueDate = body.dueDate ? body.dueDate + "T00:00:00Z" : null;
      changeVersion(task);
      record(task.id, "rescheduled");
      return respond(200, { dueDate: task.dueDate });
    }

    return respond(404, { title: "Unexpected mock API request", method, pathname });
  });

  return { tasks, calls, activities, versions, changeVersion };
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
