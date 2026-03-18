import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { RetailLayout } from "@/components/retail/RetailLayout";
import { MetricCard, StatusBadge, IssueTypeBadge, RegionBadge, EmptyState } from "@/components/retail/RetailCommon";
import { useRetail, Order, ActivityLog } from "@/context/RetailContext";
import { Package, CheckCircle, Clock, TrendingUp, Activity, MessageSquare, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

function IssueStatBar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-16">{label}</span>
      <div className="flex-1 progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-slate-500 w-8 text-right">{count}</span>
    </div>
  );
}

function getLogColor(action: string) {
  const a = action.toLowerCase();
  if (a.includes("resolved") || a.includes("success")) return "log-success";
  if (a.includes("error") || a.includes("failed")) return "log-error";
  if (a.includes("warning") || a.includes("pending")) return "log-warning";
  return "text-slate-400";
}

function getIssueCount(orders: Order[], type: string) {
  return orders.filter((o) => o.issue_type === type).length;
}

export default function RetailDashboard() {
  const [, navigate] = useLocation();
  const { stats, orders, recentActivity, loading, fetchStats, fetchOrders, fetchRecentActivity, fetchActiveSessions } = useRetail();
  const [activeSessions, setActiveSessions] = useState<{ id: string; order_id: string; status: string; started_at: string | null }[]>([]);

  useEffect(() => {
    fetchStats();
    fetchOrders();
    fetchRecentActivity();
    fetchActiveSessions().then((s) => setActiveSessions(s ?? []));
  }, [fetchStats, fetchOrders, fetchRecentActivity, fetchActiveSessions]);

  if (loading && !stats) {
    return (
      <RetailLayout title="Dashboard" subtitle="Loading...">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28" />)}
        </div>
      </RetailLayout>
    );
  }

  const recentOrders = orders?.slice(0, 5) ?? [];

  return (
    <RetailLayout title="Dashboard" subtitle="Command Center Overview">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" data-testid="metrics-grid">
        <MetricCard title="Total Orders" value={stats?.total_orders ?? 0} icon={Package} subtitle={`${stats?.today_orders ?? 0} today`} />
        <MetricCard title="In Progress" value={stats?.in_progress_orders ?? 0} icon={Clock} subtitle={`${stats?.pending_orders ?? 0} pending`} valueClassName="text-blue-400" />
        <MetricCard title="Resolved" value={stats?.resolved_orders ?? 0} icon={CheckCircle} subtitle={`${stats?.today_resolved ?? 0} today`} valueClassName="text-emerald-400" />
        <MetricCard title="Success Rate" value={`${stats?.success_rate ?? 0}%`} icon={TrendingUp} subtitle="Resolution rate" valueClassName="text-indigo-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-sm" data-testid="recent-orders-card">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider">Recent Orders</h2>
            <Button variant="ghost" size="sm" className="text-xs text-slate-400 hover:text-white" onClick={() => navigate("/retail/orders")} data-testid="view-all-orders-btn">
              View All <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          <ScrollArea className="h-[320px]">
            {recentOrders.length === 0 ? (
              <EmptyState title="No orders yet" description="Orders will appear here when created" />
            ) : (
              <table className="w-full data-table">
                <thead>
                  <tr>
                    <th className="text-left">Order</th>
                    <th className="text-left">Merchant</th>
                    <th className="text-left">Issue</th>
                    <th className="text-left">Status</th>
                    <th className="text-left">Region</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.id} className="cursor-pointer" onClick={() => navigate(`/retail/orders`)} data-testid={`order-row-${order.id}`}>
                      <td><span className="font-mono text-xs text-slate-300">{order.order_number}</span></td>
                      <td className="text-sm text-slate-400">{order.merchant_name}</td>
                      <td><IssueTypeBadge issueType={order.issue_type} /></td>
                      <td><StatusBadge status={order.status} /></td>
                      <td><RegionBadge region={order.region} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="active-sessions-card">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider">Active Sessions</h2>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs text-emerald-400 font-mono">{stats?.active_sessions ?? 0}</span>
            </div>
          </div>
          <ScrollArea className="h-[320px]">
            {(stats?.active_sessions ?? 0) === 0 ? (
              <div className="p-4">
                <EmptyState icon={MessageSquare} title="No active sessions" description="Sessions appear when automation is running" />
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {activeSessions.map((session) => {
                  const order = orders.find((o) => o.id === session.order_id);
                  return (
                    <div key={session.id} className="bg-slate-800/50 border border-slate-700 rounded-sm p-3" data-testid={`session-${session.id}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white font-medium">{order?.merchant_name ?? "Unknown"}</span>
                        <StatusBadge status={session.status} />
                      </div>
                      <div className="font-mono text-xs text-slate-400 mb-1">{order?.order_number ?? session.order_id.slice(0, 8) + "…"}</div>
                      <div className="text-xs text-slate-500">
                        {session.started_at ? `Started ${format(new Date(session.started_at), "HH:mm")}` : "Starting…"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-sm" data-testid="activity-log-card">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider">Activity Log</h2>
            <Activity className="w-4 h-4 text-slate-500" />
          </div>
          <div className="terminal-content h-[200px] overflow-y-auto">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No recent activity</p>
            ) : (
              <div className="space-y-1 font-mono text-xs">
                {recentActivity.map((log: ActivityLog) => (
                  <div key={log.id} className="log-line flex">
                    <span className="log-timestamp">[{format(new Date(log.timestamp), "HH:mm:ss")}]</span>
                    <span className={getLogColor(log.action)}>{log.action}</span>
                    {log.details && <span className="text-slate-500 ml-2">- {log.details}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-sm p-4" data-testid="quick-stats-card">
          <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider mb-4">Issue Distribution</h2>
          <div className="space-y-3">
            {["DNA", "EB", "Step1", "Step2", "LIT", "Followup"].map((t) => (
              <IssueStatBar key={t} label={t} count={getIssueCount(orders, t)} total={orders?.length || 1} />
            ))}
          </div>
        </div>
      </div>
    </RetailLayout>
  );
}
