export function PageHeader({
  eyebrow,
  title,
  description
}: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <header className="space-y-2">
      {eyebrow ? (
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
        {description}
      </p>
    </header>
  );
}
