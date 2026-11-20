import { useEffect, useMemo, useRef, useState } from "react";

const VIEWS = [
  { id: "all", label: "All tasks" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "calendar", label: "Calendar" },
  { id: "unscheduled", label: "Unscheduled" },
];

export default function CommandPalette({ tasks, onClose, onOpenTask, onChangeView, onQuickCreate }) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const previousFocus = useRef(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const actions = [
      { key: "create", label: "Create a new task", description: "Focus the task creation form", kind: "create" },
      ...VIEWS.map(view => ({ key: "view-" + view.id, label: "Go to " + view.label, description: "Switch task view", kind: "view", value: view.id })),
    ];
    const taskResults = tasks.map(task => ({
      key: "task-" + task.id,
      label: task.title,
      description: [task.priority, task.category, task.completed ? "Completed" : "Active"].filter(Boolean).join(" · "),
      kind: "task",
      value: task.id,
    }));
    if (!term) return [...actions, ...taskResults.slice(0, 8)];
    const matches = entry => (entry.label + " " + entry.description).toLocaleLowerCase().includes(term);
    return [...actions.filter(matches), ...taskResults.filter(matches).slice(0, 12)];
  }, [query, tasks]);

  // Native dialog provides focus containment and inert background controls.
  useEffect(() => {
    const dialog = dialogRef.current;
    previousFocus.current = document.activeElement;
    dialog.showModal();
    searchRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      previousFocus.current?.focus?.();
    };
  }, []);

  function choose(entry) {
    let accepted = true;
    if (entry.kind === "task") accepted = onOpenTask(entry.value);
    if (entry.kind === "view") accepted = onChangeView(entry.value);
    if (entry.kind === "create") accepted = onQuickCreate();
    if (accepted !== false) onClose();
  }

  function onKeys(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(index => results.length ? (index + 1) % results.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(index => results.length ? (index - 1 + results.length) % results.length : 0);
    } else if (event.key === "Enter" && results.length) {
      event.preventDefault();
      choose(results[Math.min(activeIndex, results.length - 1)]);
    }
  }

  return (
    <dialog ref={dialogRef} className="command-palette" aria-labelledby="command-palette-title"
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="command-palette-heading">
        <strong id="command-palette-title">Search and commands</strong>
        <button type="button" onClick={onClose} aria-label="Close command palette">Esc ×</button>
      </div>
      <input ref={searchRef} type="text" value={query}
        onChange={event => { setQuery(event.target.value); setActiveIndex(0); }}
        onKeyDown={onKeys} aria-label="Search tasks and commands" aria-controls="command-results"
        aria-activedescendant={results.length ? "command-option-" + Math.min(activeIndex, results.length - 1) : undefined}
        role="combobox" aria-expanded="true" aria-autocomplete="list"
        placeholder="Search tasks or type a command…" autoComplete="off" />
      <div id="command-results" role="listbox" aria-label="Command results" className="command-results">
        {results.length ? results.map((entry, index) => (
          <button key={entry.key} id={"command-option-" + index} type="button" role="option"
            aria-selected={index === activeIndex}
            className={"command-option" + (index === activeIndex ? " active" : "")}
            onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(entry)}>
            <span className="command-option-kind" aria-hidden="true">{entry.kind === "task" ? "☐" : entry.kind === "view" ? "↗" : "+"}</span>
            <span className="command-option-copy"><strong>{entry.label}</strong><small>{entry.description}</small></span>
          </button>
        )) : <p className="command-empty" role="status">No matching tasks or commands.</p>}
      </div>
      <p className="command-hint">↑ ↓ Navigate · Enter Select · Esc Close</p>
    </dialog>
  );
}
