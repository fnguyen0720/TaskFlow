export default function DashboardHeader({ logout }) {
  return (
    <>
      <header className="dashboard-header">
        <div><div className="brand-kicker">YOUR PERSONAL WORKSPACE</div><h1>TaskFlow<span className="brand-period">.</span></h1><p className="subtitle">A little progress each day adds up to big results.</p></div>
        <button className="logout-button" onClick={logout}>Log out ↗</button>
      </header>
    </>
  );
}
