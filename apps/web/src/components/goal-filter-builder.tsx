import { useRef } from "react";
import { FilterIcon, PlusIcon, XIcon } from "lucide-react";
import type { OrganizationMember } from "@/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  CURRENT_USER_FILTER_VALUE,
  type GoalFilter
} from "@/lib/goal-filters";
import {
  goalHealthValues,
  goalStatuses,
  type GoalHealth,
  type GoalLabel,
  type GoalStatus
} from "@/lib/goals-client";

const statusLabels: Record<GoalStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived"
};

const healthLabels: Record<GoalHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track"
};

export function GoalFilterBuilder({
  filters,
  members,
  labels,
  currentUserId,
  onChange
}: {
  filters: GoalFilter[];
  members: OrganizationMember[];
  labels: GoalLabel[];
  currentUserId: string | undefined;
  onChange: (filters: GoalFilter[]) => void;
}) {
  const nextId = useRef(0);

  function addFilter(subject: GoalFilter["subject"]) {
    const base = { id: `${subject}-${nextId.current++}`, values: [] };
    const filter: GoalFilter =
      subject === "label"
        ? { ...base, subject, operator: "contains" }
        : { ...base, subject, operator: "is" };
    onChange([...filters, filter]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Goal filters">
      {filters.map((filter) => (
        <FilterChip
          key={filter.id}
          filter={filter}
          members={members}
          labels={labels}
          currentUserId={currentUserId}
          onChange={(next) =>
            onChange(
              filters.map((candidate) =>
                candidate.id === filter.id ? next : candidate
              )
            )
          }
          onRemove={() =>
            onChange(filters.filter((candidate) => candidate.id !== filter.id))
          }
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <PlusIcon />
            Add filter
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>Filter goals by</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => addFilter("owner")}>
            Owner
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addFilter("status")}>
            Status
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addFilter("health")}>
            Health
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addFilter("label")}>
            Label
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {filters.length > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => onChange([])}>
          Clear all
        </Button>
      ) : null}
    </div>
  );
}

function FilterChip({
  filter,
  members,
  labels,
  currentUserId,
  onChange,
  onRemove
}: {
  filter: GoalFilter;
  members: OrganizationMember[];
  labels: GoalLabel[];
  currentUserId: string | undefined;
  onChange: (filter: GoalFilter) => void;
  onRemove: () => void;
}) {
  const subject =
    filter.subject === "owner"
      ? "Owner"
      : filter.subject === "status"
        ? "Status"
        : filter.subject === "health"
          ? "Health"
          : "Label";
  const operator = filter.operator.replaceAll("_", " ");
  const names =
    filter.subject === "owner"
      ? filter.values.map(
          (value) =>
            value === CURRENT_USER_FILTER_VALUE
              ? "Me"
              : members.find((member) => member.userId === value)?.displayName ??
                value
        )
      : filter.subject === "status"
        ? filter.values.map((value) => statusLabels[value])
        : filter.subject === "health"
          ? filter.values.map((value) => healthLabels[value])
          : filter.values.map(
              (value) => labels.find((label) => label.id === value)?.name ?? value
            );
  const summary =
    names.length === 0
      ? "Select…"
      : names.length < 3
        ? names.join(", ")
        : `${names.length} selected`;

  function toggleValue(value: string) {
    const values = filter.values.includes(value as never)
      ? filter.values.filter((candidate) => candidate !== value)
      : [...filter.values, value];
    onChange({ ...filter, values } as GoalFilter);
  }

  const negative =
    filter.operator === "is_not" || filter.operator === "does_not_contain";

  return (
    <div className="inline-flex items-stretch rounded-lg border bg-background shadow-xs">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="rounded-r-none">
            <FilterIcon />
            <span className="text-muted-foreground">{subject}</span>
            <span>{operator}</span>
            <strong className="max-w-40 truncate">{summary}</strong>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start">
          <DropdownMenuLabel>{subject} filter</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={negative}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => {
              if (filter.subject === "label") {
                onChange({
                  ...filter,
                  operator: checked ? "does_not_contain" : "contains"
                });
              } else {
                onChange({ ...filter, operator: checked ? "is_not" : "is" });
              }
            }}
          >
            Exclude matches
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {filter.subject === "owner" ? (
            <>
              <FilterValue
                checked={filter.values.includes(CURRENT_USER_FILTER_VALUE)}
                onToggle={() => toggleValue(CURRENT_USER_FILTER_VALUE)}
              >
                Me
              </FilterValue>
              {members
                .filter((member) => member.userId !== currentUserId)
                .map((member) => (
                  <FilterValue
                    key={member.userId}
                    checked={filter.values.includes(member.userId)}
                    onToggle={() => toggleValue(member.userId)}
                  >
                    {member.displayName}
                  </FilterValue>
                ))}
            </>
          ) : null}
          {filter.subject === "status"
            ? goalStatuses.map((status) => (
                <FilterValue
                  key={status}
                  checked={filter.values.includes(status)}
                  onToggle={() => toggleValue(status)}
                >
                  {statusLabels[status]}
                </FilterValue>
              ))
            : null}
          {filter.subject === "health"
            ? goalHealthValues.map((health) => (
                <FilterValue
                  key={health}
                  checked={filter.values.includes(health)}
                  onToggle={() => toggleValue(health)}
                >
                  {healthLabels[health]}
                </FilterValue>
              ))
            : null}
          {filter.subject === "label"
            ? labels.map((label) => (
                <FilterValue
                  key={label.id}
                  checked={filter.values.includes(label.id)}
                  onToggle={() => toggleValue(label.id)}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: label.color ?? "#64748b" }}
                  />
                  {label.name}
                </FilterValue>
              ))
            : null}
          {filter.subject === "label" && labels.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No options available.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-auto rounded-l-none border-l"
        aria-label={`Remove ${subject.toLowerCase()} filter`}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </div>
  );
}

function FilterValue({
  checked,
  onToggle,
  children
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onSelect={(event) => event.preventDefault()}
      onCheckedChange={onToggle}
    >
      {children}
    </DropdownMenuCheckboxItem>
  );
}
