import { useState, useEffect } from "react";
import { RetailLayout } from "@/components/retail/RetailLayout";
import { StatusBadge, EmptyState } from "@/components/retail/RetailCommon";
import { useRetail, Session } from "@/context/RetailContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Pause, RefreshCw, Monitor, Wifi, Shield } from "lucide-react";
import { format } from "date-fns";

function ActiveSessionCard({ session }: { session: Session }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-sm p-4" data-testid={`active-session-${session.id}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-cyan-400">{session.id.slice(0, 8)}...</span>
            <StatusBadge status={session.status} />
          </div>
          <p className="text-sm text-slate-400">Order: <span className="font-mono text-slate-300">{session.order_id.slice(0, 8)}...</span></p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white"><Pause className="w-4 h-4" /></Button>
      </div>
      <div className="flex items-center gap-4 text-xs">
        {session.browser_profile_id && <div className="flex items-center gap-1.5 text-slate-500"><Shield className="w-3 h-3" /><span>Profile Active</span></div>}
        {session.proxy_ip && <div className="flex items-center gap-1.5 text-slate-500"><Wifi className="w-3 h-3" /><span className="font-mono">{session.proxy_ip}</span></div>}
      </div>
      {session.messages && session.messages.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700">
          <p className="text-xs text-slate-500 mb-1">Latest message:</p>
          <p className="text-sm text-slate-300 line-clamp-2">{session.messages[session.messages.length - 1].content}</p>
        </div>
      )}
      <div className="mt-3 text-xs text-slate-500">Started {format(new Date(session.started_at), "HH:mm:ss")}</div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="font-mono text-lg text-white">{value}</span>
    </div>
  );
}

export default function RetailSessions() {
  const { sessions, fetchSessions, fetchActiveSessions, loading } = useRetail();
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);

  useEffect(() => {
    fetchSessions();
    const loadActive = () => fetchActiveSessions().then((s) => setActiveSessions(s ?? []));
    loadActive();
    const id = setInterval(loadActive, 10_000);
    return () => clearInterval(id);
  }, [fetchSessions, fetchActiveSessions]);

  return (
    <RetailLayout title="Live Sessions" subtitle="Monitor active automation sessions">
      <div className="bg-slate-900 border border-slate-800 rounded-sm p-4 mb-6" data-testid="active-sessions-banner">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-600/20 border border-indigo-500/30 rounded-sm flex items-center justify-center">
              <Monitor className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-lg text-white">{activeSessions.length} Active Session{activeSessions.length !== 1 ? "s" : ""}</h2>
              <p className="text-sm text-slate-400">Real-time automation monitoring</p>
            </div>
          </div>
          <Button className="btn-secondary" onClick={() => fetchActiveSessions().then((s) => setActiveSessions(s ?? []))} data-testid="refresh-sessions-btn">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="active-sessions-list">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-heading font-bold text-sm text-white uppercase tracking-wider">Active Now</h3>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs text-emerald-400 font-mono">{activeSessions.length}</span>
            </div>
          </div>
          <ScrollArea className="h-[400px]">
            {activeSessions.length === 0 ? (
              <div className="p-4"><EmptyState icon={MessageSquare} title="No active sessions" description="Sessions will appear here when automation is running" /></div>
            ) : (
              <div className="p-4 space-y-3">{activeSessions.map((s) => <ActiveSessionCard key={s.id} session={s} />)}</div>
            )}
          </ScrollArea>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="session-stats">
          <div className="px-4 py-3 border-b border-slate-800"><h3 className="font-heading font-bold text-sm text-white uppercase tracking-wider">Session Statistics</h3></div>
          <div className="p-4 space-y-4">
            <StatRow label="Total Sessions Today" value={sessions.filter((s) => new Date(s.started_at).toDateString() === new Date().toDateString()).length} />
            <StatRow label="Completed" value={sessions.filter((s) => s.status === "resolution_reached" || s.status === "reporting").length} />
            <StatRow label="Failed" value={sessions.filter((s) => s.status === "error").length} />
            <StatRow label="Avg. Duration" value="--" />
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="session-history">
        <div className="px-4 py-3 border-b border-slate-800"><h3 className="font-heading font-bold text-sm text-white uppercase tracking-wider">Session History</h3></div>
        <ScrollArea className="h-[300px]">
          {sessions.length === 0 ? (
            <EmptyState icon={MessageSquare} title="No session history" description="Completed sessions will appear here" />
          ) : (
            <table className="w-full data-table">
              <thead><tr><th className="text-left">Session ID</th><th className="text-left">Order ID</th><th className="text-left">Status</th><th className="text-left">Started</th><th className="text-left">Ended</th><th className="text-left">Messages</th></tr></thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} data-testid={`session-row-${session.id}`}>
                    <td><span className="font-mono text-xs text-cyan-400">{session.id.slice(0, 8)}...</span></td>
                    <td><span className="font-mono text-xs text-slate-400">{session.order_id.slice(0, 8)}...</span></td>
                    <td><StatusBadge status={session.status} /></td>
                    <td className="font-mono text-xs text-slate-500">{format(new Date(session.started_at), "MMM d, HH:mm")}</td>
                    <td className="font-mono text-xs text-slate-500">{session.ended_at ? format(new Date(session.ended_at), "HH:mm") : "--"}</td>
                    <td className="font-mono text-xs text-slate-400">{session.messages?.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ScrollArea>
      </div>
    </RetailLayout>
  );
}
