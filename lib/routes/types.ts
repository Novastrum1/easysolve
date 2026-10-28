import type { User } from "@prisma/client";
export type RouteContext = {
  request: Request;
  path: string[];
  body: any;
  url: URL;
  u: User;
};
