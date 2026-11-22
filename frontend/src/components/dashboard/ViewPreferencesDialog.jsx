import { useEffect, useRef, useState } from "react";

const VIEW_OPTIONS = [
  ["all", "All tasks"], ["today", "Today"], ["upcoming", "Upcoming"],
  ["calendar", "Calendar"], ["unscheduled", "Unscheduled"],
];

export default function ViewPreferencesDialog({ preferences, onSave, onClose }) {
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  const restoreFocus = useRef(null);
  const [density, setDensity] = useState(preferences.density);
  const [landingView, setLandingView] = useState(preferences.landingView);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    restoreFocus.current = document.activeElement;
    const onCancel = event => { event.preventDefault(); onClose(); };
    dialog.addEventListener("cancel", onCancel);
    dialog.showModal();
    headingRef.current?.focus();
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      const target = restoreFocus.current;
      if (target?.isConnected) target.focus();
    };
  }, [onClose]);

  const submit = event => {
    event.preventDefault();
    if (!onSave({ density, landingView })) {
      setError("Your browser could not save preferences. Check storage permissions and try again.");
      return;
    }
    onClose();
  };

  return (
    <dialog ref={dialogRef} className="view-settings-dialog" aria-labelledby="view-settings-title">
      <form onSubmit={submit} className="view-settings-form">
        <header className="view-settings-header">
          <div>
            <h2 id="view-settings-title" tabIndex={-1} ref={headingRef}>Workspace preferences</h2>
            <p>Choose how TaskFlow appears on this browser.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close workspace preferences">×</button>
        </header>
        <label>
          Task list density
          <select value={density} onChange={event => setDensity(event.target.value)}>
            <option value="comfortable">Comfortable — more spacing</option>
            <option value="compact">Compact — show more tasks</option>
          </select>
        </label>
        <label>
          Default view after sign-in
          <select value={landingView} onChange={event => setLandingView(event.target.value)}>
            {VIEW_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <p className="view-settings-note">Settings stay on this browser and are separate for each signed-in account. Changing the default view takes effect on your next sign-in.</p>
        {error && <p role="alert" className="view-settings-error">{error}</p>}
        <footer className="view-settings-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Save preferences</button>
        </footer>
      </form>
    </dialog>
  );
}
