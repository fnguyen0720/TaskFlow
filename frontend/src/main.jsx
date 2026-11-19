import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import DiagnosticErrorBoundary from "./components/DiagnosticErrorBoundary.jsx";
import { installGlobalDiagnostics } from "./utils/diagnostics.js";
import "./App.css";

installGlobalDiagnostics();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <DiagnosticErrorBoundary>
      <App />
    </DiagnosticErrorBoundary>
  </StrictMode>
);