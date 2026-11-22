using System.Text.Json;

using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<TaskDbContext>(options =>
{
    var provider = builder.Configuration["DatabaseProvider"] ?? "Sqlite";

    var connectionString = provider.Equals(
        "Postgres",
        StringComparison.OrdinalIgnoreCase)
            ? builder.Configuration["DATABASE_URL"]
                ?? builder.Configuration.GetConnectionString("DefaultConnection")
            : builder.Configuration.GetConnectionString("DefaultConnection");

    if (string.IsNullOrWhiteSpace(connectionString))
    {
        throw new InvalidOperationException(
            "Database connection string is not configured.");
    }
    if (provider.Equals("Postgres", StringComparison.OrdinalIgnoreCase))
    {
    if (Uri.TryCreate(connectionString, UriKind.Absolute, out var databaseUri)
        && (databaseUri.Scheme == "postgres"
            || databaseUri.Scheme == "postgresql"))
    {
        var credentials = databaseUri.UserInfo.Split(':', 2);

        if (credentials.Length != 2)
        {
            throw new InvalidOperationException(
                "Invalid PostgreSQL database URL credentials.");
        }

        var npgsqlConnection = new Npgsql.NpgsqlConnectionStringBuilder
        {
            Host = databaseUri.Host,
            Port = databaseUri.Port > 0 ? databaseUri.Port : 5432,
            Database = databaseUri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(credentials[0]),
            Password = Uri.UnescapeDataString(credentials[1]),
            SslMode = Npgsql.SslMode.Require
        };

        options.UseNpgsql(
        npgsqlConnection.ConnectionString,
        npgsqlOptions =>
            npgsqlOptions.MigrationsHistoryTable(
                "__EFMigrationsHistory",
                "public"
            )
        );
    }
    else
    {
        options.UseNpgsql(
            connectionString,
            npgsqlOptions =>
                npgsqlOptions.MigrationsHistoryTable(
                    "__EFMigrationsHistory",
                    "public"
                )
        );
    }
}
    else if (provider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase))
    {
        options.UseSqlite(connectionString);
    }
    else
    {
        throw new InvalidOperationException(
            $"Unsupported database provider: {provider}"
        );
    }
});

builder.Services
    .AddIdentityApiEndpoints<ApplicationUser>()
    .AddEntityFrameworkStores<TaskDbContext>();

// Email delivery is fail-closed: incomplete configuration stops startup.
// The default installation sends no mail. Existing accounts may continue
// signing in until verified-address enforcement is separately rolled out.
builder.Services.AddSingleton<AccountEmailDelivery>();
builder.Services.AddHttpClient<TaskFlowIdentityEmailSender>();
builder.Services.AddTransient<Microsoft.AspNetCore.Identity.IEmailSender<ApplicationUser>>(
    sp => sp.GetRequiredService<TaskFlowIdentityEmailSender>());
builder.Services.Configure<Microsoft.AspNetCore.Identity.DataProtectionTokenProviderOptions>(
    options => options.TokenLifespan = TimeSpan.FromHours(2));

builder.Services.AddAuthorization();
builder.Services.AddOpenApi();

// Only exact, explicitly trusted browser origins may read API responses.
// Cors__AllowedOrigins__N and FrontendUrl can be configured on Render.
// Preview deployments require an explicit allowlist entry; wildcard Vercel
// subdomains are not trustworthy enough for a credential-bearing API.
builder.Services.AddCors(options =>
{
    // Resolve settings when the policy is built, so environment-specific and
    // test-host configuration providers are included in the final allowlist.
    var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins")
        .GetChildren()
        .Select(item => item.Value)
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Select(value => value!.Trim().TrimEnd('/'))
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    var frontendUrl = builder.Configuration["FrontendUrl"];
    if (!string.IsNullOrWhiteSpace(frontendUrl))
    {
        allowedOrigins.Add(frontendUrl.Trim().TrimEnd('/'));
    }

    if (builder.Environment.IsDevelopment())
    {
        allowedOrigins.Add("http://localhost:5173");
    }

    foreach (var origin in allowedOrigins)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps
                && !(builder.Environment.IsDevelopment()
                    && uri.Scheme == Uri.UriSchemeHttp
                    && uri.IsLoopback))
            || uri.UserInfo.Length > 0
            || uri.AbsolutePath != "/"
            || uri.Query.Length > 0
            || uri.Fragment.Length > 0)
        {
            throw new InvalidOperationException(
                "CORS allowed origins must be HTTPS origins without paths, queries, or credentials.");
        }
    }

    options.AddPolicy("Frontend", policy =>
    {
        policy.WithOrigins(allowedOrigins.ToArray())
            .AllowAnyHeader()
            .AllowAnyMethod()
            .WithExposedHeaders(RequestObservability.HeaderName);
    });
});

// Bound requests to the Identity endpoint group without changing any URLs.
// The partition uses the connection IP; never trust a client-supplied
// X-Forwarded-For header without a configured, trusted reverse proxy.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.StatusCode =
            StatusCodes.Status429TooManyRequests;
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await context.HttpContext.Response.WriteAsync(
            "Too many authentication requests. Please try again later.",
            cancellationToken);
    };

    // The trusted edge header is enabled only for an explicitly opted-in
    // Render PUBLIC service running in Production. Render overwrites
    // CF-Connecting-IP at its Cloudflare edge; do not trust X-Forwarded-For.
    var trustRenderPublicEdge =
        builder.Environment.IsProduction() &&
        builder.Configuration.GetValue<bool>("Security:TrustRenderPublicEdgeClientIp") &&
        builder.Configuration["RENDER_SERVICE_TYPE"] == "web" &&
        !string.IsNullOrWhiteSpace(builder.Configuration["RENDER_SERVICE_ID"]);

    // Disabled by default. Staging can enable non-identifying partition
    // diagnostics to confirm clients don't share a bucket.
    var logBucketDiagnostics =
        trustRenderPublicEdge &&
        builder.Configuration.GetValue<bool>("Security:LogAuthBucketTags");

    options.AddPolicy("frontend-diagnostics", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: "telemetry:" + AuthClientIpPartition.GetKey(context, false),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 12,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));

    options.AddPolicy("authentication", context =>
    {
        var partitionKey = AuthClientIpPartition.GetKey(context, trustRenderPublicEdge);

        if (logBucketDiagnostics)
        {
            var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
                .CreateLogger("TaskFlow.Security.AuthRateLimit");
            logger.LogInformation(
                "Auth rate-limit partition {PartitionTag} source {Source}",
                AuthClientIpPartition.DiagnosticTag(partitionKey),
                partitionKey.StartsWith("edge:", StringComparison.Ordinal)
                    ? "trusted-edge" : "connection-fallback");
        }

        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: partitionKey,
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = builder.Environment.IsDevelopment() &&
                    builder.Configuration.GetValue<bool>("Testing:RelaxAuthRateLimit") ? 200 : 20,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            });
    });
});

var app = builder.Build();

// Validate the complete email configuration before accepting any HTTP traffic.
// Without this eager resolution, a partial provider setup could appear healthy
// until the first Identity email attempt.
_ = app.Services.GetRequiredService<AccountEmailDelivery>();

// The Render service auto-deploys main. Expand the production PostgreSQL
// schema BEFORE starting the new API so existing tasks remain available.
// This upgrade is additive and idempotent; a failed preflight aborts startup.
if (app.Environment.IsProduction() &&
    string.Equals(app.Configuration["DatabaseProvider"], "Postgres",
        StringComparison.OrdinalIgnoreCase))
{
    await RecurringProductionMigration.EnsureAppliedAsync(app.Services);
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseRouting();
// Correlation is assigned *before* auth/authorization so rejected requests are traced.
app.Use(async (context, next) =>
{
    var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
        .CreateLogger("TaskFlow.Observability.Request");
    await RequestObservability.InvokeAsync(context, next, logger);
});
app.UseCors("Frontend");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// Grouping with an empty prefix preserves /register, /login, and all other
// standard Identity API routes while enforcing a shared auth request budget.
var identityEndpoints = app.MapGroup("");
identityEndpoints.RequireRateLimiting("authentication");
identityEndpoints.MapIdentityApi<ApplicationUser>();

// The signed-in account identity is read-only and scoped solely to the bearer token.
// Never accept account IDs from clients or cache an identity response across users.
app.MapGet("/api/account/me", async (ClaimsPrincipal principal, TaskDbContext db,
    HttpContext context) =>
{
    context.Response.Headers.CacheControl = "no-store";
    var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (string.IsNullOrEmpty(userId)) return Results.Unauthorized();

    var email = await db.Users.AsNoTracking()
        .Where(account => account.Id == userId)
        .Select(account => account.Email)
        .SingleOrDefaultAsync();
    return email is null ? Results.Unauthorized() : Results.Ok(new { email });
})
.RequireAuthorization();

// Public feature capability. No secrets, provider identifiers or email addresses.
app.MapGet("/api/account/capabilities", (AccountEmailDelivery delivery) =>
    Results.Ok(new { emailDeliveryEnabled = delivery.Enabled }))
    .AllowAnonymous();

// Read-only endpoints for production uptime and database readiness monitoring.
// Never return connection strings, error details, migrations, or application data.
app.MapGet("/health/live", () => Results.Ok(new { status = "alive" }))
    .AllowAnonymous();

app.MapGet("/health/ready", async (TaskDbContext db, ILogger<Program> logger,
    CancellationToken cancellationToken) =>
{
    try
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(4));
        var reachable = await db.Database.CanConnectAsync(timeout.Token);
        return reachable
            ? Results.Ok(new { status = "ready" })
            : Results.Json(new { status = "unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
    {
        logger.LogWarning("TaskFlow readiness probe failed: {ExceptionType}", ex.GetType().Name);
        return Results.Json(new { status = "unavailable" },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.AllowAnonymous();

// Only a fixed taxonomy is accepted; do not store free-form browser errors,
// stack traces, route URLs, usernames or user-entered task contents.
app.MapPost("/api/diagnostics/frontend", (
    FrontendDiagnostic report,
    HttpContext context,
    ILogger<Program> logger) =>
{
    if (context.Request.ContentLength is > 1024 ||
        !FrontendDiagnosticValidator.IsValid(report))
    {
        return Results.BadRequest();
    }
    logger.LogWarning(
        "frontend_diagnostic code={Code} area={Area} correlation_id={CorrelationId}",
        report.Code, report.Area, report.CorrelationId);
    return Results.Accepted();
})
.RequireRateLimiting("frontend-diagnostics")
.AllowAnonymous();

// All project endpoints derive ownership from the authenticated account.
// The project list never exposes another account's project identifiers.
app.MapGet("/api/projects", async (ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    return Results.Ok(await db.TaskProjects.AsNoTracking()
        .Where(project => project.UserId == userId)
        .OrderBy(project => project.Name)
        .ThenBy(project => project.Id)
        .Select(project => new { project.Id, project.Name })
        .ToListAsync());
}).RequireAuthorization();

app.MapPost("/api/projects", async (
    ProjectCreateRequest input, ClaimsPrincipal user, TaskDbContext db) =>
{
    var name = input.Name?.Trim();
    if (string.IsNullOrWhiteSpace(name) || name.Length > 70)
        return Results.BadRequest("Project name must be 1–70 characters.");
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    if (await db.TaskProjects.AnyAsync(p => p.UserId == userId && p.Name == name))
        return Results.Conflict("A project with that name already exists.");
    var project = new TaskProject { UserId = userId, Name = name };
    db.TaskProjects.Add(project);
    await db.SaveChangesAsync();
    return Results.Created($"/api/projects/{project.Id}", new { project.Id, project.Name });
}).RequireAuthorization();

// Renaming a project preserves its identity and every linked task.
app.MapPut("/api/projects/{id:int}", async (
    int id, ProjectCreateRequest input, ClaimsPrincipal user, TaskDbContext db) =>
{
    var name = input.Name?.Trim();
    if (string.IsNullOrWhiteSpace(name) || name.Length > 70)
        return Results.BadRequest("Project name must be 1–70 characters.");
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var project = await db.TaskProjects.FirstOrDefaultAsync(p =>
        p.Id == id && p.UserId == userId);
    if (project is null) return Results.NotFound();
    if (project.Name == name) return Results.Ok(new { project.Id, project.Name });
    if (await db.TaskProjects.AnyAsync(p =>
        p.UserId == userId && p.Id != id && p.Name == name))
        return Results.Conflict("A project with that name already exists.");
    project.Name = name;
    await db.SaveChangesAsync();
    return Results.Ok(new { project.Id, project.Name });
}).RequireAuthorization();

// Project assignment is a versioned mutation, not a client-side-only label.
// The transaction atomically records both historical snapshots and activity.
app.MapPut("/api/tasks/{id:int}/project", async (
    int id, ProjectAssignRequest input, ClaimsPrincipal user,
    TaskDbContext db, HttpContext context) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var original = await db.Tasks.AsNoTracking()
        .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
    if (original is null) return Results.NotFound();
    var header = context.Request.Headers.IfMatch.ToString();
    if (!TaskEditVersion.IsValid(header))
        return Results.BadRequest("The latest task version is required.");
    if (header != "\"" + original.Version + "\"")
        return Results.Conflict("Task changed elsewhere. Reload before moving it.");
    if (input.ProjectId.HasValue && !await db.TaskProjects.AnyAsync(p =>
        p.Id == input.ProjectId.Value && p.UserId == userId))
        return Results.NotFound();
    if (original.ProjectId == input.ProjectId) return Results.Ok(original);
    await using var transaction = await db.Database.BeginTransactionAsync();
    var changed = await TaskEditVersion.Unchanged(db.Tasks, original)
        .ExecuteUpdateAsync(update => update.SetProperty(t => t.ProjectId, input.ProjectId));
    if (changed == 0)
        return Results.Conflict("Task changed elsewhere. Reload before moving it.");
    var updated = await TaskVersionHistory.RecordChangeAsync(db, original, "edited");
    TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Edited);
    await db.SaveChangesAsync();
    await transaction.CommitAsync();
    return Results.Ok(updated);
}).RequireAuthorization();

// Dependencies are per-account edges. A client cannot link to another account's
// tasks or create a directed cycle. Expected set guards against stale editors.
app.MapGet("/api/tasks/{id:int}/dependencies", async (
    int id, ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    if (!await db.Tasks.AnyAsync(t => t.Id == id && t.UserId == userId))
        return Results.NotFound();
    var ids = await db.TaskDependencies.AsNoTracking()
        .Where(d => d.TaskId == id)
        .Join(db.Tasks.Where(t => t.UserId == userId), d => d.DependsOnTaskId,
            t => t.Id, (d, t) => new { t.Id, t.Title, t.Completed })
        .OrderBy(t => t.Id).ToListAsync();
    return Results.Ok(ids);
}).RequireAuthorization();

app.MapPut("/api/tasks/{id:int}/dependencies", async (
    int id, TaskDependenciesUpdate request, ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    if (request.DependsOnIds is null || request.ExpectedDependsOnIds is null ||
        request.DependsOnIds.Count > 50 || request.ExpectedDependsOnIds.Count > 50 ||
        request.DependsOnIds.Any(x => x <= 0 || x == id) ||
        request.DependsOnIds.Distinct().Count() != request.DependsOnIds.Count)
        return Results.BadRequest("Select at most 50 distinct dependencies, excluding this task.");

    await using var transaction = await db.Database.BeginTransactionAsync(
        System.Data.IsolationLevel.Serializable);
    var ownedIds = await db.Tasks.AsNoTracking().Where(t => t.UserId == userId)
        .Select(t => t.Id).ToListAsync();
    var owned = ownedIds.ToHashSet();
    if (!owned.Contains(id)) return Results.NotFound();
    if (request.DependsOnIds.Any(x => !owned.Contains(x))) return Results.NotFound();

    var links = await db.TaskDependencies.AsNoTracking()
        .Where(d => ownedIds.Contains(d.TaskId) && ownedIds.Contains(d.DependsOnTaskId))
        .ToListAsync();
    var previous = links.Where(d => d.TaskId == id)
        .Select(d => d.DependsOnTaskId).OrderBy(x => x).ToArray();
    if (!previous.SequenceEqual(request.ExpectedDependsOnIds.OrderBy(x => x)))
        return Results.Conflict("Dependencies changed elsewhere. Reload before saving.");

    // Search from each proposed prerequisite: if it can already reach the task,
    // adding this edge would make a circular dependency.
    var graph = links.Where(d => d.TaskId != id)
        .GroupBy(d => d.TaskId)
        .ToDictionary(g => g.Key, g => g.Select(d => d.DependsOnTaskId).ToArray());
    foreach (var prerequisite in request.DependsOnIds)
    {
        var stack = new Stack<int>();
        var seen = new HashSet<int>();
        stack.Push(prerequisite);
        while (stack.Count > 0)
        {
            var node = stack.Pop();
            if (node == id)
                return Results.BadRequest("Circular task dependencies are not allowed.");
            if (seen.Add(node) && graph.TryGetValue(node, out var parents))
                foreach (var parent in parents) stack.Push(parent);
        }
    }

    var oldLinks = await db.TaskDependencies.Where(d => d.TaskId == id).ToListAsync();
    db.TaskDependencies.RemoveRange(oldLinks);
    db.TaskDependencies.AddRange(request.DependsOnIds.Select(other =>
        new TaskDependency { TaskId = id, DependsOnTaskId = other }));
    await db.SaveChangesAsync();
    await transaction.CommitAsync();
    return Results.Ok(new { DependsOnIds = request.DependsOnIds.OrderBy(x => x) });
}).RequireAuthorization();

// GET: All legacy clients still receive their complete account-specific task list.
// New clients can request bounded pages, maintaining the same global sort order.
// Stable Id tie-breaking prevents nondeterministic boundaries for equal-priority dates.
app.MapGet("/api/tasks", async (
    ClaimsPrincipal user,
    TaskDbContext db,
    int? offset,
    int? limit) =>
{
    if (offset.HasValue != limit.HasValue ||
        (offset.HasValue && offset.Value < 0) ||
        (limit.HasValue && (limit.Value < 1 || limit.Value > 100)))
        return Results.BadRequest("Pagination requires offset >= 0 and limit between 1 and 100.");

    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var query = db.Tasks.AsNoTracking()
        .Where(t => t.UserId == userId)
        .OrderBy(t => t.Completed)
        .ThenBy(t =>
            t.Priority == "High" ? 1 :
            t.Priority == "Medium" ? 2 : 3
        )
        .ThenBy(t => t.DueDate == null)
        .ThenBy(t => t.DueDate)
        .ThenBy(t => t.Id);

    // Bounds are deliberately optional for backward compatibility.
    if (offset.HasValue)
        return Results.Ok(await query.Skip(offset.Value).Take(limit!.Value).ToListAsync());

    return Results.Ok(await query.ToListAsync());
})
.RequireAuthorization();

// Notification filters are per-account, never derived from a client-provided
// user identifier. No email address or task content is stored in preferences.
app.MapGet("/api/notifications/preferences", async (
    ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var saved = await db.NotificationPreferences.AsNoTracking()
        .FirstOrDefaultAsync(p => p.UserId == userId);
    return Results.Ok(new
    {
        OverdueEnabled = saved?.OverdueEnabled ?? true,
        DueTodayEnabled = saved?.DueTodayEnabled ?? true,
        UpcomingEnabled = saved?.UpcomingEnabled ?? true
    });
})
.RequireAuthorization();

app.MapPut("/api/notifications/preferences", async (
    NotificationPreferencesUpdate input, ClaimsPrincipal user, TaskDbContext db) =>
{
    if (input.OverdueEnabled is null || input.DueTodayEnabled is null ||
        input.UpcomingEnabled is null)
        return Results.BadRequest("Every notification preference is required.");

    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var saved = await db.NotificationPreferences.FirstOrDefaultAsync(p => p.UserId == userId);
    if (saved is null)
    {
        saved = new NotificationPreferences { UserId = userId };
        db.NotificationPreferences.Add(saved);
    }
    saved.OverdueEnabled = input.OverdueEnabled.Value;
    saved.DueTodayEnabled = input.DueTodayEnabled.Value;
    saved.UpcomingEnabled = input.UpcomingEnabled.Value;
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        saved.OverdueEnabled, saved.DueTodayEnabled, saved.UpcomingEnabled
    });
})
.RequireAuthorization();

// Read/dismiss state is persisted server-side and contains no task text.
// Never accept a user ID from the client; even a known task ID is insufficient.
app.MapGet("/api/notifications/state", async (
    ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    return await db.TaskNotificationStates.AsNoTracking()
        .Where(state => state.UserId == userId)
        .Select(state => new
        {
            state.TaskId, state.Kind, state.IsRead, state.IsDismissed
        }).ToListAsync();
})
.RequireAuthorization();

app.MapPut("/api/notifications/state/{taskId:int}/{kind}", async (
    int taskId, string kind, NotificationStateUpdate update,
    ClaimsPrincipal user, TaskDbContext db) =>
{
    if (!TaskNotificationKinds.IsValid(kind) ||
        !TaskNotificationKinds.IsValidAction(update.Action))
        return Results.BadRequest("Unsupported notification action or category.");

    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    if (!await db.Tasks.AnyAsync(task => task.Id == taskId && task.UserId == userId))
        return Results.NotFound();

    var state = await db.TaskNotificationStates.FirstOrDefaultAsync(item =>
        item.UserId == userId && item.TaskId == taskId && item.Kind == kind);
    if (state is null)
    {
        state = new TaskNotificationState { UserId = userId, TaskId = taskId, Kind = kind };
        db.TaskNotificationStates.Add(state);
    }

    if (update.Action == "read") state.IsRead = true;
    else { state.IsRead = true; state.IsDismissed = true; }
    await db.SaveChangesAsync();
    return Results.Ok(new { state.TaskId, state.Kind, state.IsRead, state.IsDismissed });
})
.RequireAuthorization();

// This endpoint never accepts a user ID, and never returns events of another account.
// A missing or cross-account task looks identical: 404.
app.MapGet("/api/tasks/{id:int}/activity", async (
    int id, ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    if (!await db.Tasks.AsNoTracking().AnyAsync(t => t.Id == id && t.UserId == userId))
        return Results.NotFound();

    var events = await db.TaskActivities.AsNoTracking()
        .Where(activity => activity.UserId == userId && activity.TaskId == id)
        .OrderByDescending(activity => activity.OccurredAt)
        .ThenByDescending(activity => activity.Id)
        .Take(50)
        .Select(activity => new { activity.Id, activity.Kind, activity.OccurredAt })
        .ToListAsync();
    return Results.Ok(events);
})
.RequireAuthorization();

// Snapshots contain private task content; enforce ownership before returning
// anything, including metadata. Existing tasks may have no versions yet.
app.MapGet("/api/tasks/{id:int}/versions", async (
    int id, ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    if (!await db.Tasks.AsNoTracking().AnyAsync(t => t.Id == id && t.UserId == userId))
        return Results.NotFound();
    var versions = await db.TaskVersions.AsNoTracking()
        .Where(v => v.UserId == userId && v.TaskId == id)
        .OrderByDescending(v => v.Id).Take(50)
        .ToListAsync();
    return Results.Ok(versions.Select(v => new {
        v.Id, v.Kind, v.RecordedAt, v.Fingerprint,
        Snapshot = TaskVersionHistory.Parse(v)
    }));
}).RequireAuthorization();

// Restores are explicit, version-guarded writes. A current-version precondition
// is required; the same transaction saves both the prior state and restored state.
app.MapPost("/api/tasks/{id:int}/restore", async (
    int id, TaskRestoreRequest request, ClaimsPrincipal user,
    TaskDbContext db, HttpContext context) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var original = await db.Tasks.AsNoTracking()
        .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
    if (original is null) return Results.NotFound();
    var header = context.Request.Headers.IfMatch.ToString();
    if (!TaskEditVersion.IsValid(header))
        return Results.BadRequest("Restoring requires the current task version.");
    if (!string.Equals(header, "\"" + original.Version + "\"", StringComparison.Ordinal))
        return Results.Conflict("Task changed elsewhere. Reload before restoring.");
    var version = await db.TaskVersions.AsNoTracking()
        .FirstOrDefaultAsync(v => v.Id == request.VersionId &&
            v.TaskId == id && v.UserId == userId);
    if (version is null) return Results.NotFound();
    var saved = TaskVersionHistory.Parse(version);
    var candidate = saved.AsTask();
    var validationError = TaskInputValidator.Validate(candidate);
    if (saved.ProjectId.HasValue && !await db.TaskProjects.AnyAsync(p =>
        p.Id == saved.ProjectId.Value && p.UserId == userId))
        return Results.BadRequest("The saved project is no longer available.");
    if (validationError is not null || candidate.Notes.Length > 4000 ||
        candidate.Checklist.Count > 30 ||
        candidate.Checklist.Any(step => string.IsNullOrWhiteSpace(step.Text) || step.Text.Length > 160))
        return Results.BadRequest("Saved version is not valid for restoration.");

    await using var transaction = await db.Database.BeginTransactionAsync();
    var affected = await TaskEditVersion.Unchanged(db.Tasks, original)
        .ExecuteUpdateAsync(update => update
            .SetProperty(t => t.Title, saved.Title)
            .SetProperty(t => t.Completed, saved.Completed)
            .SetProperty(t => t.Priority, saved.Priority)
            .SetProperty(t => t.DueDate, saved.DueDate)
            .SetProperty(t => t.Category, saved.Category)
            .SetProperty(t => t.RecurrenceRule, saved.RecurrenceRule)
            .SetProperty(t => t.ReminderDaysBefore, saved.ReminderDaysBefore)
            .SetProperty(t => t.Notes, saved.Notes)
            .SetProperty(t => t.ChecklistJson, saved.ChecklistJson)
            .SetProperty(t => t.ProjectId, saved.ProjectId));
    if (affected == 0)
        return await db.Tasks.AnyAsync(t => t.Id == id && t.UserId == userId)
            ? Results.Conflict("Task changed elsewhere. Reload before restoring.")
            : Results.NotFound();
    var restored = await TaskVersionHistory.RecordChangeAsync(db, original, "restored");
    TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Edited);
    await db.SaveChangesAsync();
    await transaction.CommitAsync();
    return Results.Ok(restored);
}).RequireAuthorization();

// POST: Create a task owned by the logged-in user.
app.MapPost("/api/tasks", async (
    TaskItem task,
    ClaimsPrincipal user,
    TaskDbContext db) =>
{
    var validationError = TaskInputValidator.Validate(task);
    if (validationError is not null)
    {
        return Results.BadRequest(validationError);
    }

    task.Title = task.Title.Trim();

    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;

    // Treat the client payload as untrusted. The server owns identity fields
    // and new tasks always start incomplete, regardless of supplied values.
    task.Id = 0;
    task.Completed = false;
    task.UserId = userId;
    task.Notes = "";
    task.ChecklistJson = "[]";
    // An optional project is assigned at creation only when it belongs to
    // the signed-in account. Unknown or cross-account IDs fail closed.
    if (task.ProjectId.HasValue && !await db.TaskProjects.AnyAsync(project =>
        project.Id == task.ProjectId.Value && project.UserId == userId))
        return Results.NotFound();

    if (task.DueDate.HasValue)
    {
        task.DueDate = DateTime.SpecifyKind(
            task.DueDate.Value,
            DateTimeKind.Utc
        );
    }

    await using var activityTransaction = await db.Database.BeginTransactionAsync();
    db.Tasks.Add(task);
    await db.SaveChangesAsync();
    TaskActivityKinds.Record(db, userId, task.Id, TaskActivityKinds.Created);
    TaskVersionHistory.Add(db, task, "created");
    await db.SaveChangesAsync();
    await activityTransaction.CommitAsync();

    return Results.Created($"/api/tasks/{task.Id}", task);
})
.RequireAuthorization();

// Complete a recurring task atomically and create one fresh occurrence.
// A conditional update prevents two simultaneous clicks from creating duplicates.
app.MapPut("/api/tasks/{id}", async (
    int id,
    ClaimsPrincipal user,
    TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    await using var transaction = await db.Database.BeginTransactionAsync();
    var task = await db.Tasks.AsNoTracking().FirstOrDefaultAsync(
        t => t.Id == id && t.UserId == userId);
    if (task is null) return Results.NotFound();

    if (!task.Completed && await db.TaskDependencies.AsNoTracking()
        .Where(d => d.TaskId == id)
        .Join(db.Tasks.Where(t => t.UserId == userId && !t.Completed),
            d => d.DependsOnTaskId, t => t.Id, (d, t) => t.Id)
        .AnyAsync())
        return Results.Conflict("Complete prerequisite tasks before finishing this task.");

    if (task.Completed)
    {
        await db.Tasks.Where(t => t.Id == id && t.UserId == userId && t.Completed)
            .ExecuteUpdateAsync(update => update.SetProperty(t => t.Completed, false));
        TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Reopened);
        await TaskVersionHistory.RecordChangeAsync(db, task, "reopened");
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Ok(await db.Tasks.AsNoTracking().FirstAsync(t => t.Id == id));
    }

    var changed = await db.Tasks
        .Where(t => t.Id == id && t.UserId == userId && !t.Completed)
        .ExecuteUpdateAsync(update => update.SetProperty(t => t.Completed, true));
    if (changed == 0)
    {
        await transaction.RollbackAsync();
        return Results.Conflict("Task completion changed. Refresh your tasks.");
    }

    if (task.RecurrenceRule != "None" && task.DueDate.HasValue)
    {
        var nextTask = TaskSchedule.NextOccurrence(task);
        db.Tasks.Add(nextTask);
        await db.SaveChangesAsync();
        TaskActivityKinds.Record(db, userId, nextTask.Id, TaskActivityKinds.Created);
        TaskVersionHistory.Add(db, nextTask, "created");
    }
    TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Completed);
    await TaskVersionHistory.RecordChangeAsync(db, task, "completed");
    await db.SaveChangesAsync();
    await transaction.CommitAsync();
    return Results.Ok(await db.Tasks.AsNoTracking().FirstAsync(t => t.Id == id));
})
.RequireAuthorization();

// Optional If-Match protects clients against overwriting another tab's edits.
// Legacy callers without the header retain their existing behavior.
app.MapPut("/api/tasks/{id}/title", async (
    int id, TaskItem updatedTask, ClaimsPrincipal user, TaskDbContext db,
    HttpContext context) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var original = await db.Tasks.AsNoTracking()
        .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
    if (original is null) return Results.NotFound();

    var validationError = TaskInputValidator.Validate(updatedTask);
    if (validationError is not null) return Results.BadRequest(validationError);

    var desiredDate = updatedTask.DueDate.HasValue
        ? DateTime.SpecifyKind(updatedTask.DueDate.Value, DateTimeKind.Utc) : (DateTime?)null;
    var title = updatedTask.Title.Trim();
    await using var activityTransaction = await db.Database.BeginTransactionAsync();
    var header = context.Request.Headers.IfMatch.ToString();
    if (!string.IsNullOrEmpty(header))
    {
        if (!TaskEditVersion.IsValid(header))
            return Results.BadRequest("Invalid If-Match task version.");
        if (!string.Equals(header, "\"" + original.Version + "\"", StringComparison.Ordinal))
            return Results.Conflict("This task changed elsewhere. Review the latest version before saving.");

        var changed = await TaskEditVersion.Unchanged(db.Tasks, original)
            .ExecuteUpdateAsync(update => update
                .SetProperty(t => t.Title, title)
                .SetProperty(t => t.Priority, updatedTask.Priority)
                .SetProperty(t => t.Category, updatedTask.Category)
                .SetProperty(t => t.RecurrenceRule, updatedTask.RecurrenceRule)
                .SetProperty(t => t.ReminderDaysBefore, updatedTask.ReminderDaysBefore)
                .SetProperty(t => t.DueDate, desiredDate));
        if (changed == 0)
            return await db.Tasks.AnyAsync(t => t.Id == id && t.UserId == userId)
                ? Results.Conflict("This task changed elsewhere. Review the latest version before saving.")
                : Results.NotFound();
        TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Edited);
        if (original.DueDate != desiredDate) TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Rescheduled);
        var guardedTask = await TaskVersionHistory.RecordChangeAsync(db, original, "edited");
        await db.SaveChangesAsync();
        await activityTransaction.CommitAsync();
        return Results.Ok(guardedTask);
    }

    // Maintain compatibility with previous app clients during rollout.
    var task = await db.Tasks.SingleAsync(t => t.Id == id && t.UserId == userId);
    task.Title = title;
    task.Priority = updatedTask.Priority;
    task.Category = updatedTask.Category;
    task.RecurrenceRule = updatedTask.RecurrenceRule;
    task.ReminderDaysBefore = updatedTask.ReminderDaysBefore;
    task.DueDate = desiredDate;
    TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Edited);
    if (original.DueDate != desiredDate) TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Rescheduled);
    await db.SaveChangesAsync();
    var changedTask = await TaskVersionHistory.RecordChangeAsync(db, original, "edited");
    await db.SaveChangesAsync();
    await activityTransaction.CommitAsync();
    return Results.Ok(changedTask);
})
.RequireAuthorization();

// Guard task details (notes/checklist/date) with the same atomic precondition.
app.MapPut("/api/tasks/{id}/details", async (
    int id, TaskDetailsUpdate details, ClaimsPrincipal user, TaskDbContext db,
    HttpContext context) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var original = await db.Tasks.AsNoTracking()
        .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
    if (original is null) return Results.NotFound();

    var notes = details.Notes ?? "";
    var checklist = details.Checklist ?? [];
    if (notes.Length > 4000 || checklist.Count > 30 ||
        checklist.Any(item => item is null || string.IsNullOrWhiteSpace(item.Text) || item.Text.Length > 160))
        return Results.BadRequest("Notes are limited to 4,000 characters and checklists to 30 items of 160 characters each.");

    var checklistJson = JsonSerializer.Serialize(checklist.Select(item => item! with { Text = item!.Text.Trim() }));
    var dueDate = details.UpdateDueDate
        ? details.DueDate?.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc)
        : original.DueDate;
    await using var activityTransaction = await db.Database.BeginTransactionAsync();
    var header = context.Request.Headers.IfMatch.ToString();
    if (!string.IsNullOrEmpty(header))
    {
        if (!TaskEditVersion.IsValid(header))
            return Results.BadRequest("Invalid If-Match task version.");
        if (!string.Equals(header, "\"" + original.Version + "\"", StringComparison.Ordinal))
            return Results.Conflict("This task changed elsewhere. Review the latest version before saving.");

        var changed = await TaskEditVersion.Unchanged(db.Tasks, original)
            .ExecuteUpdateAsync(update => update
                .SetProperty(t => t.Notes, notes)
                .SetProperty(t => t.ChecklistJson, checklistJson)
                .SetProperty(t => t.DueDate, dueDate));
        if (changed == 0)
            return await db.Tasks.AnyAsync(t => t.Id == id && t.UserId == userId)
                ? Results.Conflict("This task changed elsewhere. Review the latest version before saving.")
                : Results.NotFound();
        TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Edited);
        if (original.DueDate != dueDate) TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Rescheduled);
        var guardedTask = await TaskVersionHistory.RecordChangeAsync(db, original, "edited");
        await db.SaveChangesAsync();
        await activityTransaction.CommitAsync();
        return Results.Ok(guardedTask);
    }

    var task = await db.Tasks.SingleAsync(t => t.Id == id && t.UserId == userId);
    if (details.UpdateDueDate) task.DueDate = dueDate;
    task.Notes = notes;
    task.ChecklistJson = checklistJson;
    TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Edited);
    if (original.DueDate != dueDate) TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Rescheduled);
    await db.SaveChangesAsync();
    var changedTask = await TaskVersionHistory.RecordChangeAsync(db, original, "edited");
    await db.SaveChangesAsync();
    await activityTransaction.CommitAsync();
    return Results.Ok(changedTask);
})
.RequireAuthorization();

// PUT: Move a task on the calendar without rewriting its other fields.
app.MapPut("/api/tasks/{id}/due-date", async (
    int id,
    TaskDueDateUpdate update,
    ClaimsPrincipal user,
    TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var task = await db.Tasks.FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
    if (task is null)
    {
        return Results.NotFound();
    }

    await using var activityTransaction = await db.Database.BeginTransactionAsync();
    var oldDate = task.DueDate;
    var original = TaskSnapshot.From(task).AsTask();
    original.Id = task.Id;
    original.UserId = userId;
    task.DueDate = update.DueDate?.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    if (oldDate != task.DueDate) TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Rescheduled);
    await db.SaveChangesAsync();
    if (oldDate != task.DueDate) {
        await TaskVersionHistory.RecordChangeAsync(db, original, "rescheduled");
        await db.SaveChangesAsync();
    }
    await activityTransaction.CommitAsync();
    return Results.Ok(new { task.DueDate });
})
.RequireAuthorization();

// PATCH: Change the date only if it still matches the client’s expected date.
app.MapPatch("/api/tasks/{id}/due-date", async (
    int id,
    GuardedTaskDueDateUpdate update,
    ClaimsPrincipal user,
    TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var ownedTask = db.Tasks.Where(t => t.Id == id && t.UserId == userId);
    if (update.ExpectedDueDate is not { } expected)
    {
        return Results.BadRequest("An expected due date is required.");
    }

    var original = await ownedTask.AsNoTracking().FirstOrDefaultAsync();
    if (original is null) return Results.NotFound();
    var expectedUtc = expected.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    var target = expected == DateOnly.MaxValue
        ? ownedTask.Where(t => t.DueDate >= expectedUtc)
        : ownedTask.Where(t => t.DueDate >= expectedUtc && t.DueDate < expectedUtc.AddDays(1));

    var dueDate = update.DueDate?.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    await using var activityTransaction = await db.Database.BeginTransactionAsync();
    var updated = await target.ExecuteUpdateAsync(setters => setters.SetProperty(t => t.DueDate, dueDate));
    if (updated == 0)
    {
        return await ownedTask.AnyAsync() ? Results.Conflict() : Results.NotFound();
    }

    if (dueDate != expectedUtc) TaskActivityKinds.Record(db, userId, id, TaskActivityKinds.Rescheduled);
    if (dueDate != original.DueDate)
        await TaskVersionHistory.RecordChangeAsync(db, original, "rescheduled");
    await db.SaveChangesAsync();
    await activityTransaction.CommitAsync();
    return Results.Ok(new { DueDate = dueDate });
})
.RequireAuthorization();

// DELETE: Delete only the owner's task.
app.MapDelete("/api/tasks/{id}", async (
    int id,
    ClaimsPrincipal user,
    TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;

    var task = await db.Tasks.FirstOrDefaultAsync(
        t => t.Id == id && t.UserId == userId
    );

    if (task == null)
    {
        return Results.NotFound();
    }

    db.Tasks.Remove(task);
    await db.SaveChangesAsync();

    return Results.NoContent();
})
.RequireAuthorization();

app.Run();

public partial class Program { }