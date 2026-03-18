import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

(function () {
  const saved = localStorage.getItem("dash-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved === "dark" || (!saved && prefersDark)) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
})();

createRoot(document.getElementById("root")!).render(<App />);
