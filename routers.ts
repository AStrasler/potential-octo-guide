import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import { systemRouter } from "./systemRouter";
import { publicProcedure, router } from "./trpc";
import {
  cleanupExpiredVerifications,
  createEmailVerification,
  createScan,
  createVerifiedSession,
  deleteVerifiedSession,
  getScanById,
  getScanResultByScanId,
  getScansWithResultsByEmail,
  getVerifiedSession,
  updateScanStatus,
  upsertScanResult,
  verifyEmailCode,
} from "./db";
import { runAllChecks } from "./analysis";
import { sendOTPEmail } from "./emailService";

// ─── Allowlist ────────────────────────────────────────────────────────────────

const ALLOWED_EMAILS = ["aaron.m.strasler@outlook.com"];

function isEmailAllowed(email: string): boolean {
  const lower = email.toLowerCase().trim();
  if (ALLOWED_EMAILS.includes(lower)) return true;
  // Allow any .edu email
  if (lower.endsWith(".edu") || lower.match(/\.edu$/)) return true;
  // Also allow emails from .edu domains (e.g. user@university.edu)
  const domain = lower.split("@")[1] ?? "";
  return domain.endsWith(".edu");
}

// ─── Session middleware ───────────────────────────────────────────────────────

const SESSION_COOKIE = "scholar_session";

async function getEmailFromRequest(req: any): Promise<string | null> {
  const cookieHeader = req.headers?.cookie ?? "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c: string) => {
      const [k, ...v] = c.trim().split("=");
      return [k?.trim(), decodeURIComponent(v.join("="))];
    })
  );
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await getVerifiedSession(token);
  return session?.email ?? null;
}

const sessionProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const email = await getEmailFromRequest(ctx.req);
  if (!email) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Email verification required" });
  }
  return next({ ctx: { ...ctx, verifiedEmail: email } });
});

// ─── Routers ──────────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Email Auth ─────────────────────────────────────────────────────────────
  emailAuth: router({
    sendCode: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        const email = input.email.toLowerCase().trim();
        if (!isEmailAllowed(email)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Access is restricted to verified .edu email addresses.",
          });
        }
        // Generate 6-digit code
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
        await createEmailVerification(email, code, expiresAt);
        await cleanupExpiredVerifications();

        // Send OTP via email service
        await sendOTPEmail(email, code).catch(console.error);

        return { success: true, message: "Verification code sent to your email." };
      }),

    verifyCode: publicProcedure
      .input(z.object({ email: z.string().email(), code: z.string().length(6) }))
      .mutation(async ({ input, ctx }) => {
        const email = input.email.toLowerCase().trim();
        const valid = await verifyEmailCode(email, input.code);
        if (!valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid or expired verification code.",
          });
        }
        // Create session
        const token = nanoid(64);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await createVerifiedSession(token, email, expiresAt);

        const isSecure = ctx.req.protocol === "https" ||
          (ctx.req.headers["x-forwarded-proto"] as string) === "https";

        ctx.res.cookie(SESSION_COOKIE, token, {
          httpOnly: true,
          secure: isSecure,
          sameSite: isSecure ? "none" : "lax",
          path: "/",
          expires: expiresAt,
        });

        return { success: true, email };
      }),

    getSession: publicProcedure.query(async ({ ctx }) => {
      const email = await getEmailFromRequest(ctx.req);
      return { email, authenticated: !!email };
    }),

    signOut: publicProcedure.mutation(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers?.cookie ?? "";
      const cookies = Object.fromEntries(
        cookieHeader.split(";").map((c: string) => {
          const [k, ...v] = c.trim().split("=");
          return [k?.trim(), decodeURIComponent(v.join("="))];
        })
      );
      const token = cookies[SESSION_COOKIE];
      if (token) await deleteVerifiedSession(token);
      ctx.res.clearCookie(SESSION_COOKIE, { path: "/" });
      return { success: true };
    }),
  }),

  // ─── Scans ──────────────────────────────────────────────────────────────────
  scan: router({
    submit: sessionProcedure
      .input(
        z.object({
          text: z.string().min(10).max(50000),
          fileName: z.string().optional(),
          citations: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const email = (ctx as any).verifiedEmail as string;
        const scanId = await createScan({
          email,
          inputText: input.text,
          fileName: input.fileName,
          status: "processing",
        });

        // Run analysis asynchronously
        runAllChecks(scanId, input.text, input.citations ?? []).catch(console.error);

        return { scanId };
      }),

    getResult: sessionProcedure
      .input(z.object({ scanId: z.number() }))
      .query(async ({ input, ctx }) => {
        const email = (ctx as any).verifiedEmail as string;
        const scan = await getScanById(input.scanId);
        if (!scan || scan.email !== email) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const result = await getScanResultByScanId(input.scanId);
        return { scan, result };
      }),

    history: sessionProcedure
      .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
      .query(async ({ input, ctx }) => {
        const email = (ctx as any).verifiedEmail as string;
        return getScansWithResultsByEmail(email, input.limit, input.offset);
      }),

    delete: sessionProcedure
      .input(z.object({ scanId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const email = (ctx as any).verifiedEmail as string;
        const scan = await getScanById(input.scanId);
        if (!scan || scan.email !== email) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await updateScanStatus(input.scanId, "failed"); // soft delete
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
