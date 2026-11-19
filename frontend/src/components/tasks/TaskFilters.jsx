import { TASK_CATEGORIES } from "./taskOptions.js";

const STATUS_OPTIONS = [
  { value: "all", label: "All tasks" },
  { value: "active", label: "In progress" },
  { value: "completed", label: "Completed" },
];

export default function TaskFilters({ filters, showStatus, defaultSortLabel }) {
  const { status, setStatus, search, setSearch, category, setCategory, sort, setSort } = filters;
  return (
    <div className="filters">
      {showStatus && <div className="status-filters" role="group" aria-label="Task status">
        {STATUS_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            className={status === option.value ? "filter active" : "filter"}
            aria-pressed={status === option.value}
            onClick={() => setStatus(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>}
      <div className="filter-options">
        <input
          className="search-input"
          type="search"
          placeholder="Search tasks…"
          value={search}
          onChange={event => setSearch(event.target.value)}
          aria-label="Search tasks"
        />
        <select className="filter-select" value={category} onChange={event => setCategory(event.target.value)} aria-label="Filter category">
          <option value="all">All categories</option>
          {TASK_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select className="filter-select" value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort tasks">
          <option value="default">{defaultSortLabel}</option>
          <option value="priority">Priority</option>
          <option value="dueDate">Due date</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>
    </div>
  );
}
