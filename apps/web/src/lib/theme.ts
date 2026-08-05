export const themeStorageKey = "goalkeeper:theme";

export const themePreferences = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function readThemePreference(
  storage: Pick<ThemeStorage, "getItem"> | undefined = browserStorage()
): ThemePreference {
  try {
    const value = storage?.getItem(themeStorageKey);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(
  preference: ThemePreference,
  storage: Pick<ThemeStorage, "setItem"> | undefined = browserStorage()
): void {
  try {
    storage?.setItem(themeStorageKey, preference);
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemIsDark: boolean
): ResolvedTheme {
  return preference === "system" ? (systemIsDark ? "dark" : "light") : preference;
}

export function applyResolvedTheme(
  theme: ResolvedTheme,
  root: HTMLElement = document.documentElement
): void {
  root.classList.toggle("dark", theme === "dark");
  root.dataset.resolvedTheme = theme;
  root.style.colorScheme = theme;
}

export function initializeTheme(): void {
  if (typeof window === "undefined") return;
  const preference = readThemePreference();
  const systemIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = preference;
  applyResolvedTheme(resolveTheme(preference, systemIsDark));
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return themePreferences.includes(value as ThemePreference);
}

function browserStorage(): ThemeStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}
