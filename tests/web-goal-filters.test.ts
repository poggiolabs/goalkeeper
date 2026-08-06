import { describe, expect, test } from "bun:test";
import {
  createDefaultGoalFilter,
  CURRENT_USER_FILTER_VALUE,
  fuzzyMatch,
  goalMatchesFilters,
  goalMatchesSearch,
  readGoalFiltersFromSearchParams,
  repairFilters,
  writeGoalFiltersToSearchParams,
  type GoalFilter
} from "../apps/web/src/lib/goal-filters";
import type { Goal } from "../apps/web/src/lib/goals-client";

const goal: Goal = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  title: "Launch customer analytics",
  detailedDescription: "Ship the reporting workspace for enterprise teams.",
  status: "active",
  health: "on_track",
  timeframe: { kind: "deadline", targetDate: "2026-09-30" },
  currentEvaluation: null,
  ownerUserId: "user-1",
  labels: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      organizationId: "22222222-2222-4222-8222-222222222222",
      name: "Customer-facing",
      color: "#22c55e",
      description: null,
      createdAt: "2026-08-05T12:00:00.000Z",
      createdByUserId: "user-1",
      updatedAt: "2026-08-05T12:00:00.000Z",
      updatedByUserId: "user-1"
    }
  ],
  criteria: [{ title: "Adoption", description: "Ten teams use the report" }],
  revision: 1,
  createdAt: "2026-08-05T12:00:00.000Z",
  createdByUserId: "user-1",
  updatedAt: "2026-08-05T12:00:00.000Z",
  updatedByUserId: "user-1"
};

describe("goal list filtering", () => {
  test("fuzzy search accepts ordered non-contiguous characters", () => {
    expect(fuzzyMatch("lnch cstmr", [goal.title])).toBe(true);
    expect(fuzzyMatch("billing", [goal.title, goal.detailedDescription])).toBe(false);
  });

  test("search includes owners, labels, and criteria", () => {
    const owner = {
      userId: "user-1",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      role: "member" as const
    };
    expect(goalMatchesSearch(goal, "ada customer adoption", owner)).toBe(true);
  });

  test("combines owner, status, health, and label clauses with AND semantics", () => {
    const filters: GoalFilter[] = [
      { id: "owner", subject: "owner", operator: "is", values: ["user-1"] },
      { id: "status", subject: "status", operator: "is", values: ["active"] },
      {
        id: "health",
        subject: "health",
        operator: "is",
        values: ["on_track"]
      },
      {
        id: "label",
        subject: "label",
        operator: "contains",
        values: ["33333333-3333-4333-8333-333333333333"]
      }
    ];
    expect(goalMatchesFilters(goal, "current-user", filters)).toBe(true);
    expect(
      goalMatchesFilters(goal, "current-user", [
        ...filters,
        { id: "paused", subject: "status", operator: "is", values: ["paused"] }
      ])
    ).toBe(false);
  });

  test("defaults to goals owned by the current user", () => {
    expect(goalMatchesFilters(goal, "user-1", [createDefaultGoalFilter()])).toBe(
      true
    );
    expect(goalMatchesFilters(goal, "user-2", [createDefaultGoalFilter()])).toBe(
      false
    );
  });

  test("round-trips readable owner, status, health, and label params", () => {
    const filters: GoalFilter[] = [
      {
        id: "owner-filter",
        subject: "owner",
        operator: "is_not",
        values: [CURRENT_USER_FILTER_VALUE, "user:1"]
      },
      {
        id: "status-filter",
        subject: "status",
        operator: "is",
        values: ["active", "paused"]
      },
      {
        id: "health-filter",
        subject: "health",
        operator: "is_not",
        values: ["at_risk", "off_track"]
      },
      {
        id: "label-filter",
        subject: "label",
        operator: "contains",
        values: ["team/sales", "Quarterly review"]
      }
    ];
    const params = new URLSearchParams("view=compact");

    writeGoalFiltersToSearchParams(params, filters);

    expect(params.toString()).toBe(
      "view=compact&owner_not=me&owner_not=user%3A1&status=active&status=paused&health_not=at_risk&health_not=off_track&label=team%2Fsales&label=Quarterly+review"
    );
    expect(readGoalFiltersFromSearchParams(params)).toEqual([
      { ...filters[0], id: "url-0" },
      { ...filters[1], id: "url-1" },
      { ...filters[2], id: "url-2" },
      { ...filters[3], id: "url-3" }
    ]);
  });

  test("preserves distinct expressions of the same kind", () => {
    const filters: GoalFilter[] = [
      {
        id: "first",
        subject: "label",
        operator: "contains",
        values: ["First"]
      },
      {
        id: "second",
        subject: "label",
        operator: "contains",
        values: ["Second"]
      }
    ];
    const params = new URLSearchParams();

    writeGoalFiltersToSearchParams(params, filters);

    expect(params.toString()).toBe("label=First&label.2=Second");
    expect(readGoalFiltersFromSearchParams(params)).toEqual([
      { ...filters[0], id: "url-0" },
      { ...filters[1], id: "url-1" }
    ]);
  });

  test("round-trips an intentionally empty filter set", () => {
    const params = new URLSearchParams();
    writeGoalFiltersToSearchParams(params, []);
    expect(params.toString()).toBe("filters=none");
    expect(readGoalFiltersFromSearchParams(params)).toEqual([]);
  });

  test("migrates the versioned JSON format to readable params", () => {
    const legacyFilter = {
      subject: "owner",
      operator: "is",
      values: [CURRENT_USER_FILTER_VALUE]
    };
    const params = new URLSearchParams({
      filters: JSON.stringify({ version: 1, expressions: [legacyFilter] })
    });
    const restored = readGoalFiltersFromSearchParams(params);

    expect(restored).toEqual([{ id: "url-0", ...legacyFilter }]);
    writeGoalFiltersToSearchParams(params, restored ?? []);
    expect(params.toString()).toBe("owner=me");
  });

  test("repairs stale references without removing the current-user sentinel", () => {
    const filters: GoalFilter[] = [
      {
        id: "owner",
        subject: "owner",
        operator: "is",
        values: [CURRENT_USER_FILTER_VALUE, "known-user", "missing-user"]
      },
      {
        id: "label",
        subject: "label",
        operator: "contains",
        values: [goal.labels[0].id, "missing-label"]
      },
      {
        id: "missing-label",
        subject: "label",
        operator: "does_not_contain",
        values: ["missing-label"]
      }
    ];

    expect(
      repairFilters(
        filters,
        [
          {
            userId: "known-user",
            displayName: "Known User",
            email: null,
            role: "member"
          }
        ],
        [goal.labels[0]]
      )
    ).toEqual([
      { ...filters[0], values: [CURRENT_USER_FILTER_VALUE, "known-user"] },
      { ...filters[1], values: [goal.labels[0].id] }
    ]);
  });

  test("rejects malformed, unsupported, and oversized URL state", () => {
    expect(readGoalFiltersFromSearchParams(new URLSearchParams())).toBeNull();
    expect(
      readGoalFiltersFromSearchParams(
        new URLSearchParams({ filters: "{not json" })
      )
    ).toBeNull();
    expect(
      readGoalFiltersFromSearchParams(
        new URLSearchParams({ status: "not-a-status" })
      )
    ).toBeNull();
    const oversized = new URLSearchParams();
    for (let index = 0; index < 51; index += 1) {
      oversized.append("owner", `user-${index}`);
    }
    expect(readGoalFiltersFromSearchParams(oversized)).toBeNull();
  });
});
