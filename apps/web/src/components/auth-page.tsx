import { useEffect, useState } from "react";
import { ArrowUpRightIcon, LogInIcon } from "lucide-react";
import {
  getAuthConfiguration,
  loginUrl,
  loginWithEmail,
  registerWithEmail,
  type AuthConfiguration
} from "@/auth-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogoWordmark } from "@/components/logo";
import { apiUrl, docsUrl, safeAppUrl } from "@/lib/config";

export function AuthPage({
  requestedReturnTo,
  verified
}: {
  requestedReturnTo?: string;
  verified?: string;
}) {
  const returnTo = safeAppUrl(requestedReturnTo, "/home");
  const [configuration, setConfiguration] = useState<AuthConfiguration | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(
    verified === "1" ? "Email verified. You can sign in." : null
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getAuthConfiguration(apiUrl, controller.signal)
      .then(setConfiguration)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load authentication settings."
          );
        }
      });
    return () => controller.abort();
  }, []);

  async function handleEmailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "register") {
        const result = await registerWithEmail(apiUrl, {
          email,
          password,
          displayName
        });
        setMessage(`Check ${result.email} for a verification link.`);
      } else {
        window.location.assign(
          await loginWithEmail(apiUrl, { email, password, returnTo })
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.72fr)]">
      <section className="flex min-h-[42vh] flex-col justify-between bg-primary p-8 text-primary-foreground lg:min-h-svh lg:p-14">
        <a href="/" className="w-fit">
          <LogoWordmark className="text-lg" />
        </a>
        <div className="max-w-2xl py-16 lg:py-0">
          <h1 className="text-5xl font-semibold leading-[0.95] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Team goals for AI agents.
          </h1>
        </div>
        <a
          href={docsUrl}
          className="flex w-fit items-center gap-2 text-sm opacity-75 transition hover:opacity-100"
        >
          Documentation <ArrowUpRightIcon className="size-4" />
        </a>
      </section>

      <section className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md space-y-4">
          {message ? (
            <Alert>
              <AlertTitle>Check your email</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Authentication unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {configuration === null && !error ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ) : null}

          {configuration?.method === "redirect" ? (
            <Card>
              <CardHeader>
                <CardTitle>Welcome back</CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild size="lg" className="w-full">
                  <a href={loginUrl(apiUrl, returnTo)}>
                    <LogInIcon />
                    Sign in
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {configuration?.method === "email" ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {mode === "login" ? "Welcome back" : "Create your account"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <Tabs
                  value={mode}
                  onValueChange={(value) => setMode(value as "login" | "register")}
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="login">Sign in</TabsTrigger>
                    <TabsTrigger value="register">Create account</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Separator />
                <form className="space-y-4" onSubmit={handleEmailAuth}>
                  {mode === "register" ? (
                    <div className="space-y-2">
                      <Label htmlFor="display-name">Display name</Label>
                      <Input
                        id="display-name"
                        autoComplete="name"
                        maxLength={100}
                        onChange={(event) => setDisplayName(event.target.value)}
                        required
                        value={displayName}
                      />
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      autoComplete="email"
                      maxLength={254}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      type="email"
                      value={email}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      minLength={12}
                      maxLength={512}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      type="password"
                      value={password}
                    />
                  </div>
                  <Button className="w-full" disabled={isSubmitting} size="lg">
                    {isSubmitting
                      ? "Working…"
                      : mode === "login"
                        ? "Sign in"
                        : "Create account"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>
    </main>
  );
}
