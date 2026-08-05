import { createFileRoute } from "@tanstack/react-router";
import { VerifyEmailPage } from "@/components/verify-email-page";

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmailPage
});
