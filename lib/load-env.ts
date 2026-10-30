// Match Next's environment loading in the worker and operator scripts.
import nextEnv from "@next/env";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");
// The operator's nonempty root .env key is authoritative for EasySolve only.
// This also prevents an older injected key from masking a private key replacement.
const rootEnv = resolve(process.cwd(), ".env");
if (existsSync(rootEnv)) {
  const key = parse(readFileSync(rootEnv)).DEEPSEEK_API_KEY?.trim();
  if (key) process.env.DEEPSEEK_API_KEY = key;
}
