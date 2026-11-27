import { useEffect, useRef, useState } from "react";

// A local focus session. The timer never modifies a task, creates a background
// job, or persists focus time. Completion uses the ordinary authenticated task
// toggle and its existing prerequisite / conflict checks.
export default function FocusMode({ task, loadingTask, onClose, onComplete, onOpenDetails }) {
  const dialog = useRef(null);
  const heading = useRef(null);
  const previousFocus = useRef(null);
  const [minutes, setMinutes] = useState(25);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const deadline = useRef(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    previousFocus.current = document.activeElement;
    element?.showModal();
    heading.current?.focus();
    return () => {
      if (element?.open) element.close();
      const old = previousFocus.current;
      if (old?.isConnected) old.focus();
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) {
        setRunning(false);
        setFinished(true);
      }
    };
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [running]);

  function startPause() {
    if (running) {
      setRemaining(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
      setRunning(false);
    } else if (remaining > 0) {
      deadline.current = Date.now() + remaining * 1000;
      setFinished(false);
      setRunning(true);
    }
  }
  function chooseDuration(next) {
    if (running) return;
    setMinutes(next);
    setRemaining(next * 60);
    setFinished(false);
  }
  function reset() {
    setRunning(false);
    setRemaining(minutes * 60);
    setFinished(false);
  }

  const busy = loadingTask?.id === task.id;
  const completed = task.completed && !busy;
  const steps = task.checklist ?? [];
  const checked = steps.filter(step => step.completed).length;

  return <dialog ref={dialog} className="focus-dialog" aria-labelledby="focus-heading"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="focus-inner">
      <header className="focus-heading">
        <span className="focus-eyebrow">FOCUS MODE</span>
        <button type="button" className="focus-close" onClick={onClose} aria-label="Close focus mode">×</button>
      </header>
      <h2 id="focus-heading" tabIndex={-1} ref={heading}>{task.title}</h2>
      <p className="focus-description">One task at a time. Your timer stays in this browser.</p>
      {completed && <p role="status" className="focus-complete-note">✓ Task complete. Nice work!</p>}
      <div className="focus-timer" aria-label="Focus timer">
        <span className="focus-time" role="timer" aria-label="Time remaining">
          {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
        </span>
        <span className="focus-time-caption">{finished ? "Session finished" : running ? "Stay with it" : "Ready when you are"}</span>
      </div>
      <div className="focus-duration" aria-label="Focus duration" role="group">
        {[15,25].map(value => <button type="button" key={value} aria-pressed={minutes === value}
          disabled={running} onClick={() => chooseDuration(value)}>{value} min</button>)}
      </div>
      <div className="focus-controls">
        <button type="button" className="focus-primary" disabled={remaining === 0}
          onClick={startPause}>{running ? "Pause" : "Start focus"}</button>
        <button type="button" onClick={reset}>Reset</button>
      </div>
      {steps.length > 0 && <section className="focus-checklist" aria-label="Task checklist">
        <div className="focus-checklist-header"><strong>Checklist</strong><span>{checked}/{steps.length} completed</span></div>
        <ul>{steps.map((step, index) => <li key={step.id ?? index}>
          <span aria-hidden="true">{step.completed ? "✓" : "○"}</span>
          <span className={step.completed ? "is-done" : ""}>{step.text}</span>
        </li>)}</ul>
        <p>Open task details to edit checklist items.</p>
      </section>}
      <div className="focus-actions">
        <button type="button" onClick={onOpenDetails}>Open task details</button>
        <button type="button" className="focus-finish" disabled={busy || task.completed}
          onClick={() => onComplete(task.id)}>
          {busy ? "Saving…" : completed ? "Completed" : "Mark task complete"}
        </button>
      </div>
      <p className="focus-footnote">Pausing, closing or resetting a session does not change your tasks.</p>
    </div>
  </dialog>;
}
