using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

public class TaskDbContext : IdentityDbContext<ApplicationUser>
{
    public TaskDbContext(DbContextOptions<TaskDbContext> options)
        : base(options)
    {
    }

    public DbSet<TaskItem> Tasks { get; set; }
    public DbSet<TaskProject> TaskProjects { get; set; }
    public DbSet<TaskActivity> TaskActivities { get; set; }
    public DbSet<TaskVersion> TaskVersions { get; set; }
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

        builder.Entity<TaskProject>(entity =>
        {
            entity.HasKey(project => project.Id);
            entity.HasIndex(project => new { project.UserId, project.Name });
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(project => project.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
        builder.Entity<TaskItem>().HasOne<TaskProject>().WithMany()
            .HasForeignKey(task => task.ProjectId).OnDelete(DeleteBehavior.SetNull);

        builder.Entity<TaskVersion>(entity =>
        {
            entity.HasKey(version => version.Id);
            entity.HasIndex(version => new { version.UserId, version.TaskId, version.Id });
            entity.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(version => version.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<TaskActivity>(entity =>
        {
            entity.HasKey(activity => activity.Id);
            entity.HasIndex(activity => new { activity.UserId, activity.TaskId, activity.OccurredAt });
            entity.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(activity => activity.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

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