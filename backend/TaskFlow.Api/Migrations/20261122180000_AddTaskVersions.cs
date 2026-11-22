using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations;

[DbContext(typeof(TaskDbContext))]
[Migration("20261122180000_AddTaskVersions")]
public partial class AddTaskVersions : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "TaskVersions",
            columns: table => new
            {
                Id = table.Column<long>(type: "INTEGER", nullable: false) .Annotation("Sqlite:Autoincrement", true),
                UserId = table.Column<string>(type: "TEXT", nullable: false),
                TaskId = table.Column<int>(type: "INTEGER", nullable: false),
                Kind = table.Column<string>(type: "TEXT", nullable: false),
                RecordedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                Fingerprint = table.Column<string>(type: "TEXT", nullable: false),
                SnapshotJson = table.Column<string>(type: "TEXT", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_TaskVersions", x => x.Id);
                table.ForeignKey("FK_TaskVersions_AspNetUsers_UserId",
                    x => x.UserId, "AspNetUsers", "Id", onDelete: ReferentialAction.Cascade);
            });
        migrationBuilder.CreateIndex(
            name: "IX_TaskVersions_UserId_TaskId_Id",
            table: "TaskVersions",
            columns: new[] { "UserId", "TaskId", "Id" });
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "TaskVersions");
}
