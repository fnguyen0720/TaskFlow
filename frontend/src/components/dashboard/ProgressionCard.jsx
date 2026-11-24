import { useEffect, useMemo, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5143";

// Read-only achievements: every task ID earns XP at most once, using server
// activity timestamps, not client-side counters or user-editable local state.
export default function ProgressionCard({ tasks, projects = [], token, onUnauthorized }) {
  const [state, setState] = useState({ token: null, status: "loading", data: null });
  const [expanded, setExpanded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const taskCompletionSignature = useMemo(() => tasks.map(task => `${task.id}:${task.completed}:${task.projectId ?? ""}`).sort().join("|"), [tasks]);
  const projectSignature = useMemo(() => projects.map(project => `${project.id}:${project.name}`).sort().join("|"), [projects]);
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    setState({ token, status: "loading", data: null });
    fetch(`${API}/api/analytics/progression`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
    }).then(async response => {
      if (response.status === 401) { unauthorizedRef.current?.(token); return null; }
      if (!response.ok) throw new Error("Could not load your progress.");
      return response.json();
    }).then(data => {
      if (controller.signal.aborted || data === null) return;
      // Allow the older API response during a staggered frontend/backend rollout.
      // The XP panel must remain usable while Render finishes deploying quests.
      const quests = data.projectQuests === undefined ? [] : data.projectQuests;
      if (data.basis !== "first-recorded-completion" ||
          !Number.isSafeInteger(data.level) || data.level < 1 ||
          !Number.isSafeInteger(data.xp) || data.xp < 0 ||
          !Number.isSafeInteger(data.levelStartXp) ||
          !Number.isSafeInteger(data.nextLevelXp) ||
          data.nextLevelXp <= data.levelStartXp ||
          !Array.isArray(data.achievements) || data.achievements.length > 10 ||
          data.achievements.some(item => typeof item.id !== "string" ||
            typeof item.name !== "string" || typeof item.unlocked !== "boolean") ||
          !data.challenge || !Number.isSafeInteger(data.challenge.progress) ||
          !Array.isArray(quests) || quests.length > 20 ||
          quests.some(project => !Number.isSafeInteger(project.projectId) ||
            typeof project.name !== "string" || !Number.isSafeInteger(project.totalTasks) ||
            !Number.isSafeInteger(project.completedTasks) ||
            project.completedTasks > project.totalTasks)) {
        throw new Error("Your progression data was invalid.");
      }
      setState({ token, status: "ready", data: {
        ...data, projectQuests: quests, totalProjects: data.totalProjects ?? 0
      } });
    }).catch(error => {
      if (!controller.signal.aborted)
        setState({ token, status: "error", data: null, error: error.message });
    });
    return () => controller.abort();
  }, [token, taskCompletionSignature, projectSignature, refresh]);

  const data = state.token === token && state.status === "ready" ? state.data : null;
  const progress = data
    ? Math.max(0, Math.min(100,
      (data.xp - data.levelStartXp) / (data.nextLevelXp - data.levelStartXp) * 100))
    : 0;
  return (
    <section className="progression-panel" aria-label="Progress and achievements">
      <header>
        <div>
          <span className="section-kicker">YOUR PROGRESS</span>
          <h2>Progress and achievements</h2>
          <p>Rewards for distinct recorded task completions, never repeated toggles.</p>
        </div>
        <div className="progression-actions">
          <button type="button" onClick={() => setRefresh(value => value + 1)}
            disabled={state.status === "loading"}>Refresh XP</button>
          <button type="button" aria-expanded={expanded} aria-controls="progression-details"
            onClick={() => setExpanded(value => !value)}>
            {expanded ? "Hide achievements" : "Show achievements"}
          </button>
        </div>
      </header>
      {!data && (state.token !== token || state.status === "loading")
        ? <p role="status">Loading progression…</p> :
        state.status === "error" && state.token === token
          ? <p role="alert">{state.error} <button type="button" onClick={() => setRefresh(x => x + 1)}>Retry</button></p> :
          data && <>
            <div className="progression-level">
              <div><strong>Level {data.level}</strong><span>{data.xp} XP · {data.uniqueCompletedTasks} different tasks completed</span></div>
              <span>{data.nextLevelXp - data.xp} XP to next level</span>
            </div>
            <div className="progression-track" role="progressbar" aria-label="Level progress"
              aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: progress + "%" }} />
            </div>
            {expanded && <div id="progression-details" className="progression-details">
              <section aria-label="Seven-day quest">
                <h3>Seven-day Quest</h3>
                <p>{data.challenge.description}</p>
                <div className="progression-quest">
                  <span>{data.challenge.progress} of {data.challenge.goal} completed</span>
                  <strong>{data.challenge.complete ? "Quest complete" : "Keep going at your own pace"}</strong>
                </div>
              </section>
              <section aria-label="Project quests">
                <h3>Project Quests</h3>
                <p>Finish work within each project. Moving tasks between projects updates progress, but never awards extra XP.</p>
                {data.projectQuests.length === 0 ?
                  <p className="progression-empty">Create a project to start a quest.</p> :
                  <ul className="progression-projects">
                    {data.projectQuests.map(project => {
                      const percent = project.totalTasks
                        ? Math.round(100 * project.completedTasks / project.totalTasks) : 0;
                      return <li key={project.projectId}>
                        <div className="progression-project-heading">
                          <strong>{project.name}</strong>
                          <span>{project.totalTasks === 0 ? "No tasks yet" :
                            project.complete ? "Quest complete!" :
                            `${project.completedTasks} / ${project.totalTasks} tasks`}</span>
                        </div>
                        <div className="progression-project-track" role="progressbar"
                          aria-label={`${project.name} completion`}
                          aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                          <span style={{ width: percent + "%" }} />
                        </div>
                      </li>;
                    })}
                  </ul>}
                {data.totalProjects > data.projectQuests.length &&
                  <p className="insights-note">Showing {data.projectQuests.length} of {data.totalProjects} projects.</p>}
              </section>
              <section aria-label="Achievements">
                <h3>Achievements</h3>
                <ul className="progression-awards">
                  {data.achievements.map(item => <li key={item.id} className={item.unlocked ? "progression-unlocked" : ""}>
                    <span aria-hidden="true">{item.unlocked ? "🏆" : "☆"}</span>
                    <div><strong>{item.name}</strong><p>{item.description}</p>
                      <small>{item.unlocked ? "Unlocked" : `${item.progress} / ${item.goal}`}</small>
                    </div>
                  </li>)}
                </ul>
              </section>
              <p className="insights-note">No leaderboard or streak penalties. Historical activity begins when TaskFlow started recording completions; deleted tasks keep earned credit.</p>
            </div>}
          </>}
    </section>
  );
}
