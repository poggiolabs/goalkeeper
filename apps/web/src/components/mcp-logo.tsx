import { cn } from "@/lib/utils";

export function McpLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-4 shrink-0 bg-current [mask:url('/mcp-logo.svg')_center/contain_no-repeat]",
        className
      )}
    />
  );
}
