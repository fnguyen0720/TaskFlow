export const defaultNotificationPreferences = Object.freeze({
  overdueEnabled: true, dueTodayEnabled: true, upcomingEnabled: true,
});

export function applyNotificationPreferences(notifications, preferences = defaultNotificationPreferences) {
  if (!preferences) return notifications;
  return notifications.filter(item => {
    if (item.kind === "overdue") return preferences.overdueEnabled !== false;
    if (item.kind === "due-today") return preferences.dueTodayEnabled !== false;
    if (item.kind === "upcoming") return preferences.upcomingEnabled !== false;
    return false;
  });
}
