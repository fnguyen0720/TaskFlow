using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations;

[DbContext(typeof(TaskDbContext))]
[Migration("20261119230000_AddNotificationStates")]
public partial class AddNotificationStates : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "TaskNotificationStates",
            columns: table => new
            {
                UserId = table.Column<string>(type: "TEXT", nullable: false),
                TaskId = table.Column<int>(type: "INTEGER", nullable: false),
                Kind = table.Column<string>(type: "TEXT", nullable: false),
                IsRead = table.Column<bool>(type: "INTEGER", nullable: false),
                IsDismissed = table.Column<bool>(type: "INTEGER", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_TaskNotificationStates", x => new { x.UserId, x.TaskId, x.Kind });
                table.ForeignKey("FK_TaskNotificationStates_Tasks_TaskId",
                    x => x.TaskId, "Tasks", "Id", onDelete: ReferentialAction.Cascade);
            });
        migrationBuilder.CreateIndex(
            name: "IX_TaskNotificationStates_TaskId",
            table: "TaskNotificationStates", column: "TaskId");
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "TaskNotificationStates");
}
