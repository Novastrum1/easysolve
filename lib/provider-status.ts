import { db } from "./db";
import { hash } from "./security";
import { providerConfig } from "./providers";

export const isProviderAdmin = (userId: string) =>
  (process.env.AI_ADMIN_USER_IDS ?? process.env.OPENAI_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .includes(userId);

// Internal only: verification is bound to the exact credential and model.
export const providerFingerprint = () =>
  hash(
    JSON.stringify(
      (({ id, key, model, baseURL }) => ({ id, key, model, baseURL }))(
        providerConfig(),
      ),
    ),
  );
export async function providerStatus() {
  const { id, name, configured, model } = providerConfig();
  const receipt = configured
    ? await db.providerConnection.findUnique({ where: { id } })
    : null;
  const verified =
    !!receipt &&
    receipt.fingerprint === providerFingerprint() &&
    receipt.verifiedAt.getTime() > Date.now() - 86400000;
  return {
    id,
    name,
    configured,
    model,
    modelName: model === "gpt-6-astra" ? "GPT-6 Astra" : model,
    verified,
    verifiedAt: verified ? receipt!.verifiedAt : null,
  };
}
