const PRIMARY_ITEMS = [
  { id: "all", label: "All", glyph: "≡" },
  { id: "today", label: "Today", glyph: "◉" },
  { id: "upcoming", label: "Upcoming", glyph: "↗" },
  { id: "calendar", label: "Calendar", glyph: "▦" },
];

export default function MobileBottomNav({ view, onChangeView, onQuickCreate }) {
  function navigate(id) {
    if (onChangeView(id) === false) return;
    requestAnimationFrame(() => {
      document.querySelector('[aria-label="Task management"]')?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "start",
      });
    });
  }
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile quick navigation">
      {PRIMARY_ITEMS.map(item => (
        <button key={item.id} type="button" aria-current={view === item.id ? "page" : undefined}
          onClick={() => navigate(item.id)}>
          <span className="mobile-nav-icon" aria-hidden="true">{item.glyph}</span>
          <span>{item.label}</span>
        </button>
      ))}
      <button className="mobile-nav-create" type="button" onClick={onQuickCreate}
        aria-label="Quick add task">
        <span className="mobile-nav-icon" aria-hidden="true">＋</span>
        <span>Add</span>
      </button>
    </nav>
  );
}
