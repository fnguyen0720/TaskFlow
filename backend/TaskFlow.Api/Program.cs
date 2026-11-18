
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
            .AllowAnyMethod();
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

    options.AddPolicy("authentication", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 20,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseRouting();
app.UseCors("Frontend");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// Grouping with an empty prefix preserves /register, /login, and all other
// standard Identity API routes while enforcing a shared auth request budget.
var identityEndpoints = app.MapGroup("");
identityEndpoints.RequireRateLimiting("authentication");
identityEndpoints.MapIdentityApi<ApplicationUser>();

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

// PUT: Toggle completion, but only for the owner's task.
app.MapPut("/api/tasks/{id}", async (
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

    task.Completed = !task.Completed;

    await db.SaveChangesAsync();

    return Results.Ok(task);
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