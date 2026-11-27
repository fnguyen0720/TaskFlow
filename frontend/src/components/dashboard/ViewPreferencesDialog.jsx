import { useEffect, useRef, useState } from "react";
import { DASHBOARD_SECTIONS, DEFAULT_PREFERENCES } from "../../hooks/useViewPreferences.js";

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
  const [dashboardOrder, setDashboardOrder] = useState([...preferences.dashboardOrder]);
  const [dashboardHidden, setDashboardHidden] = useState([...preferences.dashboardHidden]);
  const [error, setError] = useState("");
  function move(index, delta) {
    setDashboardOrder(current => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function toggle(id) {
    setDashboardHidden(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

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
    if (!onSave({ density, landingView, dashboardOrder, dashboardHidden })) {
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
        <fieldset className="dashboard-preference-list">
          <legend>Dashboard sections</legend>
          <p>Choose what you see and move sections into your preferred order. Tasks always remain available.</p>
          {dashboardOrder.map((id, index) => {
            const label = DASHBOARD_SECTIONS.find(item => item[0] === id)[1];
            return <div className="dashboard-preference-row" key={id}>
              <label><input type="checkbox" checked={!dashboardHidden.includes(id)} onChange={() => toggle(id)} />{label}</label>
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${label} up`}>↑</button>
              <button type="button" disabled={index === dashboardOrder.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${label} down`}>↓</button>
            </div>;
          })}
          <button type="button" onClick={() => { setDashboardOrder([...DEFAULT_PREFERENCES.dashboardOrder]); setDashboardHidden([]); }}>Reset dashboard layout</button>
        </fieldset>
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
