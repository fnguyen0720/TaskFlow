using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

public class TaskDbContext : IdentityDbContext<ApplicationUser>
{
    public TaskDbContext(DbContextOptions<TaskDbContext> options)
        : base(options)
    {
    }

    public DbSet<TaskItem> Tasks { get; set; }
    public DbSet<TaskNotificationState> TaskNotificationStates { get; set; }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<TaskItem>()
            .HasOne<ApplicationUser>()
            .WithMany()
            .HasForeignKey(task => task.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<TaskNotificationState>(entity =>
        {
            entity.HasKey(state => new { state.UserId, state.TaskId, state.Kind });
            entity.HasOne<TaskItem>().WithMany()
                .HasForeignKey(state => state.TaskId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}