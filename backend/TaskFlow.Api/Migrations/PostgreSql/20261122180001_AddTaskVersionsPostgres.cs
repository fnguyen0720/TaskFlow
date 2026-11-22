using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations.PostgreSql;

[DbContext(typeof(PostgreSqlTaskDbContext))]
[Migration("20261122180001_AddTaskVersionsPostgres")]
public partial class AddTaskVersionsPostgres : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "TaskVersions",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false) .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                UserId = table.Column<string>(type: "text", nullable: false),
                TaskId = table.Column<int>(type: "integer", nullable: false),
                Kind = table.Column<string>(type: "text", nullable: false),
                RecordedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                Fingerprint = table.Column<string>(type: "text", nullable: false),
                SnapshotJson = table.Column<string>(type: "text", nullable: false)
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
