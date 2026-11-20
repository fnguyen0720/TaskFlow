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

// GET: Return only the logged-in user's tasks.
app.MapGet("/api/tasks", async (
    ClaimsPrincipal user,
    TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;

    return await db.Tasks
        .Where(t => t.UserId == userId)
        .OrderBy(t => t.Completed)
        .ThenBy(t =>
            t.Priority == "High" ? 1 :
            t.Priority == "Medium" ? 2 : 3
        )
        .ThenBy(t => t.DueDate == null)
        .ThenBy(t => t.DueDate)
        .ToListAsync();
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

    if (task.DueDate.HasValue)
    {
        task.DueDate = DateTime.SpecifyKind(
            task.DueDate.Value,
            DateTimeKind.Utc
        );
    }

    db.Tasks.Add(task);
    await db.SaveChangesAsync();

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

    if (task.Completed)
    {
        await db.Tasks.Where(t => t.Id == id && t.UserId == userId && t.Completed)
            .ExecuteUpdateAsync(update => update.SetProperty(t => t.Completed, false));
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
        db.Tasks.Add(TaskSchedule.NextOccurrence(task));
        await db.SaveChangesAsync();
    }
    await transaction.CommitAsync();
    return Results.Ok(await db.Tasks.AsNoTracking().FirstAsync(t => t.Id == id));
})
.RequireAuthorization();

// PUT: Edit a task only if it belongs to the current user.
app.MapPut("/api/tasks/{id}/title", async (
    int id,
    TaskItem updatedTask,
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

    var validationError = TaskInputValidator.Validate(updatedTask);
    if (validationError is not null)
    {
        return Results.BadRequest(validationError);
    }

    task.Title = updatedTask.Title.Trim();
    task.Priority = updatedTask.Priority;
    task.Category = updatedTask.Category;
    task.RecurrenceRule = updatedTask.RecurrenceRule;
    task.ReminderDaysBefore = updatedTask.ReminderDaysBefore;
    task.DueDate = updatedTask.DueDate.HasValue
    ? DateTime.SpecifyKind(
        updatedTask.DueDate.Value,
        DateTimeKind.Utc
    )
    : null;
    await db.SaveChangesAsync();

    return Results.Ok(task);
})
.RequireAuthorization();

// PUT: Save the owner's notes and checklist without changing task status.
app.MapPut("/api/tasks/{id}/details", async (
    int id,
    TaskDetailsUpdate details,
    ClaimsPrincipal user,
    TaskDbContext db) =>
{
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var task = await db.Tasks.FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
    if (task is null)
    {
        return Results.NotFound();
    }

    var notes = details.Notes ?? "";
    var checklist = details.Checklist ?? [];
    if (notes.Length > 4000 || checklist.Count > 30 ||
        checklist.Any(item => item is null || string.IsNullOrWhiteSpace(item.Text) || item.Text.Length > 160))
    {
        return Results.BadRequest("Notes are limited to 4,000 characters and checklists to 30 items of 160 characters each.");
    }

    if (details.UpdateDueDate)
    {
        task.DueDate = details.DueDate?.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    }
    task.Notes = notes;
    task.ChecklistJson = JsonSerializer.Serialize(checklist.Select(item => item! with { Text = item!.Text.Trim() }));
    await db.SaveChangesAsync();
    return Results.Ok(task);
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

    task.DueDate = update.DueDate?.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    await db.SaveChangesAsync();
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

    var expectedUtc = expected.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    var target = expected == DateOnly.MaxValue
        ? ownedTask.Where(t => t.DueDate >= expectedUtc)
        : ownedTask.Where(t => t.DueDate >= expectedUtc && t.DueDate < expectedUtc.AddDays(1));

    var dueDate = update.DueDate?.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    var updated = await target.ExecuteUpdateAsync(setters => setters.SetProperty(t => t.DueDate, dueDate));
    if (updated == 0)
    {
        return await ownedTask.AnyAsync() ? Results.Conflict() : Results.NotFound();
    }

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