import { useEffect } from "react";
import { useAppStore, type ThemeMode } from "../store/appStore";

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function useSystemTheme() {
  const themeMode = useAppStore((s) => s.themeMode);
  const setIsDark = useAppStore((s) => s.setIsDark);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const resolve = (mode: ThemeMode) => {
      const dark = mode === "system" ? mql.matches : mode === "dark";
      applyTheme(dark);
      setIsDark(dark);
    };

    resolve(themeMode);

    if (themeMode !== "system") return;
    const onChange = (e: MediaQueryListEvent) => {
      applyTheme(e.matches);
      setIsDark(e.matches);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [themeMode, setIsDark]);
}
