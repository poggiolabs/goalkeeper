import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MailPlusIcon, UsersRoundIcon } from "lucide-react";
import { useAuth } from "@/auth";
import {
  createOrganizationInvitation,
  listOrganizationInvitations,
  listOrganizationMembers,
  resendOrganizationInvitation,
  revokeOrganizationInvitation,
  updateOrganizationMemberRole,
  type IssuedOrganizationInvitation,
  type OrganizationInvitation,
  type OrganizationMember,
  type OrganizationRole
} from "@/auth-client";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<Exclude<OrganizationRole, "owner">>("member");
  const [inviting, setInviting] = useState(false);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);
  // Held only until the admin navigates away — the token cannot be recovered.
  const [issued, setIssued] = useState<IssuedOrganizationInvitation | null>(null);
  const canManage =
    organization?.role === "owner" || organization?.role === "admin";

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    setIssued(null);
    void Promise.all([
      listOrganizationMembers(apiUrl, controller.signal),
      listOrganizationInvitations(apiUrl, controller.signal)
    ])
      .then(([loadedMembers, loadedInvitations]) => {
        setMembers(loadedMembers);
        setInvitations(loadedInvitations);
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

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    setIssued(null);
    try {
      const result = await createOrganizationInvitation(
        apiUrl,
        inviteEmail.trim(),
        inviteRole
      );
      setIssued(result);
      setInvitations((current) => [result.invitation, ...current]);
      setInviteEmail("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to create the invitation."
      );
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(invitation: OrganizationInvitation) {
    setBusyInvitationId(invitation.id);
    setError(null);
    try {
      await revokeOrganizationInvitation(apiUrl, invitation.id);
      setInvitations((current) =>
        current.filter((candidate) => candidate.id !== invitation.id)
      );
      if (issued?.invitation.id === invitation.id) setIssued(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to revoke the invitation."
      );
    } finally {
      setBusyInvitationId(null);
    }
  }

  async function handleResend(invitation: OrganizationInvitation) {
    setBusyInvitationId(invitation.id);
    setError(null);
    try {
      const result = await resendOrganizationInvitation(apiUrl, invitation.id);
      setIssued(result);
      setInvitations((current) =>
        current.map((candidate) =>
          candidate.id === result.invitation.id ? result.invitation : candidate
        )
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to reissue the invitation."
      );
    } finally {
      setBusyInvitationId(null);
    }
  }

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
            Owners and administrators can manage non-owner memberships.
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

      <Card>
        <CardHeader>
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MailPlusIcon className="size-4" />
          </div>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>
            {canManage
              ? "Invite someone by email. They join this organization when they accept."
              : "Pending invitations for this organization."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManage ? (
            <form onSubmit={handleInvite} className="flex flex-wrap gap-2">
              <Input
                type="email"
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@example.com"
                aria-label="Invitation email"
                className="min-w-56 flex-1"
              />
              <Select
                value={inviteRole}
                onValueChange={(value) =>
                  setInviteRole(value as Exclude<OrganizationRole, "owner">)
                }
              >
                <SelectTrigger aria-label="Invitation role" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={inviting}>
                {inviting ? "Inviting…" : "Invite"}
              </Button>
            </form>
          ) : null}

          {issued ? (
            <Alert>
              <AlertDescription className="space-y-2">
                <p>
                  {issued.emailSent
                    ? `Invitation sent to ${issued.invitation.email}.`
                    : `Invitation created for ${issued.invitation.email}, but the email could not be sent. Share this link instead — it is shown only now.`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                    {issued.acceptUrl}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void navigator.clipboard?.writeText(issued.acceptUrl)
                    }
                  >
                    Copy link
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {status === "ready" && invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending invitations.
            </p>
          ) : null}

          {invitations.map((invitation) => (
            <div
              key={invitation.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{invitation.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <Badge variant="secondary" className="capitalize">
                {invitation.role}
              </Badge>
              {canManage ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busyInvitationId !== null}
                    onClick={() => void handleResend(invitation)}
                  >
                    Resend
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busyInvitationId !== null}
                    onClick={() => void handleRevoke(invitation)}
                  >
                    Revoke
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
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
