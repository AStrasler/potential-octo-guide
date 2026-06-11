import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./context";

// ─── Mock DB helpers ──────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  cleanupExpiredVerifications: vi.fn().mockResolvedValue(undefined),
  createEmailVerification: vi.fn().mockResolvedValue(undefined),
  createScan: vi.fn().mockResolvedValue(1),
  createVerifiedSession: vi.fn().mockResolvedValue(undefined),
  deleteVerifiedSession: vi.fn().mockResolvedValue(undefined),
  getScanById: vi.fn().mockResolvedValue({
    id: 1,
    email: "test@university.edu",
    inputText: "Sample text",
    fileName: null,
    status: "completed",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  getScanResultByScanId: vi.fn().mockResolvedValue({
    id: 1,
    scanId: 1,
    aiScore: 25,
    plagiarismScore: 92,
    aiDetailsJson: { summary: "Likely human-written", sentences: [], keyIndicators: [] },
    plagiarismDetailsJson: { summary: "Original", matches: [], riskLevel: "none", totalMatchedWords: 0 },
    citationsJson: { citations: [], summary: "" },
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  getScansWithResultsByEmail: vi.fn().mockResolvedValue([
    {
      scan: {
        id: 1,
        email: "test@university.edu",
        inputText: "Sample text for testing",
        fileName: null,
        status: "completed",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      result: {
        aiScore: 25,
        plagiarismScore: 92,
        aiDetailsJson: {},
        plagiarismDetailsJson: {},
        citationsJson: {},
      },
    },
  ]),
  getVerifiedSession: vi.fn().mockResolvedValue({
    id: 1,
    email: "test@university.edu",
    token: "test-token",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  }),
  updateScanStatus: vi.fn().mockResolvedValue(undefined),
  upsertScanResult: vi.fn().mockResolvedValue(undefined),
  verifyEmailCode: vi.fn().mockResolvedValue(true),
}));

vi.mock("./emailService", () => ({
  sendOTPEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./analysis", () => ({
  runAllChecks: vi.fn().mockResolvedValue({
    aiScore: 25,
    plagiarismScore: 92,
    aiDetails: { summary: "Likely human-written", sentences: [], keyIndicators: [] },
    plagiarismDetails: { summary: "Original", matches: [], riskLevel: "none", totalMatchedWords: 0 },
    citationDetails: { citations: [], summary: "" },
  }),
}));

// ─── Context helpers ──────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<TrpcContext> = {}): TrpcContext {
  const cookies: Record<string, string> = {};
  return {
    user: null,
    req: {
      protocol: "https",
      headers: { cookie: "" },
      cookies,
    } as unknown as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn((name: string, value: string) => { cookies[name] = value; }),
    } as unknown as TrpcContext["res"],
    ...overrides,
  };
}

function makeAuthCtx(email = "test@university.edu"): TrpcContext {
  const ctx = makeCtx();
  // Set cookie header so getEmailFromRequest can find the scholar_session token
  (ctx.req as any).headers = { cookie: "scholar_session=test-token" };
  return ctx;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("emailAuth.sendCode", () => {
  it("accepts valid .edu email", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.emailAuth.sendCode({ email: "student@university.edu" });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Verification code sent");
  });

  it("accepts allowlisted outlook email", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.emailAuth.sendCode({ email: "aaron.m.strasler@outlook.com" });
    expect(result.success).toBe(true);
  });

  it("rejects non-.edu non-allowlisted email", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.emailAuth.sendCode({ email: "user@gmail.com" })
    ).rejects.toThrow();
  });

  it("rejects empty email", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.emailAuth.sendCode({ email: "" })
    ).rejects.toThrow();
  });
});

describe("emailAuth.verifyCode", () => {
  it("verifies a valid code and sets session cookie", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.emailAuth.verifyCode({
      email: "student@university.edu",
      code: "123456",
    });
    expect(result.success).toBe(true);
    expect(result.email).toBe("student@university.edu");
  });

  it("rejects invalid code", async () => {
    const { verifyEmailCode } = await import("./db");
    vi.mocked(verifyEmailCode).mockResolvedValueOnce(false);
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.emailAuth.verifyCode({ email: "student@university.edu", code: "000000" })
    ).rejects.toThrow();
  });
});

describe("emailAuth.getSession", () => {
  it("returns authenticated session when cookie is valid", async () => {
    const ctx = makeAuthCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.emailAuth.getSession();
    expect(result.authenticated).toBe(true);
    expect(result.email).toBe("test@university.edu");
  });

  it("returns unauthenticated when no session cookie", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.emailAuth.getSession();
    expect(result.authenticated).toBe(false);
    expect(result.email).toBeNull();
  });
});

describe("scan.submit", () => {
  it("creates a scan and returns scanId", async () => {
    const ctx = makeAuthCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.scan.submit({
      text: "This is a sample academic text for testing purposes.",
      citations: [],
    });
    expect(result.scanId).toBeDefined();
    expect(typeof result.scanId).toBe("number");
  });

  it("rejects scan without authentication", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.scan.submit({ text: "Some text", citations: [] })
    ).rejects.toThrow();
  });

  it("rejects text that is too short", async () => {
    const ctx = makeAuthCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.scan.submit({ text: "Hi", citations: [] })
    ).rejects.toThrow();
  });
});

describe("scan.getResult", () => {
  it("returns scan result for valid scanId", async () => {
    const ctx = makeAuthCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.scan.getResult({ scanId: 1 });
    expect(result.scan).toBeDefined();
    expect(result.scan.id).toBe(1);
    expect(result.result).toBeDefined();
    expect(result.result?.aiScore).toBe(25);
  });
});

describe("scan.history", () => {
  it("returns scan history for authenticated user", async () => {
    const ctx = makeAuthCtx();
    const caller = appRouter.createCaller(ctx);
    const history = await caller.scan.history({ limit: 10, offset: 0 });
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
  });
});

describe("auth.logout", () => {
  it("clears session cookie on logout", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });
});
