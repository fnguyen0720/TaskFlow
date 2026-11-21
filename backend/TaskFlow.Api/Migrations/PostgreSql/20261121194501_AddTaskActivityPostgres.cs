using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations.PostgreSql;

[DbContext(typeof(PostgreSqlTaskDbContext))]
[Migration("20261121194501_AddTaskActivityPostgres")]
public partial class AddTaskActivityPostgres : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "TaskActivities",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false) .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                UserId = table.Column<string>(type: "text", nullable: false),
                TaskId = table.Column<int>(type: "integer", nullable: false),
                Kind = table.Column<string>(type: "text", nullable: false),
                OccurredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
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
