import { useEffect, useRef, useState } from "react";

const STEPS = [
  { icon: "＋", title: "Add your first task", text: "Type a task name and tap Add. More options are there only when you need them." },
  { icon: "✓", title: "Mark it done", text: "Tap the square beside a task when it's finished. Your progress updates automatically." },
  { icon: "▦", title: "Find your day", text: "Use Today, Upcoming, or Calendar to see what matters next." },
];

export default function QuickTour({ onClose }) {
  const [step, setStep] = useState(0);
  const dialog = useRef(null);
  const lastFocus = useRef(null);
  useEffect(() => {
    lastFocus.current = document.activeElement;
    dialog.current?.querySelector("button")?.focus();
    const onKeyDown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const buttons = [...dialog.current.querySelectorAll("button:not([disabled])")];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      lastFocus.current?.focus?.();
    };
  }, [onClose]);

  const current = STEPS[step];
  return (
    <div className="quick-tour-backdrop">
      <section className="quick-tour" role="dialog" aria-modal="true"
        aria-labelledby="quick-tour-title" aria-describedby="quick-tour-description" ref={dialog}>
        <div className="quick-tour-top">
          <span className="quick-tour-count">Quick tour · {step + 1} of {STEPS.length}</span>
          <button type="button" className="quick-tour-close" onClick={onClose} aria-label="Close quick tour">×</button>
        </div>
        <div className="quick-tour-illustration" aria-hidden="true">{current.icon}</div>
        <h2 id="quick-tour-title">{current.title}</h2>
        <p id="quick-tour-description">{current.text}</p>
        <div className="quick-tour-dots" aria-label="Tour progress">
          {STEPS.map((item, index) => (
            <span key={item.title} className={index === step ? "active" : ""}
              aria-label={`Step ${index + 1}${index === step ? ", current" : ""}`} />
          ))}
        </div>
        <div className="quick-tour-actions">
          <button type="button" className="quick-tour-secondary"
            onClick={step ? () => setStep(value => value - 1) : onClose}>{step ? "Back" : "Skip"}</button>
          <button type="button" className="quick-tour-primary"
            onClick={step === STEPS.length - 1 ? onClose : () => setStep(value => value + 1)}>
            {step === STEPS.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </section>
    </div>
  );
}
