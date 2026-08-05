import { useEffect, useState } from "react";
import { verifyEmail } from "@/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { apiUrl } from "@/lib/config";

export function VerifyEmailPage() {
  const [token] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("token")
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, "", "/verify-email");
  }, []);

  async function handleVerification() {
    if (!token) return;
    setIsSubmitting(true);
    setError(null);
    try {
      window.location.assign(await verifyEmail(apiUrl, token));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That verification link is invalid or expired."
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <a href="/" className="mb-8 w-fit text-sm font-semibold">
            Goalkeeper
          </a>
          <CardTitle className="text-2xl">Verify your email</CardTitle>
          <CardDescription>
            {token
              ? "Confirm this email address to finish creating your account."
              : "That verification link is invalid or expired."}
          </CardDescription>
        </CardHeader>
        {error ? (
          <CardContent>
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
        {token ? (
          <CardFooter>
            <Button
              className="w-full"
              disabled={isSubmitting}
              onClick={handleVerification}
            >
              {isSubmitting ? "Verifying…" : "Verify email"}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </main>
  );
}
