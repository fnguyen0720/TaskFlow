import { useEffect, useState } from "react";

export function useNotification() {
  const [notification, setNotification] = useState(null);
  const showNotification = (message, type = "success") => setNotification({ message, type });

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 3000);
    return () => clearTimeout(timer);
  }, [notification]);

  return { notification, setNotification, showNotification };
}
