import { useId, type HTMLAttributes, type SVGProps } from "react";
import {
  logoGeometry,
  logoPalettes,
  type LogoVariant
} from "@/lib/logo";
import { cn } from "@/lib/utils";

type LogoMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
  variant?: LogoVariant;
};

export function LogoMark({
  className,
  title,
  variant = "auto",
  ...props
}: LogoMarkProps) {
  const titleId = useId();
  const palette = logoPalettes[variant];

  return (
    <svg
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      aria-labelledby={title ? titleId : undefined}
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <circle
        cx="40"
        cy="40"
        r={logoGeometry.backgroundRadius}
        className={palette.background}
      />
      <g fill="none" className={palette.target} strokeWidth="3.2">
        {logoGeometry.targetRadii.map((radius) => (
          <circle key={radius} cx="40" cy="40" r={radius} />
        ))}
      </g>
    </svg>
  );
}

type LogoWordmarkProps = HTMLAttributes<HTMLSpanElement> & {
  markClassName?: string;
  variant?: LogoVariant;
};

export function LogoWordmark({
  className,
  markClassName,
  variant = "auto",
  ...props
}: LogoWordmarkProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-2.5", className)}
      {...props}
    >
      <LogoMark className={cn("size-9", markClassName)} variant={variant} />
      <span className="font-semibold tracking-tight">Goalkeeper</span>
    </span>
  );
}
