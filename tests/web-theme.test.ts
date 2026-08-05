import { describe, expect, test } from "bun:test";
import {
  applyResolvedTheme,
  readThemePreference,
  resolveTheme,
  themeStorageKey,
  writeThemePreference
} from "../apps/web/src/lib/theme";

describe("web theme preferences", () => {
  test("defaults invalid or unavailable preferences to system", () => {
    expect(readThemePreference(undefined)).toBe("system");
    expect(readThemePreference({ getItem: () => "sepia" })).toBe("system");
    expect(readThemePreference({ getItem: () => "dark" })).toBe("dark");
  });

  test("persists the selected preference", () => {
    const values = new Map<string, string>();
    writeThemePreference("light", {
      setItem: (key, value) => values.set(key, value)
    });
    expect(values.get(themeStorageKey)).toBe("light");
  });

  test("resolves system mode and applies the dark class and color scheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");

    const classes = new Set<string>();
    const root = {
      classList: {
        toggle(name: string, enabled: boolean) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        }
      },
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>
    } as unknown as HTMLElement;

    applyResolvedTheme("dark", root);
    expect(classes.has("dark")).toBe(true);
    expect(root.dataset.resolvedTheme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");

    applyResolvedTheme("light", root);
    expect(classes.has("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
  });
});
