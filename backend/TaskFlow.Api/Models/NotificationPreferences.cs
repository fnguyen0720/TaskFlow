// A user's notification filters. Email is deliberately not available until
// a verified sender, unsubscribe flow and background scheduler are configured.
public sealed class NotificationPreferences
{
    public string UserId { get; set; } = "";
    public bool OverdueEnabled { get; set; } = true;
    public bool DueTodayEnabled { get; set; } = true;
    public bool UpcomingEnabled { get; set; } = true;
}

public sealed record NotificationPreferencesUpdate(
    bool? OverdueEnabled,
    bool? DueTodayEnabled,
    bool? UpcomingEnabled);
