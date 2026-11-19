import { Component } from "react";
import { reportDiagnostic } from "../utils/diagnostics.js";

export default class DiagnosticErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // React Error details often include user content: never send them.
    reportDiagnostic("react_render", "ui");
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="app" role="alert">
          <h1>TaskFlow</h1>
          <p>Something went wrong. Reload the page to continue.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload TaskFlow
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
