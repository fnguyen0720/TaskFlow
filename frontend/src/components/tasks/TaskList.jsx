import TaskItem from "./TaskItem.jsx";

export default function TaskList({ data, editing, actions, viewEmptyMessage }) {
  const { tasks, filteredTasks, loading, error, loadingTask } = data;

  return (
    <>
      {loading && (
        <div className="status-message" role="status">
          <div className="spinner" /><p>Loading tasks…</p>
        </div>
      )}
      {!loading && !error && filteredTasks.length === 0 && (
        <div className="empty-state">
          <p>{viewEmptyMessage ?? (tasks.length === 0 ? "Your space is ready." : "No tasks found.")}</p>
          {!viewEmptyMessage && <span>{tasks.length === 0 ? "Add your first task above to get started." : "Try adjusting your filters or search."}</span>}
        </div>
      )}
      {!loading && !error && (
        <div className="task-list" role="list" aria-label="Tasks">
          {filteredTasks.map(task => (
            <TaskItem key={task.id} task={task} editing={editing} loadingTask={loadingTask} actions={actions} />
          ))}
        </div>
      )}
      {error && (
        <div className="status-message error-message" role="alert">
          <p>{error}</p>
          <button type="button" className="retry-button" onClick={actions.retry}>Try again</button>
        </div>
      )}
    </>
  );
}
