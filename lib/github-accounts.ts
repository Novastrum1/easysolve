import { db } from "./db";
import { encrypt, HttpError } from "./security";
import { entitlementSummary } from "./entitlements";
export async function connectGithubAccount(
  userId: string,
  account: { id: string | number; login: string },
  token: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.suspendedAt) throw new HttpError(403, "Account suspended");
    const stableId = String(account.id);
    if (!/^\d+$/.test(stableId) || !account.login)
      throw new HttpError(
        422,
        "GitHub did not return a valid account identity",
      );
    const existing = await tx.identity.findFirst({
      where: {
        userId,
        OR: [
          { githubAccountId: stableId },
          { login: { equals: account.login, mode: "insensitive" } },
        ],
      },
    });
    const s = await entitlementSummary(userId, tx);
    if (existing)
      return tx.identity.update({
        where: { id: existing.id },
        data: {
          token: encrypt(token),
          login: account.login,
          githubAccountId: stableId,
          active: true,
          usable: existing.usable || s.usable < s.githubLimit,
          status: "connected",
        },
      });
    if (s.connected >= s.githubLimit)
      throw new HttpError(
        403,
        `${s.name} supports ${s.githubLimit} distinct GitHub accounts. Upgrade or request an owner override. Replacing an existing account's token does not use a slot.`,
      );
    return tx.identity.create({
      data: {
        userId,
        githubAccountId: stableId,
        login: account.login,
        token: encrypt(token),
      },
    });
  });
}
export async function chooseGithubAccounts(userId: string, ids: string[]) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const s = await entitlementSummary(userId, tx);
    const unique = [...new Set(ids)];
    if (unique.length > s.githubLimit)
      throw new HttpError(
        403,
        `Choose at most ${s.githubLimit} usable accounts`,
      );
    if (
      (await tx.identity.count({ where: { userId, id: { in: unique } } })) !==
      unique.length
    )
      throw new HttpError(404, "Identity not found");
    await tx.identity.updateMany({
      where: { userId },
      data: { usable: false },
    });
    await tx.identity.updateMany({
      where: { userId, id: { in: unique } },
      data: { usable: true, active: true },
    });
    return { ok: true };
  });
}
