import { describe, expect, it } from "vitest";
import {
  groups,
  monthStart,
  nextMonth,
  repoName,
  reviewCategory,
  settings,
} from "../lib/policy";
describe("workflow policies", () => {
  it("groups by repository with a maximum of four and no omissions", () => {
    const input = Array.from({ length: 11 }, (_, i) => ({
      id: i,
      repo: i % 3 === 0 ? "a/b" : "c/d",
    }));
    const result = groups(input);
    expect(
      result.every(
        (g) => g.length <= 4 && new Set(g.map((i) => i.repo)).size === 1,
      ),
    ).toBe(true);
    expect(
      result
        .flat()
        .map((i) => i.id)
        .sort((a, b) => a - b),
    ).toEqual(input.map((i) => i.id));
  });
  it("uses UTC calendar resets including year boundaries", () => {
    expect(monthStart(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
    expect(nextMonth(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
  it("normalizes repository URLs and rejects host or path injection", () => {
    expect(repoName("https://github.com/org/repo.git")).toBe("org/repo");
    for (const value of [
      "../../etc",
      "https://evil.test/a/b",
      "a/b/issues/1",
      "a/b?x=1",
    ])
      expect(() => repoName(value)).toThrow();
  });
  it("defaults to approval and autosync, validates limits", () => {
    expect(settings({})).toMatchObject({
      mode: "approval",
      autosync: true,
      waveLimit: 3,
    });
    expect(() => settings({ mode: "unrestricted" })).toThrow();
  });
  it("invalidates approvals on changed PR heads", () => {
    const reviews = [
      { user: { login: "a" }, state: "APPROVED", commit_id: "old" },
    ];
    expect(reviewCategory({ mergeable: true }, reviews, "new", "success")).toBe(
      "needs_review",
    );
  });
  it("requires actual passing checks and merges only current approvals", () => {
    const reviews = [
      { user: { login: "a" }, state: "APPROVED", commit_id: "sha" },
    ];
    expect(reviewCategory({ mergeable: true }, reviews, "sha", "pending")).toBe(
      "approved",
    );
    expect(reviewCategory({ mergeable: true }, reviews, "sha", "success")).toBe(
      "ready",
    );
    expect(
      reviewCategory({ mergeable: false }, reviews, "sha", "success"),
    ).toBe("blocked");
    expect(
      reviewCategory(
        { mergeable: true },
        [
          ...reviews,
          {
            user: { login: "a" },
            state: "CHANGES_REQUESTED",
            commit_id: "sha",
          },
        ],
        "sha",
        "success",
      ),
    ).toBe("changes_requested");
  });
});

it("does not let comments overwrite approvals or protections appear ready", () => {
  const reviews = [
    { user: { login: "a" }, state: "APPROVED", commit_id: "sha" },
    { user: { login: "a" }, state: "COMMENTED", commit_id: "sha" },
  ];
  expect(reviewCategory({ mergeable: true }, reviews, "sha", "success")).toBe(
    "ready",
  );
  expect(
    reviewCategory(
      { mergeable: true, mergeable_state: "blocked" },
      reviews,
      "sha",
      "success",
    ),
  ).toBe("blocked");
});

it("supports configured UTC allowance resets across months and years", async () => {
  const { allowanceWindow } = await import("../lib/policy");
  expect(
    allowanceWindow(
      { resetDay: 15, resetHour: 9 },
      new Date("2026-01-10T12:00:00Z"),
    ),
  ).toEqual({
    start: new Date("2025-12-15T09:00:00Z"),
    reset: new Date("2026-01-15T09:00:00Z"),
  });
  expect(
    allowanceWindow(
      { resetDay: 15, resetHour: 9 },
      new Date("2026-01-15T09:00:00Z"),
    ),
  ).toEqual({
    start: new Date("2026-01-15T09:00:00Z"),
    reset: new Date("2026-02-15T09:00:00Z"),
  });
});
