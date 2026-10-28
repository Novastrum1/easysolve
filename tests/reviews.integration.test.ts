import type { User } from "@prisma/client";
import "dotenv/config";
import { afterAll,beforeAll,expect,it,vi } from "vitest";
import { db } from "../lib/db";
import { handleReviews } from "../lib/routes/reviews";
const { gh, queue } = vi.hoisted(() => ({
  gh: { request: vi.fn() },
  queue: vi.fn(),
}));
vi.mock("../lib/github", () => ({
  github: vi.fn().mockResolvedValue(gh),
  reviewQueue: queue,
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
let u: User;
const old = "a".repeat(40),
  newHead = "b".repeat(40);
beforeAll(async () => {
  u = await db.user.create({
    data: {
      email: `review-${crypto.randomUUID()}@example.test`,
      name: "Review fixture",
      password: "fixture",
    },
  });
  await db.repository.create({
    data: { userId: u.id, identityId: "identity", fullName: "a/b" },
  });
});
afterAll(async () => {
  await db.user.delete({ where: { id: u.id } });
  await db.$disconnect();
});
function context(action: string, sha = old) {
  return {
    u,
    request: new Request("http://local/api/reviews/action", { method: "POST" }),
    path: ["reviews", "action"],
    body: {
      identityId: "identity",
      repo: "a/b",
      number: 1,
      sha,
      action,
      body: "Review",
    },
    url: new URL("http://local"),
  };
}
it("rejects a changed head before submitting any review or merge", async () => {
  gh.request.mockResolvedValue({ head: { sha: newHead } });
  await expect(handleReviews(context("approve"))).rejects.toThrow(
    "head changed",
  );
  await expect(handleReviews(context("merge"))).rejects.toThrow("head changed");
  expect(gh.request.mock.calls.every((c) => c.length === 1)).toBe(true);
});
it("merges only ready pull requests and passes the reviewed SHA to GitHub", async () => {
  gh.request.mockImplementation(async (path: string, method?: string) =>
    method === "PUT" ? { merged: true, sha: old } : { head: { sha: old } },
  );
  queue.mockResolvedValue([{ repo: "a/b", number: 1, category: "blocked" }]);
  await expect(handleReviews(context("merge"))).rejects.toThrow("not approved");
  queue.mockResolvedValue([{ repo: "a/b", number: 1, category: "ready" }]);
  const response = await handleReviews(context("merge"));
  expect(response?.status).toBe(200);
  expect(gh.request).toHaveBeenCalledWith("/repos/a/b/pulls/1/merge", "PUT", {
    sha: old,
    merge_method: "squash",
  });
});
it("honors GitHub refusal even if local checks passed", async () => {
  gh.request.mockImplementation(async (path: string, method?: string) =>
    method === "PUT" ? { merged: false } : { head: { sha: old } },
  );
  queue.mockResolvedValue([{ repo: "a/b", number: 1, category: "ready" }]);
  await expect(handleReviews(context("merge"))).rejects.toThrow("rejected");
});
