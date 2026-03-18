import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = Pick<typeof users.$inferInsert, "username" | "password">;
export type User = typeof users.$inferSelect;

export const responses = pgTable("responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  encryptedData: text("encrypted_data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  telegramNotified: boolean("telegram_notified").default(false),
});

export const insertResponseSchema = createInsertSchema(responses).pick({
  encryptedData: true,
  telegramNotified: true,
  createdAt: true,
}).partial({ telegramNotified: true, createdAt: true });

export type InsertResponse = Pick<typeof responses.$inferInsert, "encryptedData"> & {
  telegramNotified?: boolean | null;
  createdAt?: Date;
};
export type Response = typeof responses.$inferSelect;

export const responseNotes = pgTable("response_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  responseId: varchar("response_id").notNull().references(() => responses.id, { onDelete: "cascade" }),
  encryptedNote: text("encrypted_note").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertResponseNoteSchema = createInsertSchema(responseNotes).pick({
  responseId: true,
  encryptedNote: true,
});

export type InsertResponseNote = Pick<typeof responseNotes.$inferInsert, "responseId" | "encryptedNote">;
export type ResponseNote = typeof responseNotes.$inferSelect;

export const retailMerchants = pgTable("retail_merchants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  region: text("region").notNull().default("usa"),
  liveChatAvailable: boolean("live_chat_available").default(true),
  notes: text("notes"),
  /** Dolphin Anty profile ID dedicated to this merchant (created on first automation) */
  dolphinProfileId: text("dolphin_profile_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRetailMerchantSchema = createInsertSchema(retailMerchants).omit({ id: true, createdAt: true });
export type InsertRetailMerchant = Omit<typeof retailMerchants.$inferInsert, "id" | "createdAt">;
export type RetailMerchant = typeof retailMerchants.$inferSelect;

export const retailOrders = pgTable("retail_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderNumber: text("order_number").notNull(),
  merchantName: text("merchant_name").notNull(),
  region: text("region").notNull().default("usa"),
  issueType: text("issue_type").notNull(),
  desiredOutcome: text("desired_outcome").notNull().default("Refund"),
  status: text("status").notNull().default("pending"),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  notes: text("notes"),
  formData: jsonb("form_data").$type<Record<string, string>>(),
  photoFileIds: jsonb("photo_file_ids").$type<string[]>().default([]),
  telegramChatId: text("telegram_chat_id"),
  telegramMessageId: text("telegram_message_id"),
  currentStep: text("current_step"),
  liveMessageId: text("live_message_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRetailOrderSchema = createInsertSchema(retailOrders).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRetailOrder = Omit<typeof retailOrders.$inferInsert, "id" | "createdAt" | "updatedAt">;
export type RetailOrder = typeof retailOrders.$inferSelect;

export const retailSessions = pgTable("retail_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => retailOrders.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("idle"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  dolphinProfileId: text("dolphin_profile_id"),
  dolphinWsUrl: text("dolphin_ws_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRetailSessionSchema = createInsertSchema(retailSessions).omit({ id: true, createdAt: true });
export type InsertRetailSession = Omit<typeof retailSessions.$inferInsert, "id" | "createdAt">;
export type RetailSession = typeof retailSessions.$inferSelect;

export const retailActivity = pgTable("retail_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: text("action").notNull(),
  details: text("details"),
  orderId: varchar("order_id"),
  sessionId: varchar("session_id"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const insertRetailActivitySchema = createInsertSchema(retailActivity).omit({ id: true, timestamp: true });
export type InsertRetailActivity = Omit<typeof retailActivity.$inferInsert, "id" | "timestamp">;
export type RetailActivity = typeof retailActivity.$inferSelect;

export const formQuestions = pgTable("form_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageNumber: integer("page_number").notNull(),
  questionId: text("question_id").notNull().unique(),
  questionText: text("question_text").notNull(),
  questionType: text("question_type").notNull(),
  options: jsonb("options"),
  required: boolean("required").default(true),
  sortOrder: integer("sort_order").notNull(),
  placeholder: text("placeholder"),
  description: text("description"),
});

export const insertFormQuestionSchema = createInsertSchema(formQuestions).omit({
  id: true,
});

export type InsertFormQuestion = Omit<typeof formQuestions.$inferInsert, "id">;
export type FormQuestion = typeof formQuestions.$inferSelect;

export const formSettings = pgTable("form_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const insertFormSettingsSchema = createInsertSchema(formSettings);
export type InsertFormSettings = typeof formSettings.$inferInsert;
export type FormSettingsRow = typeof formSettings.$inferSelect;

export const otpRequests = pgTable("otp_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => retailOrders.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  botStatus: text("bot_status").notNull().default("pending"),
  otpDestination: text("otp_destination"),
  code: text("code"),
  retry: boolean("retry").default(false),
  sentAt: timestamp("sent_at"),
  providedAt: timestamp("provided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOtpRequestSchema = createInsertSchema(otpRequests).omit({ id: true, createdAt: true });
export type InsertOtpRequest = Omit<typeof otpRequests.$inferInsert, "id" | "createdAt">;
export type OtpRequest = typeof otpRequests.$inferSelect;
