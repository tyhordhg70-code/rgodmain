import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { retailApi } from "@/lib/retail-api";

interface Customer {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
}

export interface Order {
  id: string;
  order_number: string;
  merchant_name: string;
  merchant_url?: string;
  region: string;
  issue_type: string;
  desired_outcome?: string;
  status: string;
  notes?: string;
  customer?: Customer;
  created_at?: string;
  updated_at?: string;
}

export interface Session {
  id: string;
  order_id: string;
  status: string;
  started_at: string;
  ended_at?: string;
  browser_profile_id?: string;
  proxy_ip?: string;
  messages?: { role: string; content: string }[];
}

export interface Merchant {
  id: string;
  name: string;
  url: string;
  region: string;
  live_chat_available: boolean;
  live_chat_selector?: string;
  notes?: string;
  dolphin_profile_id?: string | null;
}

export interface ActivityLog {
  id: string;
  action: string;
  details?: string;
  timestamp: string;
  order_id?: string;
  session_id?: string;
}

export interface Stats {
  total_orders: number;
  today_orders: number;
  in_progress_orders: number;
  pending_orders: number;
  resolved_orders: number;
  today_resolved: number;
  success_rate: number;
  active_sessions: number;
}

export interface SystemStatus {
  telegram_connected: boolean;
  encryption_ready: boolean;
  dolphin_connected: boolean;
  proxy_configured: boolean;
  dolphin_url?: string;
  dolphin_profile_id?: string | null;
}

interface RetailContextValue {
  stats: Stats | null;
  orders: Order[];
  sessions: Session[];
  merchants: Merchant[];
  recentActivity: ActivityLog[];
  systemStatus: SystemStatus | null;
  loading: boolean;
  error: string | null;
  fetchStats: () => Promise<void>;
  fetchOrders: (filters?: Record<string, string>) => Promise<Order[]>;
  createOrder: (data: Partial<Order>) => Promise<Order>;
  updateOrder: (id: string, data: Partial<Order>) => Promise<Order>;
  deleteOrder: (id: string) => Promise<void>;
  fetchSessions: (filters?: Record<string, string>) => Promise<Session[]>;
  fetchActiveSessions: () => Promise<Session[]>;
  fetchMerchants: (filters?: Record<string, string>) => Promise<Merchant[]>;
  createMerchant: (data: Partial<Merchant>) => Promise<Merchant>;
  fetchRecentActivity: () => Promise<ActivityLog[]>;
  fetchSystemStatus: () => Promise<SystemStatus | null>;
}

const RetailContext = createContext<RetailContextValue | null>(null);

export function useRetail() {
  const ctx = useContext(RetailContext);
  if (!ctx) throw new Error("useRetail must be used within RetailProvider");
  return ctx;
}

export function RetailProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await retailApi.get<Stats>("/orders/stats");
      setStats(data);
    } catch (e) {
      console.error("fetchStats:", e);
    }
  }, []);

  const fetchOrders = useCallback(async (filters: Record<string, string> = {}) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const data = await retailApi.get<Order[]>(`/orders${params ? `?${params}` : ""}`);
      setOrders(data ?? []);
      return data ?? [];
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return [];
    }
  }, []);

  const createOrder = useCallback(async (data: Partial<Order>) => {
    const result = await retailApi.post<Order>("/orders", data);
    await fetchOrders();
    await fetchStats();
    return result;
  }, [fetchOrders, fetchStats]);

  const updateOrder = useCallback(async (id: string, data: Partial<Order>) => {
    const result = await retailApi.patch<Order>(`/orders/${id}`, data);
    await fetchOrders();
    await fetchStats();
    return result;
  }, [fetchOrders, fetchStats]);

  const deleteOrder = useCallback(async (id: string) => {
    await retailApi.delete(`/orders/${id}`);
    await fetchOrders();
    await fetchStats();
  }, [fetchOrders, fetchStats]);

  const fetchSessions = useCallback(async (filters: Record<string, string> = {}) => {
    try {
      const params = new URLSearchParams(filters).toString();
      const data = await retailApi.get<Session[]>(`/sessions${params ? `?${params}` : ""}`);
      setSessions(data ?? []);
      return data ?? [];
    } catch (e) {
      console.error("fetchSessions:", e);
      return [];
    }
  }, []);

  const fetchActiveSessions = useCallback(async () => {
    try {
      const data = await retailApi.get<Session[]>("/sessions/active");
      return data ?? [];
    } catch (e) {
      console.error("fetchActiveSessions:", e);
      return [];
    }
  }, []);

  const fetchMerchants = useCallback(async (filters: Record<string, string> = {}) => {
    try {
      const params = new URLSearchParams({ limit: "100", ...filters }).toString();
      const data = await retailApi.get<Merchant[]>(`/merchants?${params}`);
      setMerchants(data ?? []);
      return data ?? [];
    } catch (e) {
      console.error("fetchMerchants:", e);
      return [];
    }
  }, []);

  const createMerchant = useCallback(async (data: Partial<Merchant>) => {
    const result = await retailApi.post<Merchant>("/merchants", data);
    await fetchMerchants();
    return result;
  }, [fetchMerchants]);

  const fetchRecentActivity = useCallback(async () => {
    try {
      const data = await retailApi.get<ActivityLog[]>("/activity/recent");
      setRecentActivity(data ?? []);
      return data ?? [];
    } catch (e) {
      console.error("fetchRecentActivity:", e);
      return [];
    }
  }, []);

  const fetchSystemStatus = useCallback(async () => {
    try {
      const data = await retailApi.get<SystemStatus>("/system/status");
      setSystemStatus(data);
      return data;
    } catch (e) {
      console.error("fetchSystemStatus:", e);
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([
        fetchStats(),
        fetchOrders(),
        fetchSessions(),
        fetchRecentActivity(),
        fetchSystemStatus(),
      ]);
      setLoading(false);
    })();
  }, [fetchStats, fetchOrders, fetchSessions, fetchRecentActivity, fetchSystemStatus]);

  useEffect(() => {
    const id = setInterval(() => {
      fetchStats();
      fetchActiveSessions();
    }, 30_000);
    return () => clearInterval(id);
  }, [fetchStats, fetchActiveSessions]);

  return (
    <RetailContext.Provider
      value={{
        stats, orders, sessions, merchants, recentActivity, systemStatus,
        loading, error,
        fetchStats, fetchOrders, createOrder, updateOrder, deleteOrder,
        fetchSessions, fetchActiveSessions,
        fetchMerchants, createMerchant,
        fetchRecentActivity, fetchSystemStatus,
      }}
    >
      {children}
    </RetailContext.Provider>
  );
}
