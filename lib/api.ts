import { NextResponse } from "next/server";
import { z } from "zod";
import { AllowanceError } from "./ai";
import { db } from "./db";
import { handleAccount } from "./routes/account";
import { handleAuth } from "./routes/auth";
import { handleBootstrap } from "./routes/bootstrap";
import { handleContribution } from "./routes/contribution";
import { handleRepositories } from "./routes/repositories";
import { handleReviews } from "./routes/reviews";
import { handleRuns } from "./routes/runs";
import { csrf,HttpError,publicError,rateLimit,user } from "./security";
const id = z.string().min(1).max(100);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
export async function api(request: Request, path: string[]) {
  try {
    const route = path.join("/");
    const method = request.method;
    if (
      method === "GET" &&
      !["health", "bootstrap", "discover", "reviews"].includes(route) &&
      !(path[0] === "runs" && path.length === 2)
    )
      throw new HttpError(405, "Use POST for this operation");
    const url = new URL(request.url);
    if (method !== "GET") csrf(request);
    if (route === "health") {
      await db.$queryRaw`SELECT 1`;
      return json({
        ok: true,
        deepseek: !!process.env.DEEPSEEK_API_KEY,
        encryption: !!process.env.TOKEN_ENCRYPTION_KEY,
      });
    }
    const body =
      method === "GET"
        ? {}
        : await request
            .text()
            .then((text) => {
              if (Buffer.byteLength(text) > 100000)
                throw new HttpError(413, "Request body exceeds 100 KB");
              return JSON.parse(text);
            })
            .catch((error) => {
              if (error instanceof HttpError) throw error;
              throw new HttpError(400, "Invalid JSON");
            });
    const authResult = await handleAuth({ request, path, body, url });
    if (authResult) return authResult;
    const u = await user();
    await rateLimit(`user:${u.id}`, 120);
    const context = { request, path, body, url, u };
    for (const handler of [
      handleAccount,
      handleBootstrap,
      handleRepositories,
      handleRuns,
      handleContribution,
      handleReviews,
    ]) {
      const result = await handler(context);
      if (result) return result;
    }
    throw new HttpError(404, "Endpoint not found");
  } catch (e) {
    if (e instanceof z.ZodError)
      return json({ error: e.issues.map((i) => i.message).join("; ") }, 422);
    if (e instanceof AllowanceError)
      return json({ error: e.message, reset: e.reset }, 429);
    const error = publicError(e);
    if (error.status === 500)
      console.error(
        "API operation failed",
        e instanceof Error ? e.name : "unknown",
      );
    return json({ error: error.error }, error.status);
  }
}
