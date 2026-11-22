using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace TaskFlow.Api.Migrations;
[DbContext(typeof(TaskDbContext))]
[Migration("20261122230000_AddTaskDependencies")]
public partial class AddTaskDependencies : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable("TaskDependencies", columns: table => new
        {
            TaskId = table.Column<int>(type: "INTEGER", nullable: false),
            DependsOnTaskId = table.Column<int>(type: "INTEGER", nullable: false)
        }, constraints: table => {
            table.PrimaryKey("PK_TaskDependencies", x => new { x.TaskId, x.DependsOnTaskId });
            table.ForeignKey("FK_TaskDependencies_Tasks_TaskId", x => x.TaskId,
                "Tasks", "Id", onDelete: ReferentialAction.Cascade);
            table.ForeignKey("FK_TaskDependencies_Tasks_DependsOnTaskId", x => x.DependsOnTaskId,
                "Tasks", "Id", onDelete: ReferentialAction.Cascade);
            table.CheckConstraint("CK_TaskDependencies_NoSelf", "TaskId <> DependsOnTaskId");
        });
        migrationBuilder.CreateIndex("IX_TaskDependencies_DependsOnTaskId",
            "TaskDependencies", "DependsOnTaskId");
    }
    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable("TaskDependencies");
}
