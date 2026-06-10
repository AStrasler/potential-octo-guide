import { and, desc, eq, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  emailVerifications,
  InsertScan,
  InsertScanResult,
  InsertUser,
  scanResults,
  scans,
  users,
  verifiedSessions,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

// ─── Email Verification OTP ───────────────────────────────────────────────────

export async function createEmailVerification(email: string, code: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Invalidate previous codes for this email
  await db
    .update(emailVerifications)
    .set({ used: true })
    .where(eq(emailVerifications.email, email));
  await db.insert(emailVerifications).values({ email, code, expiresAt, used: false });
}

export async function verifyEmailCode(email: string, code: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const now = new Date();
  const rows = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.email, email),
        eq(emailVerifications.code, code),
        eq(emailVerifications.used, false),
        gt(emailVerifications.expiresAt, now)
      )
    )
    .limit(1);
  if (rows.length === 0) return false;
  await db
    .update(emailVerifications)
    .set({ used: true })
    .where(eq(emailVerifications.id, rows[0].id));
  return true;
}

// ─── Verified Sessions ────────────────────────────────────────────────────────

export async function createVerifiedSession(token: string, email: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(verifiedSessions).values({ sessionToken: token, email, expiresAt });
}

export async function getVerifiedSession(token: string) {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const rows = await db
    .select()
    .from(verifiedSessions)
    .where(and(eq(verifiedSessions.sessionToken, token), gt(verifiedSessions.expiresAt, now)))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteVerifiedSession(token: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(verifiedSessions).where(eq(verifiedSessions.sessionToken, token));
}

// ─── Scans ────────────────────────────────────────────────────────────────────

export async function createScan(data: InsertScan) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(scans).values(data);
  return result[0].insertId as number;
}

export async function updateScanStatus(
  id: number,
  status: "pending" | "processing" | "completed" | "failed"
) {
  const db = await getDb();
  if (!db) return;
  await db.update(scans).set({ status }).where(eq(scans.id, id));
}

export async function getScanById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(scans).where(eq(scans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getScansByEmail(email: string, limit = 20, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(scans)
    .where(eq(scans.email, email))
    .orderBy(desc(scans.createdAt))
    .limit(limit)
    .offset(offset);
}

// ─── Scan Results ─────────────────────────────────────────────────────────────

export async function upsertScanResult(data: InsertScanResult) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(scanResults)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        aiScore: data.aiScore,
        aiDetailsJson: data.aiDetailsJson,
        plagiarismScore: data.plagiarismScore,
        plagiarismDetailsJson: data.plagiarismDetailsJson,
        citationsJson: data.citationsJson,
      },
    });
}

export async function getScanResultByScanId(scanId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(scanResults)
    .where(eq(scanResults.scanId, scanId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getScansWithResultsByEmail(email: string, limit = 20, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  const scanList = await db
    .select()
    .from(scans)
    .where(and(eq(scans.email, email), eq(scans.status, "completed")))
    .orderBy(desc(scans.createdAt))
    .limit(limit)
    .offset(offset);

  const results = await Promise.all(
    scanList.map(async (scan) => {
      const result = await getScanResultByScanId(scan.id);
      return { scan, result };
    })
  );
  return results;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export async function cleanupExpiredVerifications() {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(emailVerifications)
    .where(lt(emailVerifications.expiresAt, new Date()));
  await db
    .delete(verifiedSessions)
    .where(lt(verifiedSessions.expiresAt, new Date()));
}
