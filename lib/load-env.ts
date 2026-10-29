// Match Next's file precedence in the worker and operator scripts.
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");
