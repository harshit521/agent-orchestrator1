import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import "./index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container is missing");
}

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
);
