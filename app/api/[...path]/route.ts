import { api } from "@/lib/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  r: Request,
  c: { params: Promise<{ path: string[] }> },
) {
  return api(r, (await c.params).path);
}
export async function POST(
  r: Request,
  c: { params: Promise<{ path: string[] }> },
) {
  return api(r, (await c.params).path);
}
export async function PATCH(
  r: Request,
  c: { params: Promise<{ path: string[] }> },
) {
  return api(r, (await c.params).path);
}
export async function DELETE(
  r: Request,
  c: { params: Promise<{ path: string[] }> },
) {
  return api(r, (await c.params).path);
}
