import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  applyResolvedTheme,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  themeStorageKey,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference
} from "@/lib/theme";

type ThemeState = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setStoredPreference] = useState(readThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(preference, systemPrefersDark())
  );

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    writeThemePreference(nextPreference);
    setStoredPreference(nextPreference);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const nextResolvedTheme = resolveTheme(preference, media.matches);
      document.documentElement.dataset.theme = preference;
      applyResolvedTheme(nextResolvedTheme);
      setResolvedTheme(nextResolvedTheme);
    };
    apply();
    if (preference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== themeStorageKey) return;
      setStoredPreference(
        isThemePreference(event.newValue) ? event.newValue : "system"
      );
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}
