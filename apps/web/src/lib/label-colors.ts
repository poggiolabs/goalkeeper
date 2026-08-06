const labelColors = [
  "#287f5b",
  "#177e89",
  "#2563a9",
  "#4f63b6",
  "#7655b5",
  "#a54883",
  "#b84b4b",
  "#b7652a",
  "#9a7419",
  "#5f7f32"
] as const;

export function randomLabelColor(): string {
  return labelColors[Math.floor(Math.random() * labelColors.length)]!;
}
