import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { UsersRoundIcon } from "lucide-react";
import { useAuth } from "@/auth";
import {
  listOrganizationMembers,
  updateOrganizationMemberRole,
  type OrganizationMember,
  type OrganizationRole
} from "@/auth-client";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiUrl } from "@/lib/config";
import { initials } from "@/lib/app-data";

export const Route = createFileRoute("/_authenticated/settings/team")({
  component: TeamSettingsPage
});

function TeamSettingsPage() {
  const auth = useAuth();
  const organization = auth.session?.organizations.find(
    ({ id }) => id === auth.session?.activeOrganizationId
  );
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const canManage =
    organization?.role === "owner" || organization?.role === "admin";

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    void listOrganizationMembers(apiUrl, controller.signal)
      .then((result) => {
        setMembers(result);
        setStatus("ready");
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load organization members."
        );
        setStatus("error");
      });
    return () => controller.abort();
  }, [auth.session?.activeOrganizationId]);

  async function handleRoleChange(
    member: OrganizationMember,
    role: Exclude<OrganizationRole, "owner">
  ) {
    if (member.role === role) return;
    setUpdatingUserId(member.userId);
    setError(null);
    try {
      const updated = await updateOrganizationMemberRole(
        apiUrl,
        member.userId,
        role
      );
      setMembers((current) =>
        current.map((candidate) =>
          candidate.userId === updated.userId ? updated : candidate
        )
      );
      await auth.refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update member role."
      );
    } finally {
      setUpdatingUserId(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Organization settings"
        title="Team"
        description={`Manage roles for ${organization?.name ?? "the active organization"}.`}
      />
      <Card>
        <CardHeader>
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UsersRoundIcon className="size-4" />
          </div>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Invitations are not available yet. Owners and administrators can
            manage existing non-owner memberships.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {status === "loading" ? <MemberSkeleton /> : null}
          {status !== "loading"
            ? members.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <Avatar>
                    <AvatarFallback>{initials(member.displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.displayName}
                      {member.userId === auth.session?.user.id ? (
                        <span className="font-normal text-muted-foreground">
                          {" "}(You)
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email ?? member.userId}
                    </p>
                  </div>
                  {member.role === "owner" || !canManage ? (
                    <Badge variant="secondary" className="capitalize">
                      {member.role}
                    </Badge>
                  ) : (
                    <Select
                      value={member.role}
                      disabled={updatingUserId !== null}
                      onValueChange={(value) =>
                        void handleRoleChange(
                          member,
                          value as Exclude<OrganizationRole, "owner">
                        )
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`${member.displayName} role`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))
            : null}
        </CardContent>
      </Card>
    </div>
  );
}

function MemberSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading members">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-lg border p-3"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  );
}
