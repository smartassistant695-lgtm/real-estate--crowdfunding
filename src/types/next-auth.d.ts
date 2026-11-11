import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: "INVESTOR" | "ADMIN" } & DefaultSession["user"];
  }
  interface User {
    role?: "INVESTOR" | "ADMIN";
  }
}
