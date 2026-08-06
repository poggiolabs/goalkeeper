import type { OrganizationMember } from "@/auth-client";
import type {
  Goal,
  GoalHealth,
  GoalLabel,
  GoalStatus
} from "@/lib/goals-client";

export const CURRENT_USER_FILTER_VALUE = "__me";

const GOAL_FILTERS_QUERY_PARAM = "filters";
const GOAL_FILTERS_URL_VERSION = 1;
const FILTER_QUERY_KEY_PATTERN =
  /^(owner|owner_not|status|status_not|health|health_not|label|label_not)(?:\.([1-9]\d*))?$/;
const FILTER_QUERY_KEY_CLEANUP_PATTERN =
  /^(owner|owner_not|status|status_not|health|health_not|label|label_not)(?:\..*)?$/;
const MAX_FILTER_EXPRESSIONS = 20;
const MAX_FILTER_VALUES = 50;
const MAX_FILTER_VALUE_LENGTH = 200;
const MAX_FILTERS_QUERY_LENGTH = 20_000;
const VALID_GOAL_STATUSES: readonly GoalStatus[] = [
  "active",
  "paused",
  "completed",
  "archived"
];
const VALID_GOAL_HEALTH_VALUES: readonly GoalHealth[] = [
  "on_track",
  "at_risk",
  "off_track"
];

export type GoalFilter =
  | {
      id: string;
      subject: "owner";
      operator: "is" | "is_not";
      values: string[];
    }
  | {
      id: string;
      subject: "status";
      operator: "is" | "is_not";
      values: GoalStatus[];
    }
  | {
      id: string;
      subject: "health";
      operator: "is" | "is_not";
      values: GoalHealth[];
    }
  | {
      id: string;
      subject: "label";
      operator: "contains" | "does_not_contain";
      values: string[];
    };

export function createDefaultGoalFilter(): GoalFilter {
  return {
    id: "default-owner",
    subject: "owner",
    operator: "is",
    values: [CURRENT_USER_FILTER_VALUE]
  };
}

export function writeGoalFiltersToSearchParams(
  params: URLSearchParams,
  filters: GoalFilter[]
): void {
  for (const key of [...params.keys()]) {
    if (
      key === GOAL_FILTERS_QUERY_PARAM ||
      FILTER_QUERY_KEY_CLEANUP_PATTERN.test(key)
    ) {
      params.delete(key);
    }
  }

  if (filters.length === 0) {
    params.set(GOAL_FILTERS_QUERY_PARAM, "none");
    return;
  }

  const keyOccurrences = new Map<string, number>();
  for (const filter of filters) {
    const baseKey = goalFilterQueryKey(filter);
    const occurrence = (keyOccurrences.get(baseKey) ?? 0) + 1;
    keyOccurrences.set(baseKey, occurrence);
    const key = occurrence === 1 ? baseKey : `${baseKey}.${occurrence}`;
    const values = filter.values.length > 0 ? filter.values : [""];
    for (const value of values) {
      params.append(
        key,
        filter.subject === "owner" && value === CURRENT_USER_FILTER_VALUE
          ? "me"
          : value
      );
    }
  }
}

export function readGoalFiltersFromSearchParams(
  params: URLSearchParams
): GoalFilter[] | null {
  const groupedValues = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    if (!FILTER_QUERY_KEY_PATTERN.test(key)) continue;
    const values = groupedValues.get(key) ?? [];
    values.push(value);
    groupedValues.set(key, values);
  }

  if (groupedValues.size > 0) {
    if (groupedValues.size > MAX_FILTER_EXPRESSIONS) return null;
    const filters = [...groupedValues.entries()].map(([key, values], index) =>
      parseReadableGoalFilter(key, values, `url-${index}`)
    );
    return filters.every((filter): filter is GoalFilter => filter !== null)
      ? filters
      : null;
  }

  const legacyValue = params.get(GOAL_FILTERS_QUERY_PARAM);
  if (legacyValue === "none") return [];
  return parseLegacyGoalFilters(legacyValue);
}

export function goalMatchesFilters(
  goal: Goal,
  currentUserId: string,
  filters: GoalFilter[]
): boolean {
  return filters.every((filter) => {
    if (filter.values.length === 0) return true;
    if (filter.subject === "owner") {
      const selectedOwnerIds = filter.values.map((value) =>
        value === CURRENT_USER_FILTER_VALUE ? currentUserId : value
      );
      const matches =
        goal.ownerUserId !== null && selectedOwnerIds.includes(goal.ownerUserId);
      return filter.operator === "is" ? matches : !matches;
    }
    if (filter.subject === "status") {
      const matches = filter.values.includes(goal.status);
      return filter.operator === "is" ? matches : !matches;
    }
    if (filter.subject === "health") {
      const matches =
        goal.health !== null && filter.values.includes(goal.health);
      return filter.operator === "is" ? matches : !matches;
    }
    const matches = filter.values.some((labelId) =>
      goal.labels.some((label) => label.id === labelId)
    );
    return filter.operator === "contains" ? matches : !matches;
  });
}

export function goalMatchesSearch(
  goal: Goal,
  query: string,
  owner: OrganizationMember | undefined
): boolean {
  return fuzzyMatch(query, [
    goal.title,
    goal.detailedDescription,
    goal.ownerUserId === null ? "Unassigned" : "",
    owner?.displayName ?? "",
    owner?.email ?? "",
    ...goal.labels.map((label) => label.name),
    ...goal.criteria.flatMap((criterion) => [
      criterion.title,
      criterion.description
    ])
  ]);
}

export function fuzzyMatch(query: string, candidates: string[]): boolean {
  const haystack = normalize(candidates.join(" "));
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return words.every((word) => isSubsequence(word, haystack));
}

export function repairFilters(
  filters: GoalFilter[],
  members: OrganizationMember[],
  labels: GoalLabel[]
): GoalFilter[] {
  const memberIds = new Set(members.map((member) => member.userId));
  const labelIds = new Set(labels.map((label) => label.id));
  return filters.flatMap((filter) => {
    if (
      filter.values.length === 0 ||
      filter.subject === "status" ||
      filter.subject === "health"
    ) {
      return [filter];
    }
    const values = filter.values.filter((value) =>
      filter.subject === "owner"
        ? value === CURRENT_USER_FILTER_VALUE || memberIds.has(value)
        : labelIds.has(value)
    );
    return values.length > 0 ? [{ ...filter, values } as GoalFilter] : [];
  });
}

function goalFilterQueryKey(filter: GoalFilter): string {
  if (filter.subject === "owner") {
    return filter.operator === "is" ? "owner" : "owner_not";
  }
  if (filter.subject === "status") {
    return filter.operator === "is" ? "status" : "status_not";
  }
  if (filter.subject === "health") {
    return filter.operator === "is" ? "health" : "health_not";
  }
  return filter.operator === "contains" ? "label" : "label_not";
}

function parseReadableGoalFilter(
  key: string,
  rawValues: string[],
  id: string
): GoalFilter | null {
  const baseKey = key.split(".", 1)[0];
  const values = rawValues.filter((value) => value.length > 0);
  if (
    values.length > MAX_FILTER_VALUES ||
    values.some((value) => value.length > MAX_FILTER_VALUE_LENGTH)
  ) {
    return null;
  }

  if (baseKey === "owner" || baseKey === "owner_not") {
    return {
      id,
      subject: "owner",
      operator: baseKey === "owner" ? "is" : "is_not",
      values: values.map((value) =>
        value === "me" ? CURRENT_USER_FILTER_VALUE : value
      )
    };
  }
  if (baseKey === "status" || baseKey === "status_not") {
    if (!values.every(isGoalStatus)) return null;
    return {
      id,
      subject: "status",
      operator: baseKey === "status" ? "is" : "is_not",
      values
    };
  }
  if (baseKey === "health" || baseKey === "health_not") {
    if (!values.every(isGoalHealth)) return null;
    return {
      id,
      subject: "health",
      operator: baseKey === "health" ? "is" : "is_not",
      values
    };
  }
  if (baseKey === "label" || baseKey === "label_not") {
    return {
      id,
      subject: "label",
      operator: baseKey === "label" ? "contains" : "does_not_contain",
      values
    };
  }
  return null;
}

function parseLegacyGoalFilters(value: string | null): GoalFilter[] | null {
  if (value === null || value.length > MAX_FILTERS_QUERY_LENGTH) return null;

  try {
    const payload = JSON.parse(value) as unknown;
    if (
      !isRecord(payload) ||
      payload.version !== GOAL_FILTERS_URL_VERSION ||
      !Array.isArray(payload.expressions) ||
      payload.expressions.length > MAX_FILTER_EXPRESSIONS
    ) {
      return null;
    }

    const filters = payload.expressions.map((filter, index) =>
      parseGoalFilter(filter, `url-${index}`)
    );
    return filters.every((filter): filter is GoalFilter => filter !== null)
      ? filters
      : null;
  } catch {
    return null;
  }
}

function parseGoalFilter(value: unknown, id: string): GoalFilter | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.values) ||
    value.values.length > MAX_FILTER_VALUES ||
    !value.values.every(
      (candidate) =>
        typeof candidate === "string" &&
        candidate.length > 0 &&
        candidate.length <= MAX_FILTER_VALUE_LENGTH
    )
  ) {
    return null;
  }

  if (
    value.subject === "owner" &&
    (value.operator === "is" || value.operator === "is_not")
  ) {
    return {
      id,
      subject: value.subject,
      operator: value.operator,
      values: value.values
    };
  }
  if (
    value.subject === "status" &&
    (value.operator === "is" || value.operator === "is_not") &&
    value.values.every(isGoalStatus)
  ) {
    return {
      id,
      subject: value.subject,
      operator: value.operator,
      values: value.values
    };
  }
  if (
    value.subject === "health" &&
    (value.operator === "is" || value.operator === "is_not") &&
    value.values.every(isGoalHealth)
  ) {
    return {
      id,
      subject: value.subject,
      operator: value.operator,
      values: value.values
    };
  }
  if (
    value.subject === "label" &&
    (value.operator === "contains" || value.operator === "does_not_contain")
  ) {
    return {
      id,
      subject: value.subject,
      operator: value.operator,
      values: value.values
    };
  }
  return null;
}

function isGoalStatus(value: string): value is GoalStatus {
  return (VALID_GOAL_STATUSES as readonly string[]).includes(value);
}

function isGoalHealth(value: string): value is GoalHealth {
  return (VALID_GOAL_HEALTH_VALUES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}
