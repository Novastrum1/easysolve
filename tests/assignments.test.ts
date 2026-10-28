import { beforeEach,expect,it,vi } from "vitest";
import { propose } from "../lib/assignments";
const { db, gh } = vi.hoisted(() => ({
  db: { user: { findUniqueOrThrow: vi.fn() }, proposal: { create: vi.fn() } },
  gh: { pages: vi.fn(), request: vi.fn() },
}));
vi.mock("../lib/db", () => ({ db }));
vi.mock("../lib/github", () => ({ github: vi.fn().mockResolvedValue(gh) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue({ settings: { waveLimit: 2 } });
  db.proposal.create.mockImplementation(({ data }) => data);
  gh.request.mockResolvedValue(undefined);
});
it("accounts for current assignments before proposing extra issues", async () => {
  gh.pages.mockResolvedValue([
    {
      number: 1,
      title: "Existing",
      labels: [{ name: "Wave" }],
      assignees: [{ login: "alice" }],
    },
    {
      number: 2,
      title: "Available",
      labels: [{ name: "Wave" }],
      assignees: [],
    },
    {
      number: 3,
      title: "Also available",
      labels: [{ name: "Wave" }],
      assignees: [],
    },
  ]);
  const proposal = await propose("user", {
    identityId: "identity",
    repo: "org/repo",
    usernames: ["alice"],
    numbers: [],
    labels: "",
    additional: 3,
    waveOnly: true,
  });
  expect(proposal.entries).toHaveLength(1);
  expect((proposal.entries as any[])[0]).toMatchObject({
    number: 2,
    login: "alice",
    existing: 1,
    state: "pending",
  });
  expect(gh.request).toHaveBeenCalledWith("/repos/org/repo/assignees/alice");
  expect(gh.request.mock.calls.every((c) => c.length === 1)).toBe(true);
});
it("refuses a proposal if GitHub rejects assignability", async () => {
  gh.pages.mockResolvedValue([
    { number: 2, title: "Available", labels: [], assignees: [] },
  ]);
  gh.request.mockRejectedValue(new Error("permission denied"));
  await expect(
    propose("user", {
      identityId: "i",
      repo: "a/b",
      usernames: ["alice"],
      numbers: [],
      labels: "",
      additional: 1,
      waveOnly: false,
    }),
  ).rejects.toThrow("permission denied");
  expect(db.proposal.create).not.toHaveBeenCalled();
});
