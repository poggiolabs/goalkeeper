import { useEffect, useMemo, useState } from "react";
import {
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon
} from "lucide-react";
import { toast } from "sonner";
import {
  createApiToken,
  getApiTokenScopes,
  listApiTokens,
  revokeApiToken,
  UnauthorizedError,
  type ApiToken,
  type ApiTokenScope,
  type ApiTokenScopeDefinition
} from "@/auth-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { filterScopes } from "@/lib/api-token-scopes";
import { apiUrl } from "@/lib/config";

export function ApiTokenManager() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [scopeDefinitions, setScopeDefinitions] = useState<
    ApiTokenScopeDefinition[] | null
  >(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>([]);
  const [scopeQuery, setScopeQuery] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<ApiToken | null>(null);
  const filteredScopes = useMemo(
    () => filterScopes(scopeDefinitions ?? [], scopeQuery),
    [scopeDefinitions, scopeQuery]
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listApiTokens(apiUrl, controller.signal),
      getApiTokenScopes(apiUrl, controller.signal)
    ])
      .then(([nextTokens, nextDefinitions]) => {
        setTokens(nextTokens);
        setScopeDefinitions(nextDefinitions);
        setScopes(
          nextDefinitions
            .filter((scope) => scope.default)
            .map((scope) => scope.id)
        );
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        handleRequestError(reason, setError);
      });
    return () => controller.abort();
  }, []);

  function toggleScope(scope: ApiTokenScope) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((candidate) => candidate !== scope)
        : [...current, scope]
    );
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || scopes.length === 0) return;
    setIsCreating(true);
    setCreatedSecret(null);
    setCreateError(null);

    try {
      const result = await createApiToken(apiUrl, {
        name: normalizedName,
        scopes,
        expiresInDays
      });
      setTokens((current) => [result.token, ...(current ?? [])]);
      setCreatedSecret(result.secret);
      setName("");
      setScopeQuery("");
      setExpiresInDays(90);
      setScopes(
        scopeDefinitions
          ?.filter((scope) => scope.default)
          .map((scope) => scope.id) ?? []
      );
      setIsCreateOpen(false);
    } catch (reason) {
      handleRequestError(reason, setCreateError);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke() {
    if (!tokenToRevoke) return;
    setRevokingId(tokenToRevoke.id);
    setError(null);
    try {
      await revokeApiToken(apiUrl, tokenToRevoke.id);
      setTokens((current) =>
        current?.filter((candidate) => candidate.id !== tokenToRevoke.id) ?? []
      );
      setTokenToRevoke(null);
    } catch (reason) {
      handleRequestError(reason, setError);
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopyCreatedToken() {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      toast.success("API token copied");
    } catch {
      toast.error("Unable to copy API token");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRoundIcon className="size-4" />
        </div>
        <CardTitle>API tokens</CardTitle>
        <CardAction>
          <Button
            onClick={() => {
              setCreateError(null);
              setIsCreateOpen(true);
            }}
          >
            <PlusIcon />
            Create token
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>API token request failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Separator />

        <section className="space-y-3" aria-live="polite">
          {tokens === null && !error ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : null}
          <div className="divide-y rounded-lg border">
            {tokens?.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No active API tokens.
              </div>
            ) : null}
            {tokens?.map((token) => (
              <article
                className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between"
                key={token.id}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{token.name}</strong>
                    <code className="text-xs text-muted-foreground">
                      {token.prefix}…
                    </code>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {token.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Expires {formatDate(token.expiresAt)} · Last used{" "}
                    {token.lastUsedAt ? formatDate(token.lastUsedAt) : "never"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={revokingId !== null}
                  onClick={() => setTokenToRevoke(token)}
                >
                  <Trash2Icon />
                  Revoke
                </Button>
              </article>
            ))}
          </div>
        </section>
      </CardContent>

      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          if (isCreating) return;
          setIsCreateOpen(open);
          if (!open) {
            setCreateError(null);
            setScopeQuery("");
          }
        }}
      >
        <DialogContent>
          <form className="contents" onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Create API token</DialogTitle>
              <DialogDescription>
                Configure a scoped credential for the active organization. The
                secret is shown only once.
              </DialogDescription>
            </DialogHeader>

            {createError ? (
              <Alert variant="destructive">
                <AlertTitle>Unable to create API token</AlertTitle>
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                autoFocus
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder="CI deployment"
                required
                value={name}
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Scopes</legend>
              {scopeDefinitions === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      aria-label="Filter API token scopes"
                      className="pl-8"
                      placeholder="Filter scopes"
                      value={scopeQuery}
                      onChange={(event) => setScopeQuery(event.target.value)}
                    />
                  </div>
                  {filteredScopes.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No scopes match “{scopeQuery}”.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border bg-background">
                      {filteredScopes.map((scope) => (
                        <Label
                          key={scope.id}
                          htmlFor={`scope-${scope.id}`}
                          className="flex cursor-pointer items-center gap-3 rounded-none border-b p-3 font-normal last:border-b-0 has-data-[state=checked]:bg-primary/5"
                        >
                          <Checkbox
                            id={`scope-${scope.id}`}
                            checked={scopes.includes(scope.id)}
                            onCheckedChange={() => toggleScope(scope.id)}
                          />
                          <span className="flex min-w-0 flex-1 items-center gap-3">
                            <code className="w-[15ch] shrink-0 text-[13px] font-medium text-foreground">
                              {scope.id}
                            </code>
                            <span className="min-w-0 text-xs leading-4 text-muted-foreground">
                              {scope.description}
                            </span>
                          </span>
                        </Label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="token-expiration">Expires</Label>
              <Select
                value={String(expiresInDays)}
                onValueChange={(value) => setExpiresInDays(Number(value))}
              >
                <SelectTrigger id="token-expiration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="365">1 year</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isCreating}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  isCreating ||
                  revokingId !== null ||
                  scopeDefinitions === null ||
                  scopes.length === 0 ||
                  name.trim().length === 0
                }
              >
                <PlusIcon />
                {isCreating ? "Creating…" : "Create token"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createdSecret !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedSecret(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>API token created</DialogTitle>
            <DialogDescription>
              Copy this token now. It will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <code className="block [overflow-wrap:anywhere] rounded-md bg-muted p-3 text-xs text-foreground">
            {createdSecret}
          </code>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Close
              </Button>
            </DialogClose>
            <Button type="button" onClick={() => void handleCopyCreatedToken()}>
              <CopyIcon />
              Copy token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={tokenToRevoke !== null}
        onOpenChange={(open) => {
          if (!open && revokingId === null) setTokenToRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {tokenToRevoke?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Requests using this token will fail immediately. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revokingId !== null}
              onClick={(event) => {
                event.preventDefault();
                void handleRevoke();
              }}
            >
              {revokingId ? "Revoking…" : "Revoke token"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function handleRequestError(
  reason: unknown,
  setError: (error: string) => void
) {
  if (reason instanceof UnauthorizedError) {
    window.location.replace("/sign-in?returnTo=/settings/api-tokens");
    return;
  }
  setError(reason instanceof Error ? reason.message : "Unable to manage API tokens.");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value)
  );
}
