using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations;

[DbContext(typeof(TaskDbContext))]
[Migration("20261119210000_AddRecurrenceAndReminders")]
public partial class AddRecurrenceAndReminders : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "RecurrenceRule", table: "Tasks",
            type: "TEXT", nullable: false, defaultValue: "None");
        migrationBuilder.AddColumn<int>(
            name: "ReminderDaysBefore", table: "Tasks",
            type: "INTEGER", nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "ReminderDaysBefore", table: "Tasks");
        migrationBuilder.DropColumn(name: "RecurrenceRule", table: "Tasks");
    }
}
