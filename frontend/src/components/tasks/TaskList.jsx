import { useState } from "react";
import TaskItem from "./TaskItem.jsx";

export default function TaskList({ data, editing, actions, viewEmptyMessage }) {
  const { tasks, filteredTasks, loading, error, loadingTask, readStatus } = data;
  const [visibleCount, setVisibleCount] = useState(50);
  const visibleTasks = filteredTasks.slice(0, visibleCount);

  return (
    <>
      {(loading || readStatus === "pending") && !error && (
        <div className="status-message" role="status">
          <div className="spinner" /><p>Loading tasks…</p>
        </div>
      )}
      {!loading && !error && readStatus !== "pending" && filteredTasks.length === 0 && (
        <div className="empty-state">
          <p>{viewEmptyMessage ?? (tasks.length === 0 ? "Your space is ready." : "No tasks found.")}</p>
          {!viewEmptyMessage && <span>{tasks.length === 0 ? "Add your first task above to get started." : "Try adjusting your filters or search."}</span>}
        </div>
      )}
      {!loading && !error && readStatus !== "pending" && (
        <div className="task-list" role="list" aria-label="Tasks">
          {visibleTasks.map(task => (
            <TaskItem key={task.id} task={task} editing={editing} loadingTask={loadingTask} actions={actions} />
          ))}
        </div>
      )}
      {!loading && !error && readStatus === "loaded" && filteredTasks.length > 50 && (
        <div className="task-page-controls" role="status">
          <span>Showing {visibleTasks.length} of {filteredTasks.length} tasks</span>
          {visibleCount < filteredTasks.length && (
            <button type="button" onClick={() => setVisibleCount(count => count + 50)}>
              Show more tasks
            </button>
          )}
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
