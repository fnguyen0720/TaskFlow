using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Data.Sqlite;

public class CustomWebApplicationFactory
    : WebApplicationFactory<Program>
{
    private SqliteConnection? _connection;

    public async Task InitializeDatabaseAsync()
    {
        using var scope = Services.CreateScope();

        var db = scope.ServiceProvider
            .GetRequiredService<TaskDbContext>();

        await db.Database.EnsureCreatedAsync();
    }
    protected override void ConfigureWebHost(
        IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<
                DbContextOptions<TaskDbContext>>();

            services.RemoveAll<TaskDbContext>();

            _connection = new SqliteConnection(
                "Data Source=:memory:");

            _connection.Open();

            services.AddDbContext<TaskDbContext>(options =>
                options.UseSqlite(_connection));
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        if (disposing)
        {
            _connection?.Dispose();
        }
    }
}