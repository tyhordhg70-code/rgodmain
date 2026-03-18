import { Link, useLocation } from "wouter";
import { useRetail } from "@/context/RetailContext";
import {
  LayoutDashboard, Package, MessageSquare, Store, Settings,
  Activity, Bot, Shield, Search, Bell, RefreshCw, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const navigation = [
  { name: "Dashboard", href: "/retail", icon: LayoutDashboard },
  { name: "Orders", href: "/retail/orders", icon: Package },
  { name: "Live Sessions", href: "/retail/sessions", icon: MessageSquare },
  { name: "Merchants", href: "/retail/merchants", icon: Store },
  { name: "Activity Log", href: "/retail/activity", icon: Activity },
  { name: "Settings", href: "/retail/settings", icon: Settings },
];

function StatusIndicator({ label, status }: { label: string; status: string }) {
  const colors: Record<string, string> = {
    connected: "bg-emerald-400", ready: "bg-emerald-400", active: "bg-emerald-400",
    disconnected: "bg-red-400", error: "bg-red-400", pending: "bg-amber-400",
  };
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${colors[status] ?? "bg-slate-500"}`} />
        <span className="text-slate-500 capitalize">{status}</span>
      </div>
    </div>
  );
}

function RetailSidebar() {
  const [location] = useLocation();
  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-slate-900/50 border-r border-slate-800 z-40" data-testid="retail-sidebar">
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-sm flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <span className="font-heading font-bold text-lg text-white tracking-tight">AutoResolve</span>
        </div>
      </div>
      <nav className="p-4 space-y-1" data-testid="retail-sidebar-nav">
        {navigation.map((item) => {
          const isActive = location === item.href || (item.href !== "/retail" && location.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`nav-item ${isActive ? "active" : ""}`}
              data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-sm font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800 space-y-3">
        <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 rounded-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors" data-testid="nav-form-dashboard">
          <FileText className="w-4 h-4" />
          <span className="text-sm font-medium">Form Dashboard</span>
        </Link>
        <div className="bg-slate-900 border border-slate-800 rounded-sm p-3">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-slate-500" />
            <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">System Status</span>
          </div>
          <div className="space-y-2">
            <StatusIndicator label="Telegram Bot" status="connected" />
            <StatusIndicator label="Encryption" status="ready" />
            <StatusIndicator label="Proxy Pool" status="active" />
          </div>
        </div>
      </div>
    </aside>
  );
}

function RetailHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { fetchStats, fetchOrders, loading } = useRetail();
  const handleRefresh = async () => { await Promise.all([fetchStats(), fetchOrders()]); };
  return (
    <header className="h-16 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-30" data-testid="retail-header">
      <div className="h-full px-6 flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-xl text-white tracking-tight" data-testid="page-title">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input placeholder="Search orders, merchants..." className="w-64 pl-9 bg-slate-900 border-slate-700 text-sm" data-testid="global-search" />
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={loading} className="text-slate-400 hover:text-white" data-testid="refresh-btn">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white relative" data-testid="notifications-btn">
            <Bell className="w-4 h-4" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </Button>
        </div>
      </div>
    </header>
  );
}

interface RetailLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function RetailLayout({ title, subtitle, children }: RetailLayoutProps) {
  return (
    <div className="min-h-screen bg-[#020617]">
      <RetailSidebar />
      <div className="pl-64">
        <RetailHeader title={title} subtitle={subtitle} />
        <main className="p-6" data-testid="retail-main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
