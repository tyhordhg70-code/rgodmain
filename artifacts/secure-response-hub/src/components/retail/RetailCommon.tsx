import { cn } from "@/lib/utils";
import { Inbox } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down";
  trendValue?: string;
  className?: string;
  valueClassName?: string;
}

export function MetricCard({ title, value, subtitle, icon: Icon, trend, trendValue, className, valueClassName }: MetricCardProps) {
  return (
    <div className={cn("metric-card card-hover", className)} data-testid={`metric-${title?.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="metric-label">{title}</p>
          <p className={cn("metric-value mt-1", valueClassName)}>{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
          {trend && (
            <div className={cn("flex items-center gap-1 mt-2 text-xs font-medium", trend === "up" ? "text-emerald-400" : "text-red-400")}>
              <span>{trend === "up" ? "↑" : "↓"}</span>
              <span>{trendValue}</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className="p-2 bg-slate-800/50 rounded-sm">
            <Icon className="w-5 h-5 text-slate-400" />
          </div>
        )}
      </div>
    </div>
  );
}

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "status-pending" },
  in_progress: { label: "In Progress", className: "status-in-progress" },
  resolved: { label: "Resolved", className: "status-resolved" },
  failed: { label: "Failed", className: "status-failed" },
  escalated: { label: "Escalated", className: "status-escalated" },
  awaiting_followup: { label: "Awaiting Followup", className: "status-pending" },
  idle: { label: "Idle", className: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
  provisioning: { label: "Provisioning", className: "status-pending" },
  navigation: { label: "Navigating", className: "status-in-progress" },
  chat_active: { label: "Chat Active", className: "status-in-progress" },
  resolution_reached: { label: "Resolved", className: "status-resolved" },
  reporting: { label: "Reporting", className: "status-resolved" },
  error: { label: "Error", className: "status-failed" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = statusConfig[status] ?? { label: status, className: "bg-slate-500/10 text-slate-400 border-slate-500/30" };
  return (
    <span className={cn("badge", cfg.className, className)} data-testid={`status-badge-${status}`}>
      {cfg.label}
    </span>
  );
}

const issueConfig: Record<string, { label: string; className: string; tooltip: string }> = {
  DNA: { label: "DNA", className: "issue-dna", tooltip: "Did Not Arrive" },
  EB: { label: "EB", className: "issue-eb", tooltip: "Empty Box" },
  Step1: { label: "STEP1", className: "issue-step1", tooltip: "Create Return" },
  Step2: { label: "STEP2", className: "issue-step2", tooltip: "Return Not Processed" },
  LIT: { label: "LIT", className: "issue-lit", tooltip: "Lost In Transit" },
  Followup: { label: "FOLLOWUP", className: "issue-followup", tooltip: "Followup Required" },
};

export function IssueTypeBadge({ issueType, className }: { issueType: string; className?: string }) {
  const cfg = issueConfig[issueType] ?? { label: issueType, className: "bg-slate-500/10 text-slate-400 border-slate-500/30", tooltip: issueType };
  return (
    <span className={cn("badge", cfg.className, className)} title={cfg.tooltip} data-testid={`issue-badge-${issueType}`}>
      {cfg.label}
    </span>
  );
}

const regionConfig: Record<string, { label: string; className: string }> = {
  usa: { label: "USA", className: "region-usa" },
  canada: { label: "CA", className: "region-canada" },
  uk: { label: "UK", className: "region-uk" },
  eu: { label: "EU", className: "region-eu" },
};

export function RegionBadge({ region, className }: { region: string; className?: string }) {
  const cfg = regionConfig[region] ?? { label: region?.toUpperCase(), className: "bg-slate-500/10 text-slate-400 border-slate-500/30" };
  return (
    <span className={cn("badge", cfg.className, className)} data-testid={`region-badge-${region}`}>
      {cfg.label}
    </span>
  );
}

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}

export function EmptyState({ title = "No data found", description = "There are no items to display.", icon: Icon = Inbox, action }: EmptyStateProps) {
  return (
    <div className="empty-state" data-testid="empty-state">
      <Icon className="w-12 h-12 text-slate-600 mb-4" />
      <h3 className="text-lg font-medium text-slate-300 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 mb-4">{description}</p>
      {action}
    </div>
  );
}
