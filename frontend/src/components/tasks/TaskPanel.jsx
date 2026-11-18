import { formatDueDate, getDueDateClass } from "../../utils/taskUtils.js";

export default function TaskPanel({ totalCount, addTask, newTask, setNewTask, newPriority, setNewPriority, newCategory, setNewCategory, newDueDate, setNewDueDate, addingTask, filter, setFilter, search, setSearch, categoryFilter, setCategoryFilter, sort, setSort, loading, error, filteredTasks, tasks, editingId, loadingTask, toggleTask, editTitle, setEditTitle, editPriority, setEditPriority, editCategory, setEditCategory, editDueDate, setEditDueDate, editTask, setEditingId, startEditing, deleteTask, retryFetchTasks }) {
  return (
      <section className="task-panel">
        <div className="panel-heading"><div><span className="section-kicker">STAY ON TOP OF IT</span><h2>Your tasks</h2><p className="panel-subtitle">{totalCount} {totalCount === 1 ? "task" : "tasks"} in your workspace</p></div></div>
        <form onSubmit={addTask} className="task-form" aria-label="Add a new task">
          <input type="text" placeholder="What would you like to get done?" value={newTask} onChange={(e) => setNewTask(e.target.value)} aria-label="New task title" maxLength={100} />
          <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)} aria-label="Priority"><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select>
          <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} aria-label="Category"><option value="General">General</option><option value="Work">Work</option><option value="Study">Study</option><option value="Personal">Personal</option></select>
          <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} aria-label="Due date" />
          <button type="submit" disabled={addingTask || !newTask.trim()}>{addingTask ? "Adding…" : "＋ Add task"}</button>
        </form>
        <div className="filters">
          <div className="status-filters" role="group" aria-label="Task status">{["all","active","completed"].map((value) => <button key={value} className={filter === value ? "filter active" : "filter"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All tasks" : value === "active" ? "In progress" : "Completed"}</button>)}</div>
          <div className="filter-options">
            <input className="search-input" type="search" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tasks" />
            <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter category"><option value="all">All categories</option><option value="General">General</option><option value="Work">Work</option><option value="Study">Study</option><option value="Personal">Personal</option></select>
            <select className="filter-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort tasks"><option value="default">Default</option><option value="priority">Priority</option><option value="dueDate">Due date</option><option value="newest">Newest</option><option value="oldest">Oldest</option></select>
          </div>
        </div>
        {loading && <div className="status-message" role="status"><div className="spinner" /><p>Loading tasks…</p></div>}
        {!loading && !error && filteredTasks.length === 0 && <div className="empty-state"><p>{tasks.length === 0 ? "Your space is ready." : "No tasks found."}</p><span>{tasks.length === 0 ? "Add your first task above to get started." : "Try adjusting your filters or search."}</span></div>}
        {!loading && !error && <div className="task-list" role="list" aria-label="Tasks">{filteredTasks.map((task) => <div key={task.id} role="listitem" className={"task " + (task.completed ? "completed " : "") + (editingId === task.id ? "editing" : "")}>
          <button className="complete-button" disabled={loadingTask?.id === task.id} onClick={() => toggleTask(task.id)} aria-label={`${task.completed ? "Mark incomplete" : "Mark complete"}: ${task.title}`}>{loadingTask?.id === task.id && loadingTask?.action === "toggle" ? "…" : task.completed ? "✓" : ""}</button>
          {editingId === task.id ? <div className="edit-container">
            <input className="edit-input" type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} autoFocus aria-label={`Edit title for ${task.title}`} maxLength={100} />
            <div className="edit-options"><select className="edit-priority" aria-label={`Priority for ${task.title}`} value={editPriority} onChange={(e) => setEditPriority(e.target.value)}><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select>
              <select className="edit-category" aria-label={`Category for ${task.title}`} value={editCategory} onChange={(e) => setEditCategory(e.target.value)}><option value="General">General</option><option value="Work">Work</option><option value="Study">Study</option><option value="Personal">Personal</option></select>
              <input className="edit-due-date" type="date" aria-label={`Due date for ${task.title}`} value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
              <button className="save-button" disabled={!editTitle.trim() || loadingTask?.id === task.id} aria-label={`Save changes to ${task.title}`} onClick={() => editTask(task.id)}>Save</button>
              <button className="cancel-button" aria-label={`Cancel editing ${task.title}`} onClick={() => {setEditingId(null);setEditTitle("");setEditPriority("Medium");setEditCategory("General");setEditDueDate("");}}>Cancel</button></div>
          </div> : <>
            <span className="task-title">{task.title}</span>
            {task.dueDate && <span className={"task-due-date " + getDueDateClass(task.dueDate)}>{formatDueDate(task.dueDate)}</span>}
            <span className={"priority priority-" + (task.priority || "medium").toLowerCase()}>{task.priority || "Medium"}</span>
            <span className="category">{task.category || "General"}</span>
            <button className="edit-button" aria-label={`Edit ${task.title}`} disabled={loadingTask?.id === task.id} onClick={() => startEditing(task)}>Edit</button>
            <button className="delete-button" aria-label={`Delete ${task.title}`} disabled={loadingTask?.id === task.id} onClick={() => deleteTask(task.id)}>{loadingTask?.id === task.id && loadingTask?.action === "delete" ? "Deleting…" : "Delete"}</button>
          </>}
        </div>)}</div>}
        {error && <div className="status-message error-message" role="alert"><p>{error}</p><button className="retry-button" onClick={retryFetchTasks}>Try again</button></div>}
      </section>
  );
}
