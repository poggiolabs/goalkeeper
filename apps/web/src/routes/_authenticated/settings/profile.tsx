import { createFileRoute } from "@tanstack/react-router";
import { UserRoundIcon } from "lucide-react";
import { useAuth } from "@/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  component: ProfileSettingsPage
});

function ProfileSettingsPage() {
  const { session } = useAuth();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal settings"
        title="Profile"
        description="Manage the identity attached to your Goalkeeper account."
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserRoundIcon className="size-4" />
          </div>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Profile editing is not exposed by the API yet. These values come from your authenticated identity.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Display name</Label>
            <Input id="profile-name" value={session?.user.displayName ?? ""} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={session?.user.email ?? ""} disabled />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
