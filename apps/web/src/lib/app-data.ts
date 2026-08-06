import {
  Building2Icon,
  HomeIcon,
  KeyRoundIcon,
  PaletteIcon,
  TagsIcon,
  TargetIcon,
  UserRoundIcon,
  UsersRoundIcon,
  type LucideIcon
} from "lucide-react";
import type { ComponentType } from "react";
import { McpLogo } from "@/components/mcp-logo";

export type NavigationRoute = {
  href: "/home" | "/goals" | "/labels";
  label: string;
  icon: LucideIcon;
};

export const navigationRoutes: NavigationRoute[] = [
  { href: "/home", label: "Home", icon: HomeIcon },
  { href: "/goals", label: "Goals", icon: TargetIcon },
  { href: "/labels", label: "Labels", icon: TagsIcon }
];

export const settingsGroups = ["Personal settings", "Organization settings"] as const;

export const settingsRoutes: Array<{
  href:
    | "/settings/profile"
    | "/settings/appearance"
    | "/settings/organization"
    | "/settings/team"
    | "/settings/api-tokens"
    | "/settings/mcp-server";
  label: string;
  group: (typeof settingsGroups)[number];
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    href: "/settings/profile",
    label: "Profile",
    group: "Personal settings",
    icon: UserRoundIcon
  },
  {
    href: "/settings/appearance",
    label: "Appearance",
    group: "Personal settings",
    icon: PaletteIcon
  },
  {
    href: "/settings/organization",
    label: "Organization",
    group: "Organization settings",
    icon: Building2Icon
  },
  {
    href: "/settings/team",
    label: "Team",
    group: "Organization settings",
    icon: UsersRoundIcon
  },
  {
    href: "/settings/api-tokens",
    label: "API Tokens",
    group: "Organization settings",
    icon: KeyRoundIcon
  },
  {
    href: "/settings/mcp-server",
    label: "MCP Server",
    group: "Organization settings",
    icon: McpLogo
  }
];

export function initials(displayName: string): string {
  const value = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return value || "GK";
}
