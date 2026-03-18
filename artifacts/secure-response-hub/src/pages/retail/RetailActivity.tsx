import { useEffect } from "react";
import { RetailLayout } from "@/components/retail/RetailLayout";
import { EmptyState } from "@/components/retail/RetailCommon";
import { useRetail, ActivityLog } from "@/context/RetailContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw } from "lucide-react";
import { format } from "date-fns";

function getLogIcon(action: string) {
  const a = action.toLowerCase();
  if (a.includes("created")) return "➕";
  if (a.includes("resolved") || a.includes("success")) return "✓";
  if (a.includes("error") || a.includes("failed")) return "✕";
  if (a.includes("started")) return "▶";
  if (a.includes("ended")) return "⏹";
  return "•";
}

function getLogColor(action: string) {
  const a = action.toLowerCase();
  if (a.includes("resolved") || a.includes("success")) return "text-emerald-400";
  if (a.includes("error") || a.includes("failed")) return "text-red-400";
  if (a.includes("warning") || a.includes("pending")) return "text-amber-400";
  return "text-slate-300";
}

export default function RetailActivity() {
  const { recentActivity, fetchRecentActivity, loading } = useRetail();

  useEffect(() => { fetchRecentActivity(); }, [fetchRecentActivity]);

  return (
    <RetailLayout title="Activity Log" subtitle="System events and automation history">
      <div className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="activity-log-container">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-slate-400" />
            <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider">System Activity</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchRecentActivity} disabled={loading} className="text-slate-400 hover:text-white" data-testid="refresh-activity-btn">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
        <div className="terminal-content">
          <ScrollArea className="h-[calc(100vh-280px)]">
            {recentActivity.length === 0 ? (
              <EmptyState icon={Activity} title="No activity yet" description="System events will appear here" />
            ) : (
              <div className="space-y-1 font-mono text-sm">
                {recentActivity.map((log: ActivityLog) => (
                  <div key={log.id} className="flex items-start gap-3 py-1.5 hover:bg-slate-800/30 px-2 -mx-2 rounded-sm transition-colors" data-testid={`activity-row-${log.id}`}>
                    <span className="text-slate-600 shrink-0 w-32">{format(new Date(log.timestamp), "MMM d, HH:mm:ss")}</span>
                    <span className={`shrink-0 w-4 ${getLogColor(log.action)}`}>{getLogIcon(log.action)}</span>
                    <span className={`shrink-0 ${getLogColor(log.action)}`}>{log.action}</span>
                    {log.details && <span className="text-slate-500 truncate">— {log.details}</span>}
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                      {log.order_id && <span className="text-xs text-cyan-500/50 bg-cyan-500/10 px-1.5 py-0.5 rounded">{log.order_id.slice(0, 8)}</span>}
                      {log.session_id && <span className="text-xs text-purple-500/50 bg-purple-500/10 px-1.5 py-0.5 rounded">{log.session_id.slice(0, 8)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
        <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/50">
          <span className="text-xs text-slate-600">Showing {recentActivity.length} most recent events</span>
        </div>
      </div>
    </RetailLayout>
  );
}
