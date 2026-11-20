using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations.PostgreSql;

[DbContext(typeof(PostgreSqlTaskDbContext))]
[Migration("20261120150001_AddNotificationPreferencesPostgres")]
public partial class AddNotificationPreferencesPostgres : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "NotificationPreferences",
            columns: table => new
            {
                UserId = table.Column<string>(type: "text", nullable: false),
                OverdueEnabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                DueTodayEnabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                UpcomingEnabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_NotificationPreferences", x => x.UserId);
                table.ForeignKey("FK_NotificationPreferences_AspNetUsers_UserId",
                    x => x.UserId, "AspNetUsers", "Id", onDelete: ReferentialAction.Cascade);
            });
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "NotificationPreferences");
}
