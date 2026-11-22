import "server-only";
import bcrypt from "bcryptjs";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit, rateLimitRefund } from "@/lib/rate-limit";

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) });

// A real hash to compare against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = "$2b$12$LBQVXngRBkLbFCJHllMqA.z4R8yE12MKw7Yp6E/B/u1XZRaoe1rKW";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase().trim();
        const ip = await clientIp();
        // Per IP: every attempt counts. Per account: only FAILED attempts count, so the owner's
        // own successful logins never use up the budget.
        if (!(await rateLimit(`login:ip:${ip}`, 30, 600))) throw new RateLimited();
        // Count the attempt atomically BEFORE checking the password, so parallel guesses cannot all
        // slip under the limit; give it back on success. Trade-off (accepted, documented): someone
        // who knows an email can lock that account out for 15 minutes with 8 wrong guesses.
        if (!(await rateLimit(`login:fail:${email}`, 8, 900))) throw new RateLimited();
        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) return null;
        await rateLimitRefund(`login:fail:${email}`);
        return { id: user.id, email: user.email, name: user.name, role: user.role, sv: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role ?? "INVESTOR";
        token.sv = (user as { sv?: number }).sv ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = (token.role as "INVESTOR" | "ADMIN") ?? "INVESTOR";
      session.user.sv = typeof token.sv === "number" ? token.sv : 0;
      return session;
    },
  },
});

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "That password is too long.")
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Include at least one letter and one number.");
