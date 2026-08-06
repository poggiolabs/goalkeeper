import { useEffect, useMemo, useState } from "react";
import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate
} from "@tanstack/react-router";
import {
  ArrowRightIcon,
  EllipsisVerticalIcon,
  PlusIcon,
  SearchIcon,
  TagsIcon,
  TargetIcon,
  Trash2Icon
} from "lucide-react";
import { useAuth } from "@/auth";
import {
  listOrganizationMembers,
  type OrganizationMember
} from "@/auth-client";
import { GoalFilterBuilder } from "@/components/goal-filter-builder";
import { GoalHealthBadge } from "@/components/goal-health-badge";
import { GoalStatusBadge } from "@/components/goal-status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label as FieldLabel } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  createDefaultGoalFilter,
  goalMatchesFilters,
  goalMatchesSearch,
  readGoalFiltersFromSearchParams,
  repairFilters,
  writeGoalFiltersToSearchParams,
  type GoalFilter
} from "@/lib/goal-filters";
import {
  createGoalLabel,
  deleteGoal,
  deleteGoalLabel,
  listGoalLabels,
  listGoals,
  updateGoalLabel,
  type Goal,
  type GoalLabel
} from "@/lib/goals-client";
import { apiUrl } from "@/lib/config";
import { randomLabelColor } from "@/lib/label-colors";

export const Route = createFileRoute("/_authenticated/goals")({
  component: GoalsRoute
});

type LoadStatus = "loading" | "ready" | "error";

function GoalsRoute() {
  const location = useLocation();
  return location.pathname === "/goals" ? <GoalsPage /> : <Outlet />;
}

function GoalsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [labels, setLabels] = useState<GoalLabel[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<GoalFilter[]>(() => [
    createDefaultGoalFilter()
  ]);
  const [filtersUrlReady, setFiltersUrlReady] = useState(false);

  useEffect(() => {
    const restoreFilters = () => {
      const restored = readGoalFiltersFromSearchParams(
        new URLSearchParams(window.location.search)
      );
      setFilters(restored === null ? [createDefaultGoalFilter()] : restored);
    };

    restoreFilters();
    setFiltersUrlReady(true);
    window.addEventListener("popstate", restoreFilters);
    return () => window.removeEventListener("popstate", restoreFilters);
  }, []);

  useEffect(() => {
    if (!filtersUrlReady) return;
    const url = new URL(window.location.href);
    const originalSearch = url.search;
    writeGoalFiltersToSearchParams(url.searchParams, filters);
    if (url.search === originalSearch) return;
    window.history.replaceState(window.history.state, "", url);
  }, [filters, filtersUrlReady]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    void Promise.all([
      listGoals(apiUrl, controller.signal),
      listGoalLabels(apiUrl, controller.signal),
      listOrganizationMembers(apiUrl, controller.signal)
    ])
      .then(([nextGoals, nextLabels, nextMembers]) => {
        setGoals(nextGoals);
        setLabels(nextLabels);
        setMembers(nextMembers);
        setStatus("ready");
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Unable to load goals.");
        setStatus("error");
      });
    return () => controller.abort();
  }, [auth.session?.activeOrganizationId]);

  useEffect(() => {
    if (!filtersUrlReady || status !== "ready") return;
    setFilters((current) => {
      const repaired = repairFilters(current, members, labels);
      return JSON.stringify(repaired) === JSON.stringify(current)
        ? current
        : repaired;
    });
  }, [filtersUrlReady, labels, members, status]);

  const membersById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members]
  );
  const visibleGoals = useMemo(
    () =>
      goals.filter(
        (goal) =>
          goalMatchesFilters(goal, auth.session?.user.id ?? "", filters) &&
          goalMatchesSearch(
            goal,
            search,
            goal.ownerUserId
              ? membersById.get(goal.ownerUserId)
              : undefined
          )
      ),
    [auth.session?.user.id, filters, goals, membersById, search]
  );

  function handleCreateGoal() {
    void navigate({
      to: "/goals/$goalId",
      params: { goalId: "new" }
    });
  }

  async function handleDeleteGoal() {
    if (!goalToDelete) return;
    setDeletingGoalId(goalToDelete.id);
    setError(null);
    try {
      await deleteGoal(apiUrl, goalToDelete.id);
      setGoals((current) =>
        current.filter((goal) => goal.id !== goalToDelete.id)
      );
      setGoalToDelete(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete the goal.");
    } finally {
      setDeletingGoalId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {status === "loading" ? (
        <GoalListSkeleton />
      ) : goals.length === 0 ? (
        <EmptyGoals onCreate={handleCreateGoal} />
      ) : (
        <div className="space-y-5">
          <div className="flex justify-end">
            <Button onClick={handleCreateGoal}>
              <PlusIcon />
              Create new goal
            </Button>
          </div>
          <div className="space-y-3">
            <div className="space-y-3 pb-1">
              <div className="relative max-w-xl">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search goals"
                  aria-label="Search goals"
                  className="pl-8"
                />
              </div>
              <GoalFilterBuilder
                filters={filters}
                members={members}
                labels={labels}
                currentUserId={auth.session?.user.id}
                onChange={setFilters}
              />
            </div>
            {visibleGoals.length === 0 ? (
              <Card className="border-dashed">
                <CardHeader>
                  <CardTitle>No matching goals</CardTitle>
                  <CardDescription>
                    Change the search or remove filters to see more goals.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <div className="space-y-3" aria-label="Goals">
                {visibleGoals.map((goal) => (
                  <GoalRow
                    key={goal.id}
                    goal={goal}
                    owner={
                      goal.ownerUserId
                        ? membersById.get(goal.ownerUserId)
                        : undefined
                    }
                    onOpen={() =>
                      void navigate({
                        to: "/goals/$goalId",
                        params: { goalId: goal.id }
                      })
                    }
                    onDelete={() => setGoalToDelete(goal)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog
        open={goalToDelete !== null}
        onOpenChange={(open) => {
          if (!open && deletingGoalId === null) setGoalToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {goalToDelete?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the goal and its complete status history.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingGoalId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingGoalId !== null}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteGoal();
              }}
            >
              {deletingGoalId !== null ? "Deleting…" : "Delete goal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyGoals({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="max-w-3xl border-dashed bg-card/70">
      <CardHeader className="items-center text-center">
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <TargetIcon className="size-5" />
        </div>
        <CardTitle>No goals yet</CardTitle>
        <CardDescription className="max-w-lg">
          Goals define the outcomes your people and agents should work toward.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button onClick={onCreate}>
          <PlusIcon />
          Create new goal
        </Button>
      </CardContent>
    </Card>
  );
}

function GoalRow({
  goal,
  owner,
  onOpen,
  onDelete
}: {
  goal: Goal;
  owner: OrganizationMember | undefined;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative rounded-xl border bg-card shadow-xs transition hover:border-primary/30 hover:shadow-sm">
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full gap-4 p-4 pr-14 text-left md:grid-cols-[minmax(0,1fr)_11rem_8rem_auto] md:items-center"
      >
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-medium">{goal.title}</h2>
            <GoalStatusBadge status={goal.status} />
            <GoalHealthBadge health={goal.health} />
          </div>
          <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
            {goal.detailedDescription}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {goalTimeframeSummary(goal)} · {goalEvaluationSummary(goal)}
          </p>
          {goal.labels.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {goal.labels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: label.color ?? "#64748b" }}
                  />
                  {label.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Owner</p>
          <p className="mt-1 truncate text-sm">
            {goal.ownerUserId === null
              ? "Unassigned"
              : owner?.displayName ?? "Former member"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Updated</p>
          <p className="mt-1 text-sm">{formatDate(goal.updatedAt)}</p>
        </div>
        <ArrowRightIcon className="hidden size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground md:block" />
      </button>
      <div className="absolute right-3 top-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${goal.title}`}
            >
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2Icon />
              Delete goal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function LabelsPane({
  labels,
  goals,
  onLabelsChange,
  onError
}: {
  labels: GoalLabel[];
  goals: Goal[];
  onLabelsChange: (labels: GoalLabel[]) => void;
  onError: (error: string | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(randomLabelColor);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    onError(null);
    try {
      const label = await createGoalLabel(apiUrl, {
        name: name.trim(),
        color,
        description: description.trim() || null
      });
      onLabelsChange(
        [...labels, label].sort((left, right) => left.name.localeCompare(right.name))
      );
      setName("");
      setDescription("");
      setCreating(false);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Unable to create the label.");
    } finally {
      setBusy(false);
    }
  }

  function beginCreate() {
    setName("");
    setDescription("");
    setColor(randomLabelColor());
    setCreating(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={beginCreate} disabled={creating}>
          <PlusIcon />
          Create label
        </Button>
      </div>
      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle>New label</CardTitle>
            <CardDescription>
              Add a description so people and agents apply it consistently.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[1fr_8rem]">
            <div className="space-y-2">
              <FieldLabel htmlFor="new-label-name">Name</FieldLabel>
              <Input
                id="new-label-name"
                value={name}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                placeholder="Customer-facing"
              />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="new-label-color">Color</FieldLabel>
              <Input
                id="new-label-color"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="p-1"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <FieldLabel htmlFor="new-label-description">Description</FieldLabel>
              <Input
                id="new-label-description"
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="When should this label be used?"
              />
            </div>
            <div className="flex gap-2 md:col-span-2">
              <Button disabled={busy || !name.trim()} onClick={() => void handleCreate()}>
                {busy ? "Creating…" : "Create label"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {labels.length === 0 && !creating ? (
        <Card className="border-dashed">
          <CardHeader className="justify-items-center text-center">
            <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <TagsIcon className="size-5" />
            </div>
            <CardTitle>No labels yet</CardTitle>
            <CardDescription>
              Create labels to group related goals and make the goals list easier to filter.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {labels.map((label) => (
            <LabelRow
              key={label.id}
              label={label}
              usageCount={
                goals.filter((goal) =>
                  goal.labels.some((candidate) => candidate.id === label.id)
                ).length
              }
              onChange={(updated) =>
                onLabelsChange(
                  labels.map((candidate) =>
                    candidate.id === updated.id ? updated : candidate
                  )
                )
              }
              onDelete={() =>
                onLabelsChange(labels.filter((candidate) => candidate.id !== label.id))
              }
              onError={onError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LabelRow({
  label,
  usageCount,
  onChange,
  onDelete,
  onError
}: {
  label: GoalLabel;
  usageCount: number;
  onChange: (label: GoalLabel) => void;
  onDelete: () => void;
  onError: (error: string | null) => void;
}) {
  const [name, setName] = useState(label.name);
  const [description, setDescription] = useState(label.description ?? "");
  const [color, setColor] = useState(label.color ?? "#64748b");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    name !== label.name ||
    description !== (label.description ?? "") ||
    color !== (label.color ?? "#64748b");

  async function handleSave() {
    if (!name.trim()) return;
    setBusy(true);
    onError(null);
    try {
      onChange(
        await updateGoalLabel(apiUrl, label.id, {
          name: name.trim(),
          description: description.trim() || null,
          color
        })
      );
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Unable to update the label.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    onError(null);
    try {
      await deleteGoalLabel(apiUrl, label.id);
      onDelete();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Unable to delete the label.");
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card size="sm">
      <CardContent className="grid gap-3 md:grid-cols-[3rem_12rem_minmax(12rem,1fr)_7rem_auto] md:items-center">
        <Input
          type="color"
          aria-label={`${label.name} color`}
          value={color}
          disabled={busy}
          onChange={(event) => setColor(event.target.value)}
          className="w-12 p-1"
        />
        <Input
          aria-label={`${label.name} name`}
          value={name}
          maxLength={64}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          aria-label={`${label.name} description`}
          value={description}
          maxLength={500}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="When should this label be used?"
        />
        <span className="text-sm text-muted-foreground">
          {usageCount} {usageCount === 1 ? "goal" : "goals"}
        </span>
        <div className="flex justify-end gap-2">
          {dirty ? (
            <Button size="sm" disabled={busy || !name.trim()} onClick={() => void handleSave()}>
              Save
            </Button>
          ) : null}
          <Button
            variant={confirmDelete ? "destructive" : "ghost"}
            size={confirmDelete ? "sm" : "icon-sm"}
            disabled={busy}
            aria-label={confirmDelete ? undefined : `Delete ${label.name}`}
            onClick={() =>
              confirmDelete ? void handleDelete() : setConfirmDelete(true)
            }
          >
            {confirmDelete ? "Confirm" : <Trash2Icon />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GoalListSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading goals">
      {[0, 1, 2].map((item) => (
        <div key={item} className="space-y-3 rounded-xl border p-4">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ))}
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function goalTimeframeSummary(goal: Goal): string {
  if (goal.timeframe.kind === "deadline") {
    return `Target ${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(`${goal.timeframe.targetDate}T00:00:00.000Z`))}`;
  }
  return goal.timeframe.kind === "continuous"
    ? "Continuous"
    : "Timeframe unspecified";
}

function goalEvaluationSummary(goal: Goal): string {
  if (!goal.currentEvaluation) return "Not evaluated";
  const result = {
    met: "Met",
    not_met: "Not met",
    unknown: "Unknown"
  }[goal.currentEvaluation.result];
  return `${result} as of ${formatDate(goal.currentEvaluation.asOf)}`;
}
