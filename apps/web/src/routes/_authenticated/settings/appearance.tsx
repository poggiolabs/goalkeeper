import { createFileRoute } from "@tanstack/react-router";
import {
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  SunIcon,
  type LucideIcon
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem
} from "@/components/ui/radio-group";
import {
  isThemePreference,
  type ThemePreference
} from "@/lib/theme";
import { useTheme } from "@/theme";

export const Route = createFileRoute("/_authenticated/settings/appearance")({
  component: AppearanceSettingsPage
});

const themeOptions: Array<{
  value: ThemePreference;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "light",
    label: "Light",
    description: "Always use the light appearance.",
    icon: SunIcon
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark appearance.",
    icon: MoonIcon
  },
  {
    value: "system",
    label: "System",
    description: "Match this device’s appearance.",
    icon: MonitorIcon
  }
];

function AppearanceSettingsPage() {
  const theme = useTheme();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal settings"
        title="Appearance"
        description="Control how Goalkeeper looks on this device."
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <PaletteIcon className="size-4" />
          </div>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            Choose a theme or follow your operating system preference.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={theme.preference}
            aria-label="Theme preference"
            onValueChange={(value) => {
              if (isThemePreference(value)) theme.setPreference(value);
            }}
          >
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const isSelected = theme.preference === option.value;
              return (
                <Label
                  key={option.value}
                  htmlFor={`theme-${option.value}`}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-4 font-normal transition-colors hover:bg-muted/60 has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{option.label}</span>
                      {option.value === "system" && isSelected ? (
                        <Badge variant="secondary" className="capitalize">
                          {theme.resolvedTheme}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {option.description}
                    </p>
                  </div>
                  <RadioGroupItem
                    id={`theme-${option.value}`}
                    value={option.value}
                  />
                </Label>
              );
            })}
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
