import { useCallback, useState } from "react";

export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  const toggle = useCallback(() => {
    setDark((current) => {
      const next = !current;
      document.documentElement.classList.toggle("dark", next);

      try {
        localStorage.setItem("taskfleet-theme", next ? "dark" : "light");
      } catch {
        // Storage can be unavailable in private mode; the toggle still works.
      }

      return next;
    });
  }, []);

  return { dark, toggle };
}
