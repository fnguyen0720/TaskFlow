
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
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

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        var allowedOrigins = new List<string>
        {
            "http://localhost:5173"
        };

        var frontendUrl =
            builder.Configuration["FrontendUrl"];

        if (!string.IsNullOrWhiteSpace(frontendUrl))
        {
            allowedOrigins.Add(frontendUrl);
        }

        policy
            .WithOrigins(allowedOrigins.ToArray())
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapIdentityApi<ApplicationUser>();

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
    if (string.IsNullOrWhiteSpace(task.Title))
    {
        return Results.BadRequest("Task title cannot be empty.");
    }

    if (task.Title.Length > 100)
    {
        return Results.BadRequest(
            "Task title cannot exceed 100 characters."
        );
    }

    if (
        task.Priority != "Low" &&
        task.Priority != "Medium" &&
        task.Priority != "High"
    )
    {
        return Results.BadRequest(
            "Priority must be Low, Medium, or High."
        );
    }

    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;

    // Never trust a UserId supplied by the frontend.
    task.UserId = userId;

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

    if (string.IsNullOrWhiteSpace(updatedTask.Title))
    {
        return Results.BadRequest("Task title cannot be empty.");
    }

    if (updatedTask.Title.Length > 100)
    {
        return Results.BadRequest(
            "Task title cannot exceed 100 characters."
        );
    }

    if (
        updatedTask.Priority != "Low" &&
        updatedTask.Priority != "Medium" &&
        updatedTask.Priority != "High"
    )
    {
        return Results.BadRequest(
            "Priority must be Low, Medium, or High."
        );
    }

    task.Title = updatedTask.Title;
    task.Priority = updatedTask.Priority;
    task.Category = updatedTask.Category;
    task.DueDate = updatedTask.DueDate;

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