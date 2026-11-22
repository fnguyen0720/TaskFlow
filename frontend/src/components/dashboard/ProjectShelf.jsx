import { useState } from "react";

// Projects are optional groups, never a replacement for global task views.
export default function ProjectShelf({ projects, tasks, selection, onSelect, onCreate, onRename, creating, renamingId }) {
  const [newName, setNewName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editName, setEditName] = useState("");
  const submit = async event => {
    event.preventDefault();
    if (await onCreate(newName)) setNewName("");
  };
  const rename = async event => {
    event.preventDefault();
    if (await onRename(editingProjectId, editName)) {
      setEditingProjectId(null);
      setEditName("");
    }
  };
  const selectedProject = projects.find(project => String(project.id) === selection);
  const options = [
    { id: "all", name: "All projects" },
    { id: "none", name: "No project" },
    ...projects.map(project => ({ id: String(project.id), name: project.name }))
  ];

  return (
    <section className="project-shelf" aria-label="Projects">
      <div className="project-shelf-heading">
        <div><h2>Projects</h2><p>Group related tasks and track progress.</p></div>
      </div>
      <div className="project-shelf-tabs" role="group" aria-label="Filter by project">
        {options.map(project => {
          const related = project.id === "all" ? tasks :
            project.id === "none" ? tasks.filter(task => task.projectId == null) :
              tasks.filter(task => String(task.projectId) === project.id);
          const complete = related.filter(task => task.completed).length;
          return (
            <button key={project.id} type="button" aria-pressed={selection === project.id}
              className={selection === project.id ? "project-filter selected" : "project-filter"}
              onClick={() => { setEditingProjectId(null); onSelect(project.id); }}>
              <strong>{project.name}</strong>
              <span>{complete}/{related.length} complete</span>
              <span className="project-progress-track" aria-hidden="true">
                <span style={{ width: `${related.length ? complete / related.length * 100 : 0}%` }} />
              </span>
            </button>
          );
        })}
      </div>
      {selectedProject && <div className="project-manage">
        {editingProjectId === selectedProject.id ? (
          <form onSubmit={rename} className="project-rename-form">
            <label htmlFor="project-rename-input">Project name</label>
            <input id="project-rename-input" maxLength={70} required value={editName}
              disabled={renamingId != null} onChange={event => setEditName(event.target.value)} />
            <button type="submit" disabled={renamingId != null || !editName.trim() ||
              editName.trim() === selectedProject.name}>
              {renamingId != null ? "Saving…" : "Save name"}
            </button>
            <button type="button" disabled={renamingId != null} onClick={() => setEditingProjectId(null)}>
              Cancel
            </button>
          </form>
        ) : (
          <button className="project-rename-toggle" type="button" onClick={() => {
            setEditName(selectedProject.name);
            setEditingProjectId(selectedProject.id);
          }}>Rename project</button>
        )}
      </div>}
      <form onSubmit={submit} className="project-create-form">
        <label htmlFor="project-new-name">New project</label>
        <input id="project-new-name" value={newName} maxLength={70} disabled={creating}
          onChange={event => setNewName(event.target.value)} placeholder="e.g. Career development" />
        <button type="submit" disabled={creating || !newName.trim()}>
          {creating ? "Creating…" : "Create project"}
        </button>
      </form>
    </section>
  );
}
