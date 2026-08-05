import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { AuthProvider } from "@/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/theme";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage
});

function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Outlet />
        </TooltipProvider>
        <Toaster />
      </AuthProvider>
    </ThemeProvider>
  );
}

function NotFoundPage() {
  return (
    <main className="grid min-h-svh place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
          <CardDescription>
            The page you requested does not exist or has moved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/home">Return home</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
