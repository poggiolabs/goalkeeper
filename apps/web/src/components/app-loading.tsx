import { Skeleton } from "@/components/ui/skeleton";

export function AppLoading() {
  return (
    <div className="flex min-h-svh bg-background" aria-label="Loading application">
      <div className="hidden w-64 border-r bg-sidebar p-4 md:block">
        <Skeleton className="mb-10 h-8 w-32" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
        <Skeleton className="mt-[calc(100vh-15rem)] h-14 w-full" />
      </div>
      <div className="w-full p-6 md:p-10">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
        <Skeleton className="mt-10 h-44 w-full max-w-3xl" />
      </div>
    </div>
  );
}
