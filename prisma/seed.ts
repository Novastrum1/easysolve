import bcrypt from "bcryptjs";
import "dotenv/config";
import { db } from "../lib/db";
// Deliberately no fabricated metrics, issues, runs, or integration health.
if (
  !process.env.SEED_EMAIL ||
  !process.env.SEED_PASSWORD ||
  process.env.SEED_PASSWORD.length < 12
)
  throw Error("Set SEED_EMAIL and SEED_PASSWORD (12+ chars) explicitly.");
await db.user.upsert({
  where: { email: process.env.SEED_EMAIL.toLowerCase() },
  create: {
    email: process.env.SEED_EMAIL.toLowerCase(),
    name: "Local development",
    password: await bcrypt.hash(process.env.SEED_PASSWORD, 12),
  },
  update: {},
});
console.log("Development account ready. No provider fixtures were imported.");
await db.$disconnect();
