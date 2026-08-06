import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CheckIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  PlusIcon,
  RocketIcon,
  Trash2Icon,
  XIcon
} from "lucide-react";
import { useAuth } from "@/auth";
import {
  listOrganizationMembers,
  type OrganizationMember
} from "@/auth-client";
import { GoalStatusBadge } from "@/components/goal-status-badge";
import { GoalHealthBadge } from "@/components/goal-health-badge";
import { MarkdownContent, MarkdownEditor } from "@/components/markdown";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiUrl } from "@/lib/config";
import { randomLabelColor } from "@/lib/label-colors";
import {
  createGoalUpdate,
  createGoal,
  createGoalLabel,
  deleteGoal,
  getGoal,
  listGoalLabels,
  listGoalUpdates,
  updateGoal,
  goalHealthValues,
  goalStatuses,
  type Goal,
  type GoalCriterion,
  type GoalEvaluationResult,
  type GoalHealth,
  type GoalFormInput,
  type GoalLabel,
  type GoalStatus,
  type GoalTimeframe,
  type GoalUpdate
} from "@/lib/goals-client";

const statusLabels: Record<GoalStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived"
};

const evaluationLabels: Record<GoalEvaluationResult, string> = {
  met: "Met",
  not_met: "Not met",
  unknown: "Unknown"
};

const healthLabels: Record<GoalHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track"
};

export const Route = createFileRoute("/_authenticated/goals/$goalId")({
  component: GoalDetailPage
});

function GoalDetailPage() {
  const { goalId } = Route.useParams();
  const isDraft = goalId === "new";
  const auth = useAuth();
  const navigate = useNavigate();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [updates, setUpdates] = useState<GoalUpdate[]>([]);
  const [labels, setLabels] = useState<GoalLabel[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    "save" | "publish" | "update" | "label" | "delete" | null
  >(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [updateDraft, setUpdateDraft] = useState<{
    kind: "report" | "status-change";
    status: GoalStatus;
  } | null>(null);
  const [updateSummary, setUpdateSummary] = useState("");
  const [updateDetails, setUpdateDetails] = useState("");
  const [updateHealth, setUpdateHealth] = useState<
    "unchanged" | GoalHealth
  >("unchanged");
  const [updateEvaluation, setUpdateEvaluation] = useState<
    "unchanged" | GoalEvaluationResult
  >("unchanged");
  const [updateEvaluationAsOf, setUpdateEvaluationAsOf] = useState("");
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelDescription, setNewLabelDescription] = useState("");
  const [newLabelColor, setNewLabelColor] = useState(randomLabelColor);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [timeframeKind, setTimeframeKind] = useState<GoalTimeframe["kind"]>(
    "unspecified"
  );
  const [targetDate, setTargetDate] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<GoalCriterion[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    void (async () => {
      try {
        const [nextLabels, nextMembers] = await Promise.all([
          listGoalLabels(apiUrl, controller.signal),
          listOrganizationMembers(apiUrl, controller.signal)
        ]);
        if (controller.signal.aborted) return;
        setLabels(nextLabels);
        setMembers(nextMembers);
        if (isDraft) {
          const currentMember = nextMembers.find(
            (member) => member.userId === auth.session?.user.id
          );
          setGoal(null);
          setUpdates([]);
          setTitle("");
          setDescription("");
          setTimeframeKind("unspecified");
          setTargetDate("");
          setOwnerUserId(currentMember?.userId ?? null);
          setSelectedLabelIds([]);
          setCriteria([]);
          setStatus("ready");
          return;
        }
        const [nextGoal, nextUpdates] = await Promise.all([
          getGoal(apiUrl, goalId, controller.signal),
          listGoalUpdates(apiUrl, goalId, controller.signal)
        ]);
        if (controller.signal.aborted) return;
        setGoal(nextGoal);
        setUpdates(nextUpdates);
        resetForm(nextGoal);
        setStatus("ready");
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Unable to load the goal.");
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [auth.session?.activeOrganizationId, auth.session?.user.id, goalId, isDraft]);

  function resetForm(nextGoal: Goal) {
    setTitle(nextGoal.title);
    setDescription(nextGoal.detailedDescription);
    setTimeframeKind(nextGoal.timeframe.kind);
    setTargetDate(
      nextGoal.timeframe.kind === "deadline"
        ? nextGoal.timeframe.targetDate
        : ""
    );
    setOwnerUserId(nextGoal.ownerUserId);
    setSelectedLabelIds(nextGoal.labels.map((label) => label.id));
    setCriteria(nextGoal.criteria.map((criterion) => ({ ...criterion })));
  }

  const formInput = useMemo<GoalFormInput>(
    () => ({
      title: title.trim(),
      detailedDescription: description.trim(),
      timeframe: formTimeframe(timeframeKind, targetDate),
      ownerUserId,
      labelIds: selectedLabelIds,
      criteria: criteria.map((criterion) => ({
        title: criterion.title.trim(),
        description: criterion.description.trim()
      }))
    }),
    [criteria, description, ownerUserId, selectedLabelIds, targetDate, timeframeKind, title]
  );
  const formValid =
    Boolean(formInput.title && formInput.detailedDescription) &&
    (formInput.timeframe.kind !== "deadline" ||
      Boolean(formInput.timeframe.targetDate)) &&
    formInput.criteria.every(
      (criterion) => criterion.title && criterion.description
    );
  const dirty = goal ? !sameGoalForm(goal, formInput) : false;
  const publishValid = formValid && formInput.timeframe.kind !== "unspecified";

  async function saveEdits(): Promise<Goal | null> {
    if (!goal || !formValid) return null;
    if (!dirty) return goal;
    const saved = await updateGoal(apiUrl, goal.id, formInput);
    setGoal(saved);
    resetForm(saved);
    return saved;
  }

  async function handleSave() {
    setBusyAction("save");
    setError(null);
    try {
      await saveEdits();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the goal.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePublish() {
    if (!isDraft || !publishValid) return;
    setBusyAction("publish");
    setError(null);
    try {
      const published = await createGoal(apiUrl, formInput);
      await navigate({
        to: "/goals/$goalId",
        params: { goalId: published.id },
        replace: true
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to publish the goal."
      );
    } finally {
      setBusyAction(null);
    }
  }

  function beginStatusUpdate(nextStatus: GoalStatus) {
    setError(null);
    setUpdateDraft({ kind: "status-change", status: nextStatus });
    setUpdateSummary("");
    setUpdateDetails("");
    resetReportDraft();
  }

  function beginProgressUpdate() {
    if (!goal) return;
    setError(null);
    setUpdateDraft({ kind: "report", status: goal.status });
    setUpdateSummary("");
    setUpdateDetails("");
    resetReportDraft();
  }

  function resetReportDraft() {
    setUpdateHealth("unchanged");
    setUpdateEvaluation("unchanged");
    setUpdateEvaluationAsOf(toLocalDateTime(new Date()));
  }

  async function handleGoalUpdate() {
    if (
      !goal ||
      !updateDraft ||
      !updateSummary.trim() ||
      !updateDetails.trim()
    ) {
      return;
    }
    setBusyAction("update");
    setError(null);
    try {
      const update = await createGoalUpdate(apiUrl, goal, {
        status: updateDraft.status,
        health:
          updateDraft.status === "completed" || updateDraft.status === "archived"
            ? null
            : updateHealth === "unchanged"
              ? null
              : updateHealth,
        evaluation:
          updateEvaluation === "unchanged"
            ? null
            : {
                result: updateEvaluation,
                asOf: new Date(updateEvaluationAsOf).toISOString()
              },
        summary: updateSummary.trim(),
        details: updateDetails.trim()
      });
      setGoal((current) =>
        current
          ? {
              ...current,
              status: update.status,
              health:
                update.status === "completed" || update.status === "archived"
                  ? null
                  : update.health ?? current.health,
              currentEvaluation: update.evaluation ?? current.currentEvaluation,
              revision: update.revision,
              updatedAt: update.createdAt,
              updatedByUserId: update.authorityUserId
            }
          : current
      );
      setUpdates((current) => [...current, update]);
      setUpdateDraft(null);
      setUpdateSummary("");
      setUpdateDetails("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to post the goal update."
      );
    } finally {
      setBusyAction(null);
    }
  }

  function beginLabelCreate() {
    setError(null);
    setNewLabelName("");
    setNewLabelDescription("");
    setNewLabelColor(randomLabelColor());
    setLabelDialogOpen(true);
  }

  async function handleCreateLabel() {
    if (!newLabelName.trim()) return;
    setBusyAction("label");
    setError(null);
    try {
      const label = await createGoalLabel(apiUrl, {
        name: newLabelName.trim(),
        description: newLabelDescription.trim() || null,
        color: newLabelColor
      });
      setLabels((current) =>
        [...current, label].sort((left, right) =>
          left.name.localeCompare(right.name)
        )
      );
      setSelectedLabelIds((current) => [...current, label.id]);
      setLabelDialogOpen(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to create the label."
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete() {
    if (!goal) return;
    setBusyAction("delete");
    setError(null);
    try {
      await deleteGoal(apiUrl, goal.id);
      await navigate({ to: "/goals", replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete the goal.");
      setBusyAction(null);
    }
  }

  if (status === "loading") return <DetailSkeleton />;

  if (status === "error" || (!isDraft && !goal)) {
    return (
      <div className="space-y-5">
        <Button variant="ghost" onClick={() => void navigate({ to: "/goals" })}>
          <ArrowLeftIcon />
          Back to goals
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error ?? "The goal could not be found."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const membersById = new Map(members.map((member) => [member.userId, member]));

  return (
    <div className="space-y-6">
      <Button variant="ghost" className="-ml-2" onClick={() => void navigate({ to: "/goals" })}>
        <ArrowLeftIcon />
        Back to goals
      </Button>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <EditableGoalTitle
              value={title}
              disabled={busyAction !== null}
              onChange={setTitle}
            />
            {!isDraft && goal ? (
              <>
                <GoalStatusSelector
                  status={goal.status}
                  disabled={busyAction !== null}
                  onSelect={beginStatusUpdate}
                />
                <GoalHealthBadge health={goal.health} />
              </>
            ) : null}
          </div>
          {!isDraft ? (
            <p className="text-sm text-muted-foreground">
              Revision {goal?.revision} · {timeframeLabel(goal!.timeframe)} · {evaluationLabel(goal!.currentEvaluation)} · Updated {formatDateTime(goal!.updatedAt)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {isDraft ? (
            <Button
              disabled={!publishValid || busyAction !== null}
              onClick={() => void handlePublish()}
            >
              <RocketIcon />
              {busyAction === "publish" ? "Publishing…" : "Publish"}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busyAction !== null}
                onClick={beginProgressUpdate}
              >
                <PlusIcon />
                Post update
              </Button>
              {dirty ? (
                <Button
                  variant="outline"
                  disabled={!formValid || busyAction !== null}
                  onClick={() => void handleSave()}
                >
                  <CheckIcon />
                  {busyAction === "save" ? "Saving…" : "Save changes"}
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busyAction !== null}
                    aria-label="Goal actions"
                  >
                    <EllipsisVerticalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2Icon />
                    Delete goal
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]">
        <section className="space-y-7">
            <div className="space-y-2">
              <Label htmlFor="goal-description">Detailed description</Label>
              <MarkdownEditor
                id="goal-description"
                value={description}
                disabled={busyAction !== null}
                minHeightClassName="min-h-52"
                onChange={setDescription}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="goal-timeframe">Timeframe</Label>
                <Select
                  value={timeframeKind}
                  disabled={busyAction !== null}
                  onValueChange={(value) => {
                    setTimeframeKind(value as GoalTimeframe["kind"]);
                    if (value !== "deadline") setTargetDate("");
                  }}
                >
                  <SelectTrigger id="goal-timeframe" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unspecified">Choose timeframe</SelectItem>
                    <SelectItem value="deadline">Target date</SelectItem>
                    <SelectItem value="continuous">Continuous</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {timeframeKind === "deadline" ? (
                <div className="space-y-2">
                  <Label htmlFor="goal-target-date">Target date</Label>
                  <Input
                    id="goal-target-date"
                    type="date"
                    value={targetDate}
                    disabled={busyAction !== null}
                    onChange={(event) => setTargetDate(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Owner</Label>
              <OrganizationMemberSelector
                members={members}
                value={ownerUserId}
                disabled={busyAction !== null}
                onChange={setOwnerUserId}
              />
            </div>
            <div className="space-y-3">
              <Label>Labels</Label>
              {labels.length === 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>No labels are defined for this organization.</span>
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={beginLabelCreate}
                  >
                    Create label
                  </button>
                </div>
              ) : (
                <GoalLabelSelector
                  labels={labels}
                  value={selectedLabelIds}
                  disabled={busyAction !== null}
                  onChange={setSelectedLabelIds}
                  onCreate={beginLabelCreate}
                />
              )}
            </div>
            <CriteriaEditor
              criteria={criteria}
              disabled={busyAction !== null}
              onChange={setCriteria}
            />
        </section>

        <aside className="self-start border-t pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <h2 className="mb-6 text-lg font-semibold">History</h2>
          {isDraft ? (
            <article className="grid grid-cols-[1rem_1fr] gap-3 opacity-60">
              <span className="mt-1.5 size-2.5 rounded-full border border-dashed border-primary bg-workspace ring-1 ring-primary/50" />
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">Goal published</h3>
                  <GoalStatusBadge status="active" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Pending publication · Revision 1
                </p>
              </div>
            </article>
          ) : (
              <div className="relative space-y-0" aria-label="Goal history">
                {[...updates].reverse().map((update, index) => (
                <article key={update.id} className="relative grid grid-cols-[1rem_1fr] gap-3 pb-6 last:pb-0">
                  {index < updates.length - 1 ? (
                    <span className="absolute bottom-0 left-[0.3125rem] top-3 w-px bg-border" />
                  ) : null}
                  <span className="relative z-10 mt-1.5 size-2.5 rounded-full border-2 border-background bg-primary ring-1 ring-primary" />
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-medium">{update.summary}</h3>
                      <div className="flex flex-wrap gap-2">
                        <GoalStatusBadge status={update.status} />
                        {update.health ? (
                          <GoalHealthBadge health={update.health} />
                        ) : null}
                      </div>
                    </div>
                    <MarkdownContent className="text-muted-foreground">
                      {update.details}
                    </MarkdownContent>
                    {update.evaluation ? (
                      <p className="text-sm font-medium">
                        Evaluation: {evaluationLabels[update.evaluation.result]} as of {formatDateTime(update.evaluation.asOf)}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {actorName(update, membersById)} · {formatDateTime(update.createdAt)} · Revision {update.revision}
                    </p>
                  </div>
                </article>
                ))}
              </div>
          )}
        </aside>
      </div>

      <Dialog
        open={labelDialogOpen}
        onOpenChange={(open) => {
          if (busyAction !== "label") setLabelDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create label</DialogTitle>
            <DialogDescription>
              The new label will be selected for this goal automatically.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-5 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-2">
              <Label htmlFor="new-goal-label-name">Name</Label>
              <Input
                id="new-goal-label-name"
                value={newLabelName}
                maxLength={64}
                disabled={busyAction === "label"}
                autoFocus
                onChange={(event) => setNewLabelName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-goal-label-color">Color</Label>
              <Input
                id="new-goal-label-color"
                type="color"
                value={newLabelColor}
                disabled={busyAction === "label"}
                className="p-1"
                onChange={(event) => setNewLabelColor(event.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-goal-label-description">Description</Label>
              <Input
                id="new-goal-label-description"
                value={newLabelDescription}
                maxLength={500}
                disabled={busyAction === "label"}
                placeholder="When should this label be used?"
                onChange={(event) => setNewLabelDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busyAction === "label"}
              onClick={() => setLabelDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={busyAction === "label" || !newLabelName.trim()}
              onClick={() => void handleCreateLabel()}
            >
              {busyAction === "label" ? "Creating…" : "Create label"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={updateDraft !== null}
        onOpenChange={(open) => {
          if (!open && busyAction !== "update") setUpdateDraft(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {updateDraft?.kind === "report"
                ? "Post status update"
                : `Change status to ${
                    updateDraft ? statusLabels[updateDraft.status] : ""
                  }`}
            </DialogTitle>
            <DialogDescription>
              {updateDraft?.kind === "report"
                ? "Share progress and set the goal’s resulting status. Leaving it unchanged records an ongoing status report."
                : "Record why the goal changed state. This update becomes part of its permanent history."}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="status-update-status">Status</Label>
              <Select
                value={updateDraft?.status}
                disabled={busyAction === "update"}
                onValueChange={(value) => {
                  if (value === "completed" || value === "archived") {
                    setUpdateHealth("unchanged");
                  }
                  setUpdateDraft((current) =>
                    current
                      ? { ...current, status: value as GoalStatus }
                      : current
                  )
                }}
              >
                <SelectTrigger id="status-update-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {goalStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {statusLabels[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status-update-health">Health</Label>
              <Select
                value={updateHealth}
                disabled={
                  busyAction === "update" ||
                  updateDraft?.status === "completed" ||
                  updateDraft?.status === "archived"
                }
                onValueChange={(value) =>
                  setUpdateHealth(value as "unchanged" | GoalHealth)
                }
              >
                <SelectTrigger id="status-update-health" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unchanged">
                    {updateDraft?.status === "completed" ||
                    updateDraft?.status === "archived"
                      ? "Not applicable"
                      : "No new health report"}
                  </SelectItem>
                  {goalHealthValues.map((health) => (
                    <SelectItem key={health} value={health}>
                      {healthLabels[health]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="status-update-evaluation">Evaluation</Label>
                <Select
                  value={updateEvaluation}
                  disabled={busyAction === "update"}
                  onValueChange={(value) =>
                    setUpdateEvaluation(
                      value as "unchanged" | GoalEvaluationResult
                    )
                  }
                >
                  <SelectTrigger id="status-update-evaluation" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unchanged">No new evaluation</SelectItem>
                    <SelectItem value="met">Met</SelectItem>
                    <SelectItem value="not_met">Not met</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {updateEvaluation !== "unchanged" ? (
                <div className="space-y-2">
                  <Label htmlFor="status-update-evaluation-as-of">As of</Label>
                  <Input
                    id="status-update-evaluation-as-of"
                    type="datetime-local"
                    value={updateEvaluationAsOf}
                    disabled={busyAction === "update"}
                    onChange={(event) =>
                      setUpdateEvaluationAsOf(event.target.value)
                    }
                  />
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="status-update-summary">Summary</Label>
              <Input
                id="status-update-summary"
                value={updateSummary}
                maxLength={500}
                disabled={busyAction === "update"}
                placeholder={
                  updateDraft?.kind === "report"
                    ? "What progress was made?"
                    : "What changed?"
                }
                autoFocus
                onChange={(event) => setUpdateSummary(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status-update-details">Details</Label>
              <MarkdownEditor
                id="status-update-details"
                value={updateDetails}
                disabled={busyAction === "update"}
                placeholder={
                  updateDraft?.kind === "report"
                    ? "Share results, blockers, decisions, or next steps."
                    : "Explain the context for this status change."
                }
                onChange={setUpdateDetails}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busyAction === "update"}
              onClick={() => setUpdateDraft(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                busyAction === "update" ||
                !updateSummary.trim() ||
                !updateDetails.trim() ||
                (updateEvaluation !== "unchanged" && !updateEvaluationAsOf)
              }
              onClick={() => void handleGoalUpdate()}
            >
              {busyAction === "update"
                ? updateDraft?.kind === "report"
                  ? "Posting…"
                  : "Updating…"
                : updateDraft?.kind === "report"
                  ? "Post update"
                  : "Update status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!isDraft && goal ? <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (busyAction !== "delete") setDeleteDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {goal.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the goal and its complete status history.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction === "delete"}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busyAction === "delete"}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {busyAction === "delete" ? "Deleting…" : "Delete goal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog> : null}
    </div>
  );
}

function EditableGoalTitle({
  value,
  disabled,
  onChange
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (titleRef.current && titleRef.current.textContent !== value) {
      titleRef.current.textContent = value;
    }
  }, [value]);

  return (
    <div className="group/title flex min-w-0 items-center gap-2">
      <h1
        ref={titleRef}
        contentEditable={!disabled ? "plaintext-only" : false}
        suppressContentEditableWarning
        role="textbox"
        aria-label="Goal title"
        aria-multiline="false"
        data-placeholder="Untitled goal"
        className="min-w-0 truncate rounded-md px-1 py-0.5 text-3xl font-semibold tracking-tight outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] hover:bg-muted/60 focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        onInput={(event) => {
          const nextValue = event.currentTarget.textContent ?? "";
          if (nextValue.length <= 200) {
            onChange(nextValue);
          } else {
            event.currentTarget.textContent = value;
          }
        }}
        onBlur={(event) => {
          const nextValue = (event.currentTarget.textContent ?? "").trim();
          event.currentTarget.textContent = nextValue;
          onChange(nextValue);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      {!disabled ? (
        <span className="pointer-events-none flex shrink-0 items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-within/title:opacity-100">
          <PencilIcon className="size-3" />
          Edit title
        </span>
      ) : null}
    </div>
  );
}

function GoalStatusSelector({
  status,
  disabled,
  onSelect
}: {
  status: GoalStatus;
  disabled: boolean;
  onSelect: (status: GoalStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Change status from ${statusLabels[status]}`}
          className="inline-flex items-center gap-0.5 rounded-full transition-opacity hover:opacity-75 disabled:pointer-events-none disabled:opacity-50"
        >
          <GoalStatusBadge status={status} />
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Change status to</DropdownMenuLabel>
        {goalStatuses
          .filter((candidate) => candidate !== status)
          .map((candidate) => (
            <DropdownMenuItem
              key={candidate}
              onSelect={() => onSelect(candidate)}
            >
              {statusLabels[candidate]}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OrganizationMemberSelector({
  members,
  value,
  disabled,
  onChange
}: {
  members: OrganizationMember[];
  value: string | null;
  disabled: boolean;
  onChange: (userId: string | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = members.find((member) => member.userId === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleMembers = members.filter((member) =>
    normalizedQuery
      ? `${member.displayName} ${member.email ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      : true
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function selectMember(member: OrganizationMember) {
    onChange(member.userId);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        className="flex min-h-10 w-full cursor-text items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1.5 transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 hover:border-ring/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 dark:bg-input/30"
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {selected ? (
          <span className="group/member inline-flex max-w-[70%] shrink-0 items-center gap-1.5 rounded-full bg-muted py-0.5 pl-1 pr-1.5 text-sm">
            <Avatar className="size-6">
              <AvatarFallback className="text-[0.625rem]">
                {memberInitials(selected.displayName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{selected.displayName}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Unassign ${selected.displayName}`}
              className="ml-0.5 grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition hover:bg-foreground/10 hover:text-foreground group-hover/member:opacity-100 focus:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onChange(null);
                setQuery("");
                setOpen(false);
              }}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ) : value ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-1 text-sm text-muted-foreground">
            Former member
          </span>
        ) : null}
        <input
          ref={inputRef}
          value={query}
          disabled={disabled}
          role="combobox"
          aria-label="Goal owner"
          aria-expanded={open}
          aria-controls="goal-owner-options"
          autoComplete="off"
          placeholder={selected ? undefined : "Search organization members"}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              event.currentTarget.blur();
            } else if (event.key === "Enter" && visibleMembers[0]) {
              event.preventDefault();
              selectMember(visibleMembers[0]);
            }
          }}
        />
      </div>
      {open ? (
        <div
          id="goal-owner-options"
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        >
          {visibleMembers.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No members found.
            </p>
          ) : (
            visibleMembers.map((member) => (
              <button
                key={member.userId}
                type="button"
                role="option"
                aria-selected={member.userId === value}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted focus:bg-muted focus:outline-none"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMember(member)}
              >
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs">
                    {memberInitials(member.displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {member.displayName}
                  </span>
                  {member.email ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  ) : null}
                </span>
                {member.userId === value ? (
                  <CheckIcon className="size-4 text-primary" />
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function GoalLabelSelector({
  labels,
  value,
  disabled,
  onChange,
  onCreate
}: {
  labels: GoalLabel[];
  value: string[];
  disabled: boolean;
  onChange: (labelIds: string[]) => void;
  onCreate: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const labelsById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels]
  );
  const selectedLabels = value.flatMap((labelId) => {
    const label = labelsById.get(labelId);
    return label ? [label] : [];
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleLabels = labels.filter((label) =>
    normalizedQuery
      ? `${label.name} ${label.description ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      : true
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function toggleLabel(labelId: string) {
    onChange(
      value.includes(labelId)
        ? value.filter((candidate) => candidate !== labelId)
        : [...value, labelId]
    );
    setQuery("");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        className="flex min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1.5 transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 hover:border-ring/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 dark:bg-input/30"
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {selectedLabels.map((label) => (
          <span
            key={label.id}
            className="group/label inline-flex max-w-[70%] shrink-0 items-center gap-1.5 rounded-full bg-muted py-1 pl-2 pr-1 text-sm"
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: label.color ?? "#64748b" }}
            />
            <span className="truncate">{label.name}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${label.name}`}
              className="ml-0.5 grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition hover:bg-foreground/10 hover:text-foreground group-hover/label:opacity-100 focus:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((candidate) => candidate !== label.id));
              }}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          disabled={disabled}
          role="combobox"
          aria-label="Goal labels"
          aria-expanded={open}
          aria-controls="goal-label-options"
          autoComplete="off"
          placeholder={selectedLabels.length === 0 ? "Search labels" : undefined}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              event.currentTarget.blur();
            } else if (event.key === "Enter" && visibleLabels[0]) {
              event.preventDefault();
              toggleLabel(visibleLabels[0].id);
            }
          }}
        />
      </div>
      {open ? (
        <div
          id="goal-label-options"
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        >
          <div className="max-h-64 overflow-y-auto p-1">
            {visibleLabels.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No labels found.
              </p>
            ) : (
              visibleLabels.map((label) => {
                const selected = value.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-muted focus:bg-muted focus:outline-none"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggleLabel(label.id)}
                  >
                    <span
                      className="mt-1.5 size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color ?? "#64748b" }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {label.name}
                      </span>
                      {label.description ? (
                        <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {label.description}
                        </span>
                      ) : null}
                    </span>
                    {selected ? (
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t p-1">
            <button
              type="button"
              className="block w-full rounded-md px-2 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
            >
              Create label
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function memberInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

function CriteriaEditor({
  criteria,
  disabled,
  onChange
}: {
  criteria: GoalCriterion[];
  disabled: boolean;
  onChange: (criteria: GoalCriterion[]) => void;
}) {
  function updateCriterion(index: number, update: Partial<GoalCriterion>) {
    onChange(
      criteria.map((criterion, candidateIndex) =>
        candidateIndex === index ? { ...criterion, ...update } : criterion
      )
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Success criteria</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Concrete checks that indicate the goal has been achieved.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || criteria.length >= 100}
          onClick={() => onChange([...criteria, { title: "", description: "" }])}
        >
          <PlusIcon />
          Add criterion
        </Button>
      </div>
      {criteria.map((criterion, index) => (
        <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Input
              value={criterion.title}
              maxLength={200}
              disabled={disabled}
              aria-label={`Criterion ${index + 1} title`}
              placeholder="Criterion title"
              onChange={(event) => updateCriterion(index, { title: event.target.value })}
            />
            <textarea
              value={criterion.description}
              maxLength={10_000}
              disabled={disabled}
              aria-label={`Criterion ${index + 1} description`}
              placeholder="Describe the evidence or condition"
              onChange={(event) =>
                updateCriterion(index, { description: event.target.value })
              }
              className="min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Remove criterion ${index + 1}`}
            onClick={() => onChange(criteria.filter((_, candidateIndex) => candidateIndex !== index))}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading goal">
      <Skeleton className="h-8 w-28" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-10 w-2/3" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.45fr_0.8fr]">
        <Skeleton className="h-[38rem] rounded-xl" />
        <Skeleton className="h-[28rem] rounded-xl" />
      </div>
    </div>
  );
}

function sameGoalForm(goal: Goal, input: GoalFormInput): boolean {
  return (
    goal.title === input.title &&
    goal.detailedDescription === input.detailedDescription &&
    JSON.stringify(goal.timeframe) === JSON.stringify(input.timeframe) &&
    goal.ownerUserId === input.ownerUserId &&
    JSON.stringify(goal.labels.map((label) => label.id).sort()) ===
      JSON.stringify([...input.labelIds].sort()) &&
    JSON.stringify(goal.criteria) === JSON.stringify(input.criteria)
  );
}

function formTimeframe(
  kind: GoalTimeframe["kind"],
  targetDate: string
): GoalTimeframe {
  return kind === "deadline"
    ? { kind: "deadline", targetDate }
    : { kind };
}

function timeframeLabel(timeframe: GoalTimeframe): string {
  if (timeframe.kind === "deadline") {
    return `Target ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: "UTC"
    }).format(new Date(`${timeframe.targetDate}T00:00:00.000Z`))}`;
  }
  return timeframe.kind === "continuous" ? "Continuous" : "Timeframe unspecified";
}

function evaluationLabel(evaluation: Goal["currentEvaluation"]): string {
  return evaluation
    ? `${evaluationLabels[evaluation.result]} as of ${formatDateTime(evaluation.asOf)}`
    : "Not evaluated";
}

function toLocalDateTime(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function actorName(
  update: GoalUpdate,
  members: Map<string, OrganizationMember>
): string {
  if (update.actor.kind === "user") {
    return members.get(update.actor.id)?.displayName ?? "Former member";
  }
  if (update.actor.kind === "agent") return `Agent ${update.actor.id}`;
  return `Client ${update.actor.id}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
