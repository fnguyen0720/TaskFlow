using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace TaskFlow.Api.Migrations.PostgreSql;
[DbContext(typeof(PostgreSqlTaskDbContext))]
[Migration("20261122190001_AddProjectsPostgres")]
public partial class AddProjectsPostgres : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "TaskProjects",
            columns: table => new
            {
                Id = table.Column<int>(type: "integer", nullable: false) .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                UserId = table.Column<string>(type: "text", nullable: false),
                Name = table.Column<string>(type: "text", nullable: false),
                CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_TaskProjects", x => x.Id);
                table.ForeignKey("FK_TaskProjects_AspNetUsers_UserId",
                    x => x.UserId, "AspNetUsers", "Id", onDelete: ReferentialAction.Cascade);
            });
        migrationBuilder.CreateIndex(name: "IX_TaskProjects_UserId_Name",
            table: "TaskProjects", columns: new[] { "UserId", "Name" });
        migrationBuilder.AddColumn<int>(name: "ProjectId", table: "Tasks",
            type: "integer", nullable: true);
        migrationBuilder.CreateIndex(name: "IX_Tasks_ProjectId",
            table: "Tasks", column: "ProjectId");
        migrationBuilder.AddForeignKey(name: "FK_Tasks_TaskProjects_ProjectId",
            table: "Tasks", column: "ProjectId", principalTable: "TaskProjects",
            principalColumn: "Id", onDelete: ReferentialAction.SetNull);
    }
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(name: "FK_Tasks_TaskProjects_ProjectId", table: "Tasks");
        migrationBuilder.DropIndex(name: "IX_Tasks_ProjectId", table: "Tasks");
        migrationBuilder.DropColumn(name: "ProjectId", table: "Tasks");
        migrationBuilder.DropTable(name: "TaskProjects");
    }
}
