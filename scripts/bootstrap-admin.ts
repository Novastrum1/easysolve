import "dotenv/config";
import { parseArgs } from "node:util";
import { AdminBootstrapError, bootstrapAdmin } from "../lib/admin";
import { db } from "../lib/db";

try {
  const { values } = parseArgs({
    options: { email: { type: "string" }, "user-id": { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const id = await bootstrapAdmin({
    email: values.email,
    userId: values["user-id"],
  });
  console.log(
    `Owner administrator enabled for account ${id}. Sign in normally and open /admin.`,
  );
} catch (error) {
  // Do not print database errors, connection strings, or environment values.
  console.error(
    error instanceof AdminBootstrapError
      ? error.message
      : "Bootstrap failed. Use exactly one --email or --user-id, and check database availability and migrations.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
