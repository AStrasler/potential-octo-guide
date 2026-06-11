import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  boolean,
  float,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Email verification OTP table
export const emailVerifications = mysqlTable("email_verifications", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  code: varchar("code", { length: 10 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmailVerification = typeof emailVerifications.$inferSelect;

// Verified sessions (email-gated, not Manus OAuth)
export const verifiedSessions = mysqlTable("verified_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VerifiedSession = typeof verifiedSessions.$inferSelect;

// Scans table
export const scans = mysqlTable("scans", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  inputText: text("inputText").notNull(),
  fileName: varchar("fileName", { length: 255 }),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"])
    .default("pending")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Scan = typeof scans.$inferSelect;
export type InsertScan = typeof scans.$inferInsert;

// Scan results table
export const scanResults = mysqlTable("scan_results", {
  id: int("id").autoincrement().primaryKey(),
  scanId: int("scanId").notNull().unique(),
  // AI Detection
  aiScore: float("aiScore"), // 0-100, probability of AI authorship
  aiDetailsJson: json("aiDetailsJson"), // { sentences: [{text, score, startIdx, endIdx}], paragraphs: [{text, score}], summary: string }
  // Plagiarism
  plagiarismScore: float("plagiarismScore"), // 0-100 originality (100 = fully original)
  plagiarismDetailsJson: json("plagiarismDetailsJson"), // { matches: [{passage, similarity, sourceUrl, sourceTitle}], summary: string }
  // Citations
  citationsJson: json("citationsJson"), // { citations: [{original, format, isValid, errors: [{field, message, suggestion}], corrected}] }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ScanResult = typeof scanResults.$inferSelect;
export type InsertScanResult = typeof scanResults.$inferInsert;
