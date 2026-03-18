import { db } from "@workspace/db";
import {
  responses, responseNotes, formQuestions, formSettings,
  retailOrders, retailMerchants, retailSessions, retailActivity, otpRequests,
  type Response, type ResponseNote, type FormQuestion,
  type InsertResponse, type InsertResponseNote, type InsertFormQuestion,
  type RetailOrder, type InsertRetailOrder,
  type RetailMerchant, type InsertRetailMerchant,
  type RetailSession, type InsertRetailSession,
  type RetailActivity, type InsertRetailActivity,
  type OtpRequest, type InsertOtpRequest,
} from "@workspace/db";
import { eq, desc, asc, and, or, ilike, sql } from "drizzle-orm";

export interface IStorage {
  createResponse(data: InsertResponse): Promise<Response>;
  getAllResponses(): Promise<Response[]>;
  getResponse(id: string): Promise<Response | undefined>;
  deleteResponse(id: string): Promise<void>;
  deleteAllResponses(): Promise<number>;
  updateResponseEncryptedData(id: string, encryptedData: string): Promise<Response>;
  markTelegramNotified(id: string): Promise<void>;

  getNote(responseId: string): Promise<ResponseNote | undefined>;
  upsertNote(data: InsertResponseNote): Promise<ResponseNote>;
  deleteNote(responseId: string): Promise<void>;

  getFormQuestions(): Promise<FormQuestion[]>;
  replaceFormQuestions(questions: InsertFormQuestion[]): Promise<FormQuestion[]>;
  getFormSetting(key: string): Promise<string | null>;
  setFormSetting(key: string, value: string): Promise<void>;

  // Retail: Orders
  createRetailOrder(data: InsertRetailOrder): Promise<RetailOrder>;
  getRetailOrders(filters?: { status?: string; merchantName?: string; issueType?: string; region?: string }): Promise<RetailOrder[]>;
  getRetailOrder(id: string): Promise<RetailOrder | undefined>;
  getRetailOrderByNumber(orderNumber: string, merchantName: string): Promise<RetailOrder | undefined>;
  updateRetailOrder(id: string, data: Partial<InsertRetailOrder>): Promise<RetailOrder>;
  deleteRetailOrder(id: string): Promise<void>;
  getRetailOrderStats(): Promise<{ total: number; pending: number; inProgress: number; resolved: number; failed: number }>;

  // Retail: Merchants
  createRetailMerchant(data: InsertRetailMerchant): Promise<RetailMerchant>;
  getRetailMerchants(): Promise<RetailMerchant[]>;
  getRetailMerchantByName(name: string): Promise<RetailMerchant | undefined>;
  updateRetailMerchant(id: string, data: Partial<InsertRetailMerchant>): Promise<RetailMerchant>;
  deleteRetailMerchant(id: string): Promise<void>;

  // Retail: Sessions
  createRetailSession(data: InsertRetailSession): Promise<RetailSession>;
  getRetailSessions(orderId?: string): Promise<RetailSession[]>;
  getRetailActiveSessions(): Promise<RetailSession[]>;
  updateRetailSession(id: string, data: Partial<InsertRetailSession>): Promise<RetailSession>;

  // Retail: Activity
  logRetailActivity(data: InsertRetailActivity): Promise<RetailActivity>;
  getRetailActivity(limit?: number): Promise<RetailActivity[]>;
}

export class DatabaseStorage implements IStorage {
  async createResponse(data: InsertResponse): Promise<Response> {
    const [row] = await db.insert(responses).values(data).returning();
    return row;
  }

  async getAllResponses(): Promise<Response[]> {
    return db.select().from(responses).orderBy(desc(responses.createdAt));
  }

  async getResponse(id: string): Promise<Response | undefined> {
    const [row] = await db.select().from(responses).where(eq(responses.id, id));
    return row;
  }

  async deleteResponse(id: string): Promise<void> {
    await db.delete(responses).where(eq(responses.id, id));
  }

  async deleteAllResponses(): Promise<number> {
    const all = await db.select({ id: responses.id }).from(responses);
    await db.delete(responses);
    return all.length;
  }

  async updateResponseEncryptedData(id: string, encryptedData: string): Promise<Response> {
    const [row] = await db.update(responses)
      .set({ encryptedData })
      .where(eq(responses.id, id))
      .returning();
    return row;
  }

  async markTelegramNotified(id: string): Promise<void> {
    await db.update(responses).set({ telegramNotified: true }).where(eq(responses.id, id));
  }

  async getNote(responseId: string): Promise<ResponseNote | undefined> {
    const [row] = await db.select().from(responseNotes).where(eq(responseNotes.responseId, responseId));
    return row;
  }

  async upsertNote(data: InsertResponseNote): Promise<ResponseNote> {
    const existing = await this.getNote(data.responseId);
    if (existing) {
      const [row] = await db.update(responseNotes)
        .set({ encryptedNote: data.encryptedNote, updatedAt: new Date() })
        .where(eq(responseNotes.responseId, data.responseId))
        .returning();
      return row;
    }
    const [row] = await db.insert(responseNotes).values(data).returning();
    return row;
  }

  async deleteNote(responseId: string): Promise<void> {
    await db.delete(responseNotes).where(eq(responseNotes.responseId, responseId));
  }

  async getFormQuestions(): Promise<FormQuestion[]> {
    return db.select().from(formQuestions).orderBy(asc(formQuestions.pageNumber), asc(formQuestions.sortOrder));
  }

  async replaceFormQuestions(questions: InsertFormQuestion[]): Promise<FormQuestion[]> {
    return db.transaction(async (tx) => {
      await tx.delete(formQuestions);
      if (questions.length === 0) return [];
      const rows = await tx.insert(formQuestions).values(questions).returning();
      return rows;
    });
  }

  async getFormSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(formSettings).where(eq(formSettings.key, key));
    return row?.value ?? null;
  }

  async setFormSetting(key: string, value: string): Promise<void> {
    await db.insert(formSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: formSettings.key, set: { value } });
  }

  // ─── Retail: Orders ─────────────────────────────────────────────────────────

  async createRetailOrder(data: InsertRetailOrder): Promise<RetailOrder> {
    const [row] = await db.insert(retailOrders).values(data).returning();
    return row;
  }

  async getRetailOrders(filters?: { status?: string; merchantName?: string; issueType?: string; region?: string }): Promise<RetailOrder[]> {
    const conditions = [];
    if (filters?.status) conditions.push(eq(retailOrders.status, filters.status));
    if (filters?.merchantName) conditions.push(ilike(retailOrders.merchantName, `%${filters.merchantName}%`));
    if (filters?.issueType) conditions.push(eq(retailOrders.issueType, filters.issueType));
    if (filters?.region) conditions.push(eq(retailOrders.region, filters.region));

    let query = db.select().from(retailOrders).$dynamic();
    if (conditions.length === 1) query = query.where(conditions[0]);
    else if (conditions.length > 1) query = query.where(and(...conditions));
    return query.orderBy(desc(retailOrders.createdAt));
  }

  async getRetailOrder(id: string): Promise<RetailOrder | undefined> {
    const [row] = await db.select().from(retailOrders).where(eq(retailOrders.id, id));
    return row;
  }

  async getRetailOrderByNumber(orderNumber: string, merchantName: string): Promise<RetailOrder | undefined> {
    const [row] = await db.select().from(retailOrders).where(
      and(eq(retailOrders.orderNumber, orderNumber), ilike(retailOrders.merchantName, `%${merchantName}%`))
    );
    return row;
  }

  async updateRetailOrder(id: string, data: Partial<InsertRetailOrder>): Promise<RetailOrder> {
    const [row] = await db.update(retailOrders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(retailOrders.id, id))
      .returning();
    return row;
  }

  async deleteRetailOrder(id: string): Promise<void> {
    await db.delete(retailOrders).where(eq(retailOrders.id, id));
  }

  async getRetailOrderStats() {
    const rows = await db.select({
      status: retailOrders.status,
      count: sql<number>`count(*)::int`,
    }).from(retailOrders).groupBy(retailOrders.status);

    const map: Record<string, number> = {};
    for (const r of rows) map[r.status] = r.count;

    const total = Object.values(map).reduce((a, b) => a + b, 0);
    return {
      total,
      pending: map["pending"] ?? 0,
      inProgress: map["in_progress"] ?? 0,
      resolved: map["resolved"] ?? 0,
      failed: map["failed"] ?? 0,
    };
  }

  // ─── Retail: Merchants ───────────────────────────────────────────────────────

  async createRetailMerchant(data: InsertRetailMerchant): Promise<RetailMerchant> {
    const [row] = await db.insert(retailMerchants).values(data).returning();
    return row;
  }

  async getRetailMerchants(): Promise<RetailMerchant[]> {
    return db.select().from(retailMerchants).orderBy(asc(retailMerchants.name));
  }

  async getRetailMerchantByName(name: string): Promise<RetailMerchant | undefined> {
    const [row] = await db.select().from(retailMerchants).where(ilike(retailMerchants.name, name));
    return row;
  }

  async updateRetailMerchant(id: string, data: Partial<InsertRetailMerchant>): Promise<RetailMerchant> {
    const [row] = await db.update(retailMerchants).set(data).where(eq(retailMerchants.id, id)).returning();
    return row;
  }

  async deleteRetailMerchant(id: string): Promise<void> {
    await db.delete(retailMerchants).where(eq(retailMerchants.id, id));
  }

  // ─── Retail: Sessions ───────────────────────────────────────────────────────

  async createRetailSession(data: InsertRetailSession): Promise<RetailSession> {
    const [row] = await db.insert(retailSessions).values(data).returning();
    return row;
  }

  async getRetailSessions(orderId?: string): Promise<RetailSession[]> {
    if (orderId) {
      return db.select().from(retailSessions)
        .where(eq(retailSessions.orderId, orderId))
        .orderBy(desc(retailSessions.createdAt));
    }
    return db.select().from(retailSessions).orderBy(desc(retailSessions.createdAt));
  }

  async getRetailActiveSessions(): Promise<RetailSession[]> {
    return db.select().from(retailSessions)
      .where(or(eq(retailSessions.status, "running"), eq(retailSessions.status, "provisioning")))
      .orderBy(desc(retailSessions.createdAt));
  }

  async updateRetailSession(id: string, data: Partial<InsertRetailSession>): Promise<RetailSession> {
    const [row] = await db.update(retailSessions).set(data).where(eq(retailSessions.id, id)).returning();
    return row;
  }

  // ─── Retail: Activity ───────────────────────────────────────────────────────

  async logRetailActivity(data: InsertRetailActivity): Promise<RetailActivity> {
    const [row] = await db.insert(retailActivity).values(data).returning();
    return row;
  }

  async getRetailActivity(limit = 50): Promise<RetailActivity[]> {
    return db.select().from(retailActivity)
      .orderBy(desc(retailActivity.timestamp))
      .limit(limit);
  }

  // ─── OTP Requests ───────────────────────────────────────────────────────────

  async createOtpRequest(data: InsertOtpRequest): Promise<OtpRequest> {
    const [row] = await db.insert(otpRequests).values(data).returning();
    return row;
  }

  async getOtpRequestByOrder(orderId: string): Promise<OtpRequest | null> {
    const [row] = await db.select().from(otpRequests)
      .where(and(eq(otpRequests.orderId, orderId), or(
        eq(otpRequests.botStatus, "pending"),
        eq(otpRequests.botStatus, "awaiting_code"),
        eq(otpRequests.botStatus, "code_provided"),
      )))
      .orderBy(desc(otpRequests.createdAt))
      .limit(1);
    return row ?? null;
  }

  async getPendingOtpRequests(): Promise<OtpRequest[]> {
    return db.select().from(otpRequests).where(eq(otpRequests.botStatus, "pending"));
  }

  async getExpiredOtpRequests(): Promise<OtpRequest[]> {
    return db.select().from(otpRequests).where(eq(otpRequests.botStatus, "expired"));
  }

  async updateOtpRequest(id: string, data: Partial<InsertOtpRequest>): Promise<OtpRequest> {
    const [row] = await db.update(otpRequests).set(data).where(eq(otpRequests.id, id)).returning();
    return row;
  }

  async getOtpRequestById(id: string): Promise<OtpRequest | null> {
    const [row] = await db.select().from(otpRequests).where(eq(otpRequests.id, id));
    return row ?? null;
  }
}

export const storage = new DatabaseStorage();
