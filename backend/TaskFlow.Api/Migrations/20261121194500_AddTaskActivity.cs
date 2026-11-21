using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations;

[DbContext(typeof(TaskDbContext))]
[Migration("20261121194500_AddTaskActivity")]
public partial class AddTaskActivity : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "TaskActivities",
            columns: table => new
            {
                Id = table.Column<long>(type: "INTEGER", nullable: false) .Annotation("Sqlite:Autoincrement", true),
                UserId = table.Column<string>(type: "TEXT", nullable: false),
                TaskId = table.Column<int>(type: "INTEGER", nullable: false),
                Kind = table.Column<string>(type: "TEXT", nullable: false),
                OccurredAt = table.Column<DateTime>(type: "TEXT", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_TaskActivities", x => x.Id);
                table.ForeignKey("FK_TaskActivities_AspNetUsers_UserId",
                    x => x.UserId, "AspNetUsers", "Id", onDelete: ReferentialAction.Cascade);
            });
        migrationBuilder.CreateIndex(
            name: "IX_TaskActivities_UserId_TaskId_OccurredAt",
            table: "TaskActivities",
            columns: new[] { "UserId", "TaskId", "OccurredAt" });
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "TaskActivities");
}
