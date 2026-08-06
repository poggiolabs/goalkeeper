import { useMemo, useState } from "react";
import { PlusIcon, TagsIcon, Trash2Icon } from "lucide-react";
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
import { apiUrl } from "@/lib/config";
import {
  createGoalLabel,
  deleteGoalLabel,
  updateGoalLabel,
  type Goal,
  type GoalLabel
} from "@/lib/goals-client";
import { randomLabelColor } from "@/lib/label-colors";

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
  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const goal of goals) {
      for (const label of goal.labels) {
        counts.set(label.id, (counts.get(label.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [goals]);

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
              usageCount={usageCounts.get(label.id) ?? 0}
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
