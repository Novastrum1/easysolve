import "dotenv/config";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { applyProposal } from "../lib/assignments";
import { handleContribution } from "../lib/routes/contribution";
import { db } from "../lib/db";
const { gh } = vi.hoisted(() => ({ gh: { request: vi.fn(), pages: vi.fn() } }));
vi.mock("../lib/github", () => ({ github: vi.fn().mockResolvedValue(gh) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
let userId = "";
beforeAll(async () => {
  userId = (
    await db.user.create({
      data: {
        email: `assignment-${crypto.randomUUID()}@example.test`,
        name: "Assignment fixture",
        password: "fixture",
      },
    })
  ).id;
});
afterAll(async () => {
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});
it("rechecks assignments and reports partial failure honestly, retrying only failed entries", async () => {
  const proposal = await db.proposal.create({
    data: {
      userId,
      identityId: "fixture",
      repo: "a/b",
      entries: [
        {
          number: 1,
          title: "First",
          login: "alice",
          existing: 0,
          state: "pending",
        },
        {
          number: 2,
          title: "Second",
          login: "bob",
          existing: 0,
          state: "pending",
        },
      ],
    },
  });
  let applied = false;
  gh.pages.mockResolvedValue([]);
  gh.request.mockImplementation(async (path: string, method?: string) => {
    if (path.endsWith("/1/assignees")) {
      applied = true;
      return { assignees: [{ login: "alice" }] };
    }
    if (path.endsWith("/1"))
      return { state: "open", assignees: applied ? [{ login: "alice" }] : [] };
    if (path.endsWith("/2"))
      return { state: "open", assignees: [{ login: "someone-else" }] };
    throw Error("Unexpected write");
  });
  const result = await applyProposal(userId, proposal.id);
  expect(result.state).toBe("partial");
  expect(result.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ number: 1, state: "applied" }),
      expect.objectContaining({
        number: 2,
        state: "failed",
        error: "Issue is no longer unassigned",
      }),
    ]),
  );
  const writes = gh.request.mock.calls.filter((c) => c[1] === "POST").length;
  await applyProposal(userId, proposal.id);
  expect(gh.request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(
    writes,
  );
  await expect(applyProposal("different-user", proposal.id)).rejects.toThrow(
    "unavailable",
  );
});

it("claims an application before posting so concurrent retries cannot duplicate comments", async () => {
  const application = await db.application.create({
    data: {
      userId,
      identityId: "fixture",
      repo: "a/b",
      number: 3,
      title: "Apply",
      draft: "I can fix this.",
    },
  });
  let releaseComments!: () => void;
  gh.pages.mockImplementation(
    () => new Promise((resolve) => (releaseComments = () => resolve([]))),
  );
  gh.request.mockImplementation(async (path: string, method?: string) =>
    method === "POST"
      ? { html_url: "https://github.com/a/b/issues/3#issuecomment-1" }
      : { state: "open", assignees: [] },
  );
  const context = {
    request: new Request("http://localhost/api/applications/post", {
      method: "POST",
    }),
    path: ["applications", application.id, "post"],
    body: { draft: "I can fix this." },
    url: new URL("http://localhost/api/applications/post"),
    u: await db.user.findUniqueOrThrow({ where: { id: userId } }),
  } as any;
  const first = handleContribution(context);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const second = handleContribution(context);
  await expect(second).rejects.toThrow("already in progress");
  releaseComments();
  await first;
  expect(gh.request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(1);
});
