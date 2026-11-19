using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations.PostgreSql;

[DbContext(typeof(PostgreSqlTaskDbContext))]
[Migration("20261119210001_AddRecurrenceAndRemindersPostgres")]
public partial class AddRecurrenceAndRemindersPostgres : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "RecurrenceRule", table: "Tasks",
            type: "text", nullable: false, defaultValue: "None");
        migrationBuilder.AddColumn<int>(
            name: "ReminderDaysBefore", table: "Tasks",
            type: "integer", nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "ReminderDaysBefore", table: "Tasks");
        migrationBuilder.DropColumn(name: "RecurrenceRule", table: "Tasks");
    }
}
