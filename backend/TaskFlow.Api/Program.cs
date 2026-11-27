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
// Optional inference is opt-in and disabled unless both the flag and server key are set.
builder.Services.AddHttpClient("ai-coach", client => client.Timeout = TimeSpan.FromSeconds(15));
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
            .WithExposedHeaders(RequestObservability.HeaderName, "Retry-After");
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
        var aiPolicy = context.HttpContext.GetEndpoint()?.Metadata
            .GetMetadata<EnableRateLimitingAttribute>()?.PolicyName == "ai-coach";
        if (aiPolicy)
        {
            // Fixed-window leases provide the remaining time until the
            // current bucket replenishes. Never advertise a fabricated reset
            // time or change the existing permit/cost-protection policy.
            if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out TimeSpan retryAfter))
            {
                var seconds = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds));
                context.HttpContext.Response.Headers.RetryAfter =
                    seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            }
            await context.HttpContext.Response.WriteAsync(
                "AI requests are temporarily limited. Please retry after the cooldown.",
                cancellationToken);
            return;
        }
        // Keep the prior authentication-limiter response unchanged.
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

    // Cost protection for optional external inference. The untrusted client cannot
    // supply the partition key. Never use X-Forwarded-For directly.
    options.AddPolicy("ai-coach", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: "ai:" + AuthClientIpPartition.GetKey(context, false),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(10),
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

// Completion history uses existing server-generated audit timestamps. No migration,
// backfill, or task content exposure; results are scoped to the authenticated user.
// Dates and 30-day buckets use UTC consistently (not a user's due-date timezone).
app.MapGet("/api/analytics/completions", async (ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var todayUtc = DateTime.UtcNow.Date;
    var startUtc = todayUtc.AddDays(-29);
    var endExclusive = todayUtc.AddDays(1);

    // Only read timestamps and event kinds, never titles or notes.
    var events = await db.TaskActivities.AsNoTracking()
        .Where(a => a.UserId == userId &&
            (a.Kind == TaskActivityKinds.Completed || a.Kind == TaskActivityKinds.Reopened) &&
            a.OccurredAt >= startUtc && a.OccurredAt < endExclusive)
        .Select(a => new { a.Kind, a.OccurredAt })
        .ToListAsync();

    var grouped = events.GroupBy(e => e.OccurredAt.Date)
        .ToDictionary(g => g.Key, g => new
        {
            Completed = g.Count(e => e.Kind == TaskActivityKinds.Completed),
            Reopened = g.Count(e => e.Kind == TaskActivityKinds.Reopened)
        });
    var days = Enumerable.Range(0, 30).Select(offset =>
    {
        var date = startUtc.AddDays(offset);
        grouped.TryGetValue(date, out var counts);
        return new
        {
            Date = date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            Completed = counts?.Completed ?? 0,
            Reopened = counts?.Reopened ?? 0
        };
    }).ToArray();
    return Results.Ok(new
    {
        TimeZone = "UTC",
        WindowDays = 30,
        TotalCompletions = days.Sum(day => day.Completed),
        TotalReopenings = days.Sum(day => day.Reopened),
        Days = days
    });
}).RequireAuthorization();

// Explainable, read-only bottleneck detection. All three sources are filtered to
// the caller before any task content reaches memory. No external AI calls or writes.
app.MapGet("/api/analytics/bottlenecks", async (ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var today = DateTime.UtcNow.Date;
    var tasks = await db.Tasks.AsNoTracking().Where(t => t.UserId == userId)
        .Select(t => new { t.Id, t.Title, t.Completed, t.Priority, t.DueDate })
        .ToListAsync();
    var byId = tasks.ToDictionary(t => t.Id);
    var active = tasks.Where(t => !t.Completed).ToArray();

    // Join both ends to tasks owned by the caller, never accept task IDs from
    // the request. Deleted / cross-account links cannot leak information.
    var edges = await db.TaskDependencies.AsNoTracking()
        .Join(db.Tasks.AsNoTracking().Where(t => t.UserId == userId),
            e => e.TaskId, t => t.Id, (e, t) => e)
        .Join(db.Tasks.AsNoTracking().Where(t => t.UserId == userId),
            e => e.DependsOnTaskId, t => t.Id,
            (e, t) => new { e.TaskId, e.DependsOnTaskId })
        .ToListAsync();

    var unresolved = edges.Where(edge =>
        byId.TryGetValue(edge.TaskId, out var task) && !task.Completed &&
        byId.TryGetValue(edge.DependsOnTaskId, out var prerequisite) && !prerequisite.Completed)
        .ToArray();
    var blockedIds = unresolved.Select(e => e.TaskId).ToHashSet();
    var urgentBlocked = active.Where(t => blockedIds.Contains(t.Id) &&
        t.DueDate.HasValue && t.DueDate.Value.Date <= today.AddDays(7))
        .OrderBy(t => t.DueDate).ThenBy(t => t.Id).FirstOrDefault();
    var topBlocker = unresolved.GroupBy(e => e.DependsOnTaskId)
        .OrderByDescending(group => group.Select(e => e.TaskId).Distinct().Count())
        .ThenBy(group => group.Key).FirstOrDefault();

    var overdueReady = active.Where(t => !blockedIds.Contains(t.Id) &&
        t.DueDate.HasValue && t.DueDate.Value.Date < today)
        .OrderBy(t => t.Priority == "High" ? 0 : t.Priority == "Medium" ? 1 : 2)
        .ThenBy(t => t.DueDate).ThenBy(t => t.Id).ToArray();
    var dueThisWeek = active.Count(t => t.DueDate.HasValue &&
        t.DueDate.Value.Date >= today && t.DueDate.Value.Date < today.AddDays(7));

    var lastWeek = await db.TaskActivities.AsNoTracking().CountAsync(e =>
        e.UserId == userId && e.Kind == TaskActivityKinds.Completed &&
        e.OccurredAt >= today.AddDays(-6) && e.OccurredAt < today.AddDays(1));
    var previousWeek = await db.TaskActivities.AsNoTracking().CountAsync(e =>
        e.UserId == userId && e.Kind == TaskActivityKinds.Completed &&
        e.OccurredAt >= today.AddDays(-13) && e.OccurredAt < today.AddDays(-6));

    var advice = new List<(string Id, string Severity, string Title, string Detail, int? TaskId)>();
    if (urgentBlocked is not null)
    {
        var dependencies = unresolved.Count(e => e.TaskId == urgentBlocked.Id);
        advice.Add(("blocked-deadline", "high", "Unblock an approaching deadline",
            "A task due within seven days (or overdue) is waiting for " +
            dependencies + " unfinished prerequisite(s). Open its dependencies and finish the blockers first.",
            urgentBlocked.Id));
    }
    if (topBlocker is not null)
    {
        var impacted = topBlocker.Select(e => e.TaskId).Distinct().Count();
        advice.Add(("shared-prerequisite", impacted >= 2 ? "high" : "medium",
            "Resolve a prerequisite to unblock work",
            "Completing this prerequisite can unblock progress on " + impacted +
            " active " + (impacted == 1 ? "task" : "tasks") +
            ". Check the prerequisite before adding more dependent work.", topBlocker.Key));
    }
    if (overdueReady.Length > 0)
    {
        advice.Add(("overdue-ready", "medium", "Start with unblocked overdue work",
            overdueReady.Length + " overdue active " +
            (overdueReady.Length == 1 ? "task has" : "tasks have") +
            " no unfinished prerequisites. Review the most urgent one, or reschedule it if needed.",
            overdueReady[0].Id));
    }
    // This is a change in recorded events, not evidence of lower productivity;
    // earlier completions may predate the activity ledger.
    if (previousWeek >= 3 && lastWeek * 2 < previousWeek)
    {
        advice.Add(("recent-activity", "info", "Review your recent completion activity",
            "Recorded completion events were " + lastWeek +
            " in the last seven UTC days versus " + previousWeek +
            " in the preceding seven. Check whether deadlines or blocked tasks explain the difference.",
            null));
    }
    if (dueThisWeek >= 5 && advice.Count < 4)
    {
        advice.Add(("busy-week", "info", "Spread out upcoming deadlines",
            dueThisWeek + " active tasks are due over the next seven UTC days. Consider redistributing flexible work.", null));
    }
    if (advice.Count == 0)
        advice.Add(("steady", "info", "No major bottlenecks detected",
            "No urgent dependency or overdue-work signals were found in the current snapshot. Continue reviewing your task plan.", null));

    return Results.Ok(new
    {
        GeneratedAtUtc = DateTime.UtcNow,
        Analysis = "rules",
        TimeZone = "UTC",
        Metrics = new
        {
            ActiveTasks = active.Length,
            BlockedTasks = blockedIds.Count,
            OverdueReadyTasks = overdueReady.Length,
            DueWithin7Days = dueThisWeek,
            CompletionsLast7Days = lastWeek,
            CompletionsPrevious7Days = previousWeek
        },
        Recommendations = advice.Take(4).Select(x => new {
            x.Id, x.Severity, x.Title, x.Detail, x.TaskId
        }).ToArray()
    });
}).RequireAuthorization();

// Read-only motivation from distinct task IDs with recorded completions.
// Reopening/recompleting a task never grants additional XP. Deleted tasks retain
// historical credit; no leaderboard, streak punishment or mutable reward balance.
app.MapGet("/api/analytics/progression", async (ClaimsPrincipal user, TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var firstCompletions = await db.TaskActivities.AsNoTracking()
        .Where(a => a.UserId == userId && a.Kind == TaskActivityKinds.Completed)
        .GroupBy(a => a.TaskId)
        .Select(group => new
        {
            TaskId = group.Key,
            FirstCompletion = group.Min(a => a.OccurredAt)
        })
        .ToListAsync();

    var completedTasks = firstCompletions.Count;
    long xp = completedTasks * 25L;
    var level = 1;
    long levelStart = 0;
    long levelEnd = 100;
    while (xp >= levelEnd && level < 1000)
    {
        levelStart = levelEnd;
        level++;
        levelEnd += level * 100L;
    }
    var today = DateTime.UtcNow.Date;
    var startUtc = today.AddDays(-6);
    var completedThisWeek = firstCompletions
        .Count(item => item.FirstCompletion >= startUtc &&
            item.FirstCompletion < today.AddDays(1));
    var activeDays = firstCompletions
        .Where(item => item.FirstCompletion >= startUtc &&
            item.FirstCompletion < today.AddDays(1))
        .Select(item => item.FirstCompletion.Date).Distinct().Count();

    var achievements = new[]
    {
        new { Id = "first-step", Name = "First Step", Description = "Complete your first task",
            Unlocked = completedTasks >= 1, Progress = Math.Min(completedTasks, 1), Goal = 1 },
        new { Id = "ten-tasks", Name = "Getting Things Done", Description = "Complete 10 different tasks",
            Unlocked = completedTasks >= 10, Progress = Math.Min(completedTasks, 10), Goal = 10 },
        new { Id = "fifty-tasks", Name = "Task Master", Description = "Complete 50 different tasks",
            Unlocked = completedTasks >= 50, Progress = Math.Min(completedTasks, 50), Goal = 50 }
    };

    // Current project quests are separate from earned XP. Membership can change,
    // so completing a project displays progress but never grants repeatable XP.
    // Both the project and task queries are scoped to the signed-in account.
    var totalProjects = await db.TaskProjects.AsNoTracking()
        .CountAsync(p => p.UserId == userId);
    var projects = await db.TaskProjects.AsNoTracking()
        .Where(p => p.UserId == userId)
        .OrderBy(p => p.CreatedAt).ThenBy(p => p.Id)
        .Take(20)
        .Select(p => new { p.Id, p.Name })
        .ToListAsync();
    var projectIds = projects.Select(p => p.Id).ToArray();
    var taskTotals = await db.Tasks.AsNoTracking()
        .Where(t => t.UserId == userId && t.ProjectId.HasValue &&
            projectIds.Contains(t.ProjectId.Value))
        .GroupBy(t => t.ProjectId)
        .Select(group => new
        {
            ProjectId = group.Key,
            Total = group.Count(),
            Completed = group.Count(t => t.Completed)
        })
        .ToListAsync();
    var byProject = taskTotals.ToDictionary(p => p.ProjectId!.Value);
    var projectQuests = projects.Select(p =>
    {
        byProject.TryGetValue(p.Id, out var totals);
        var total = totals?.Total ?? 0;
        var completed = totals?.Completed ?? 0;
        return new
        {
            ProjectId = p.Id,
            Name = p.Name,
            TotalTasks = total,
            CompletedTasks = completed,
            Complete = total > 0 && completed == total
        };
    }).ToArray();

    return Results.Ok(new
    {
        Basis = "first-recorded-completion",
        TimeZone = "UTC",
        Xp = xp,
        Level = level,
        LevelStartXp = levelStart,
        NextLevelXp = levelEnd,
        UniqueCompletedTasks = completedTasks,
        CompletedThisWeek = completedThisWeek,
        ActiveCompletionDays = activeDays,
        Challenge = new { Id = "seven-day-quest", Name = "Seven-day Quest",
            Description = "Complete five different tasks in the last seven UTC days",
            Progress = Math.Min(completedThisWeek, 5), Goal = 5, Complete = completedThisWeek >= 5 },
        Achievements = achievements,
        ProjectQuests = projectQuests,
        TotalProjects = totalProjects
    });
}).RequireAuthorization();

// The model is OFF unless the operator opts in and supplies a backend-only key.
// GET does not contact the provider or disclose configuration secrets.
app.MapGet("/api/analytics/coach/capabilities", (IConfiguration configuration) =>
    Results.Ok(new { Available = AiCoachExplanation.IsEnabled(configuration), Provider = "OpenAI",
        Sends = "Only anonymized aggregate counts and a server-validated insight code" }))
    .RequireAuthorization();

// The user explicitly clicks to ask for a single explanation. No raw prompt,
// task content, activity stream, or account IDs are accepted from the caller.
app.MapPost("/api/analytics/coach/explain", async (
    AiCoachExplainRequest request, ClaimsPrincipal user, TaskDbContext db,
    IConfiguration configuration, IHttpClientFactory httpClients, HttpContext context) =>
{
    if (!AiCoachExplanation.IsAllowed(request.InsightId))
        return Results.BadRequest(new { Message = "Choose a current bottleneck insight." });
    if (!AiCoachExplanation.IsEnabled(configuration))
        return Results.Problem("AI explanations have not been configured.", statusCode: 503);
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var evidence = await AiCoachExplanation.GetEvidenceAsync(
        db, userId, request.InsightId!, context.RequestAborted);
    if (evidence is null)
        return Results.Conflict(new { Message = "The insight is no longer current. Reanalyze your tasks." });
    try
    {
        var explanation = await AiCoachExplanation.GenerateAsync(
            evidence, configuration, httpClients, context.RequestAborted);
        return explanation is null
            ? Results.Problem("AI explanation is temporarily unavailable.", statusCode: 502)
            : Results.Ok(new { InsightId = request.InsightId, Explanation = explanation,
                Analysis = "ai-explanation", IsSuggestion = true });
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
    {
        throw;
    }
    catch (Exception)
    {
        // No raw provider errors or prompt fragments leave the backend.
        return Results.Problem("AI explanation is temporarily unavailable.", statusCode: 502);
    }
}).RequireAuthorization().RequireRateLimiting("ai-coach");

// AI-assisted scheduling proposes work dates only; existing deadlines are never
// rewritten. All task reads are scoped to the authenticated user and capped.
app.MapPost("/api/ai/smart-schedule", async (
    AiSmartSchedule.Request request, ClaimsPrincipal user, TaskDbContext db,
    IConfiguration configuration, IHttpClientFactory clients, HttpContext context) =>
{
    if (!request.Consent)
        return Results.BadRequest(new { Message = "Consent is required before sharing task details." });
    if (!AiSmartSchedule.TryRequest(request, DateOnly.FromDateTime(DateTime.UtcNow), out var start))
        return Results.BadRequest(new { Message = "Choose a valid local date and daily capacity (1–5)." });
    if (!AiTaskBreakdown.IsEnabled(configuration))
        return Results.Problem("AI scheduling is not configured.", statusCode: 503);

    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    // This bounded subset is sufficient for a preview and caps model disclosure.
    var tasks = await db.Tasks.AsNoTracking()
        .Where(t => t.UserId == userId && !t.Completed)
        .OrderBy(t => t.DueDate == null)
        .ThenBy(t => t.DueDate)
        .ThenBy(t => t.Priority == "High" ? 0 : t.Priority == "Medium" ? 1 : 2)
        .ThenBy(t => t.Id)
        .Take(100).ToListAsync(context.RequestAborted);
    var candidates = AiDailyFocus.SelectCandidates(tasks);
    // The ranking sees at most 15 task titles. Date-only load counts are read
    // separately from *all* owner-scoped unfinished tasks in this seven-day
    // window, so workload warnings do not silently undercount at 100 tasks.
    var windowStart = start.ToDateTime(TimeOnly.MinValue);
    var windowEnd = start.AddDays(7).ToDateTime(TimeOnly.MinValue);
    var dated = await db.Tasks.AsNoTracking()
        .Where(t => t.UserId == userId && !t.Completed &&
            t.DueDate.HasValue && t.DueDate >= windowStart && t.DueDate < windowEnd)
        .Select(t => new TaskItem { Id = t.Id, DueDate = t.DueDate })
        .ToListAsync(context.RequestAborted);
    if (candidates.Count == 0)
        return Results.Ok(new {
            Slots = Array.Empty<AiSmartSchedule.Slot>(),
            DayLoads = AiSmartSchedule.BuildDayLoads(dated, Array.Empty<int>(), start),
            NoTasks = true
        });

    try
    {
        // Reuse the strict, owner-ID-validated AI ranking. Date allocation is
        // deterministic and bounded by each task's existing due date.
        var ranked = await AiDailyFocus.GenerateAsync(
            candidates, configuration, clients, context.RequestAborted);
        var slots = ranked is null ? null :
            AiSmartSchedule.Build(ranked, candidates, tasks, start, request.DailyCapacity);
        return slots is null
            ? Results.Problem("AI scheduling could not generate a valid preview.", statusCode: 502)
            : Results.Ok(new {
                Slots = slots,
                DayLoads = AiSmartSchedule.BuildDayLoads(
                    dated, slots.Select(slot => slot.TaskId), start),
                NoTasks = false
            });
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
    {
        throw;
    }
    catch (Exception)
    {
        return Results.Problem("AI scheduling could not generate a valid preview.", statusCode: 502);
    }
}).RequireAuthorization().RequireRateLimiting("ai-coach");

// Read-only daily priorities. The task candidates come exclusively from the
// authenticated user's own rows; no client-supplied IDs or descriptions are trusted.
// Model output is validated against the exact candidate IDs before disclosure.
app.MapPost("/api/ai/daily-focus", async (
    AiDailyFocus.Request request, ClaimsPrincipal user, TaskDbContext db,
    IConfiguration configuration, IHttpClientFactory clients, HttpContext context) =>
{
    if (!request.Consent)
        return Results.BadRequest(new { Message = "Consent is required to share the selected task details with OpenAI." });
    if (!AiTaskBreakdown.IsEnabled(configuration))
        return Results.Problem("AI daily planning is not configured.", statusCode: 503);

    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    // Cap the database result to bound data usage. Prefer tasks with dates and
    // then priority; all records remain scoped to this authenticated account.
    var tasks = await db.Tasks.AsNoTracking()
        .Where(t => t.UserId == userId && !t.Completed)
        .OrderBy(t => t.DueDate == null)
        .ThenBy(t => t.DueDate)
        .ThenBy(t => t.Priority == "High" ? 0 : t.Priority == "Medium" ? 1 : 2)
        .ThenBy(t => t.Id)
        .Take(15).ToListAsync(context.RequestAborted);
    var candidates = AiDailyFocus.SelectCandidates(tasks);
    if (candidates.Count == 0)
        return Results.Ok(new { Picks = Array.Empty<object>(), NoTasks = true });

    try
    {
        var suggestions = await AiDailyFocus.GenerateAsync(
            candidates, configuration, clients, context.RequestAborted);
        if (suggestions is null)
            return Results.Problem("AI daily planning could not generate a valid suggestion.", statusCode: 502);
        // Return only the model-selected owner-scoped tasks, with short reasons.
        var byId = candidates.ToDictionary(t => t.Id);
        return Results.Ok(new {
            Picks = suggestions.Select(p => new {
                TaskId = p.TaskId,
                Title = byId[p.TaskId].Title,
                Priority = byId[p.TaskId].Priority,
                DueDate = byId[p.TaskId].DueDate,
                Reason = p.Reason
            }).ToArray(),
            NoTasks = false
        });
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
    {
        throw;
    }
    catch (Exception)
    {
        return Results.Problem("AI daily planning could not generate a valid suggestion.", statusCode: 502);
    }
}).RequireAuthorization().RequireRateLimiting("ai-coach");

// Separate, opt-in feature. The model sees only the goal the user types here.
// No task data, user IDs or account metadata are sent to the model. Generation is read-only.
app.MapGet("/api/ai/plans/capabilities", (IConfiguration configuration) =>
    Results.Ok(new { Available = AiTaskBreakdown.IsEnabled(configuration),
        Sends = "Only the goal you explicitly enter" }))
    .RequireAuthorization();

app.MapPost("/api/ai/plans/generate", async (
    AiPlanRequest request, IConfiguration configuration, IHttpClientFactory clients,
    HttpContext context) =>
{
    if (!request.Consent)
        return Results.BadRequest(new { Message = "Consent is required before sending your goal to AI." });
    if (!AiTaskBreakdown.ValidGoal(request.Goal))
        return Results.BadRequest(new { Message = "Enter a goal between 12 and 600 characters." });
    if (!AiTaskBreakdown.IsEnabled(configuration))
        return Results.Problem("AI planning is not configured.", statusCode: 503);
    try
    {
        var items = await AiTaskBreakdown.GenerateAsync(
            request.Goal!, configuration, clients, context.RequestAborted);
        return items is null
            ? Results.Problem("An AI task plan could not be generated.", statusCode: 502)
            : Results.Ok(new { Tasks = items, IsSuggestion = true });
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
    {
        throw;
    }
    catch (Exception)
    {
        // Never forward provider diagnostics, secrets or the user's goal text.
        return Results.Problem("An AI task plan could not be generated.", statusCode: 502);
    }
}).RequireAuthorization().RequireRateLimiting("ai-coach");

// User-controlled, reviewed task batch. No model call and no write until Confirm=true.
// Validation and owner-scoped project checks precede a single atomic transaction.
// The same endpoint can accept user-edited proposals; no model content is trusted.
app.MapPost("/api/ai/plans/commit", async (
    AiPlanCommitRequest request, ClaimsPrincipal user, TaskDbContext db) =>
{
    if (!request.Confirm)
        return Results.BadRequest(new { Message = "Review and explicitly confirm the tasks first." });
    if (AiTaskBreakdown.ValidateItems(request.Tasks) is { } validation)
        return Results.BadRequest(new { Message = validation });
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    if (request.ProjectId.HasValue && !await db.TaskProjects.AsNoTracking().AnyAsync(p =>
        p.Id == request.ProjectId.Value && p.UserId == userId))
        return Results.NotFound();

    var created = request.Tasks!.Select(item => new TaskItem {
        Title = item.Title!.Trim(), Priority = item.Priority!,
        Category = item.Category!, UserId = userId,
        Completed = false, ProjectId = request.ProjectId,
        Notes = "", ChecklistJson = "[]"
    }).ToArray();
    await using var transaction = await db.Database.BeginTransactionAsync();
    db.Tasks.AddRange(created);
    await db.SaveChangesAsync();
    foreach (var task in created)
    {
        TaskActivityKinds.Record(db, userId, task.Id, TaskActivityKinds.Created);
        TaskVersionHistory.Add(db, task, "created");
    }
    await db.SaveChangesAsync();
    await transaction.CommitAsync();
    return Results.Ok(new { Tasks = created });
}).RequireAuthorization();

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
        !TaskChecklistValidation.IsValid(candidate.Checklist))
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
    if (notes.Length > 4000 || !TaskChecklistValidation.IsValid(checklist))
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