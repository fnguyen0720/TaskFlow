import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = process.env.TEST_API_URL || "http://127.0.0.1:5111";
const trustedProduction = "https://task-flow-pi-lake.vercel.app";
const trustedPreview = "https://trusted-preview.vercel.app";
const blockedOrigins = [
  "https://task-flow-attacker.vercel.app",
  "https://task-flow-pi-lake.vercel.app.attacker.test",
  "https://unlisted-preview.vercel.app",
  "http://task-flow-pi-lake.vercel.app",
  "http://localhost:5173",
];
const suffix = randomBytes(6).toString("hex");
const password = "SmokeCase-1!" + randomBytes(9).toString("hex");
const logPass = message => console.log("PASS: " + message);

async function request(method, path, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = "Bearer " + token;
  if (body !== undefined) h["Content-Type"] = "application/json";
  return fetch(base + path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
}

async function json(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function registerAndLogin(tag) {
  const email = tag + "-" + suffix + "@example.test";
  const credentials = { email, password };
  const reg = await request("POST", "/register", {body:credentials});
  assert.ok(reg.ok, "registration failed: " + reg.status);
  const login = await request("POST", "/login?useCookies=false", {body:credentials});
  assert.equal(login.status, 200, "login status");
  const response = await json(login);
  assert.ok(response.accessToken, "login missing access token");
  return response.accessToken;
}

async function preflight(origin) {
  return request("OPTIONS", "/api/tasks", {
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
}

try {
  // Test a real ASP.NET Core server, not WebApplicationFactory.
  const anonymous = await request("GET","/api/tasks");
  assert.equal(anonymous.status, 401);
  logPass("Untrusted requests cannot read tasks");

  for(const origin of [trustedProduction,trustedPreview]) {
    const response = await preflight(origin);
    assert.equal(response.status,204);
    assert.equal(response.headers.get("access-control-allow-origin"),origin);
  }
  logPass("Only exact production and configured preview origins can read API responses");

  for (const origin of blockedOrigins) {
    const response = await preflight(origin);
    assert.equal(response.headers.get("access-control-allow-origin"),null,
      "CORS unexpectedly allowed " + origin);
  }
  logPass("Spoofed Vercel subdomains, HTTP, and unlisted origins rejected");

  const userA = await registerAndLogin("staging-owner");
  const userB = await registerAndLogin("staging-other");
  logPass("Identity registration and login over HTTP");

  const created = await request("POST","/api/tasks", {
    token:userA,
    body:{
      id:987654,
      title:"   Staging security smoke task   ",
      completed:true,
      priority:"Medium",
      category:"Work",
      userId:"another-user",
      dueDate:"2026-12-15T00:00:00Z"
    }
  });
  assert.equal(created.status,201,"task create status");
  const task = await json(created);
  assert.ok(Number.isInteger(task.id) && task.id !== 987654,"forged id persisted");
  assert.equal(task.completed,false);
  assert.equal(task.title,"Staging security smoke task");
  assert.equal(task.category,"Work");
  assert.notEqual(task.userId,"another-user");
  logPass("Task created; forged owner, ID and completion values ignored");

  const viewA = await request("GET","/api/tasks",{token:userA});
  assert.equal(viewA.status,200);
  assert.ok((await json(viewA)).some(t=>t.id===task.id));
  const viewB = await request("GET","/api/tasks",{token:userB});
  assert.equal(viewB.status,200);
  assert.ok(!(await json(viewB)).some(t=>t.id===task.id));
  const forbiddenDelete = await request("DELETE","/api/tasks/"+task.id,{token:userB});
  assert.equal(forbiddenDelete.status,404);
  logPass("Account isolation and ownership enforced");

  for(const category of ["Other","work","", "Personal/../../"]) {
    const bad = await request("POST","/api/tasks", {
      token:userA,body:{title:"Invalid category",priority:"Medium",category}
    });
    assert.equal(bad.status,400,"invalid category not rejected: " + category);
  }
  const badPriority = await request("POST","/api/tasks", {
    token:userA,body:{title:"Bad priority",priority:"Ultra",category:"General"}
  });
  assert.equal(badPriority.status,400);
  const badTitle = await request("POST","/api/tasks",{
    token:userA,body:{title:" ".repeat(5),priority:"Medium",category:"General"}
  });
  assert.equal(badTitle.status,400);
  logPass("Malformed categories, priorities and blank titles rejected");

  const badEdit = await request("PUT","/api/tasks/"+task.id+"/title",{
    token:userA,body:{title:"Tampered task",priority:"High",category:"Invalid"}
  });
  assert.equal(badEdit.status,400);
  const updated = await request("PUT","/api/tasks/"+task.id+"/title",{
    token:userA,body:{title:"  Edited security task  ",priority:"High",category:"Study"}
  });
  assert.equal(updated.status,200);
  const edited = await json(updated);
  assert.equal(edited.title,"Edited security task");
  assert.equal(edited.priority,"High");
  assert.equal(edited.category,"Study");
  const toggled=await request("PUT","/api/tasks/"+task.id,{token:userA});
  assert.equal(toggled.status,200);
  assert.equal((await json(toggled)).completed,true);
  logPass("Valid task edits and completion work; invalid updates do not corrupt stored task");

  const after = await request("GET","/api/tasks",{token:userA});
  const persisted=(await json(after)).find(t=>t.id===task.id);
  assert.equal(persisted.title,"Edited security task");
  assert.equal(persisted.completed,true);
  const deleted=await request("DELETE","/api/tasks/"+task.id,{token:userA});
  assert.equal(deleted.status,204);
  const gone=await request("GET","/api/tasks",{token:userA});
  assert.equal((await json(gone)).some(t=>t.id===task.id),false);
  logPass("CRUD updates persist and deletion removes only the owner's task");

  let throttled=false;
  for(let i=0;i<30;i++){
    const response = await request("POST","/login?useCookies=false",{
      body:{email:"unknown-login-"+suffix+"@example.test",password:"WrongPassword!9"}
    });
    if(response.status===429){
      assert.equal(response.headers.get("retry-after"),"60");
      const body=await response.text();
      assert.match(body,/too many authentication requests/i);
      throttled=true;
      break;
    }
    assert.ok([400,401].includes(response.status),"Unexpected login response: "+response.status);
  }
  assert.ok(throttled,"Identity requests were not throttled");
  const afterThrottle = await request("GET","/api/tasks",{token:userA});
  assert.equal(afterThrottle.status,200,"Identity throttling incorrectly blocked task API");
  logPass("Repeated login attempts receive HTTP 429 with Retry-After; task APIs remain available");

  console.log("FINAL RESULT: PASS — PR #7 running server + disposable database");
} catch(error){
  console.error("FINAL RESULT: FAIL —",error?.stack||error);
  process.exitCode=1;
}
