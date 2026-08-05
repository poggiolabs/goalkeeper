export const logoVariants = ["auto", "light", "dark"] as const;
export type LogoVariant = (typeof logoVariants)[number];

export const logoGeometry = {
  backgroundRadius: 37,
  targetRadii: [17.5, 10, 3.75]
} as const;

export const logoPalettes: Record<
  LogoVariant,
  { background: string; target: string }
> = {
  auto: {
    background: "fill-[#e4ece5] dark:fill-[#1a261a]",
    target: "stroke-[#1d6d40] dark:stroke-[#6aad75]"
  },
  light: {
    background: "fill-[#e4ece5]",
    target: "stroke-[#1d6d40]"
  },
  dark: {
    background: "fill-[#1a261a]",
    target: "stroke-[#6aad75]"
  }
};
