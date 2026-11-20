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
    public DbSet<NotificationPreferences> NotificationPreferences { get; set; }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<TaskItem>()
            .HasOne<ApplicationUser>()
            .WithMany()
            .HasForeignKey(task => task.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<NotificationPreferences>(entity =>
        {
            entity.HasKey(preference => preference.UserId);
            entity.Property(preference => preference.OverdueEnabled).HasDefaultValue(true);
            entity.Property(preference => preference.DueTodayEnabled).HasDefaultValue(true);
            entity.Property(preference => preference.UpcomingEnabled).HasDefaultValue(true);
            entity.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(preference => preference.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<TaskNotificationState>(entity =>
        {
            entity.HasKey(state => new { state.UserId, state.TaskId, state.Kind });
            entity.HasOne<TaskItem>().WithMany()
                .HasForeignKey(state => state.TaskId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}