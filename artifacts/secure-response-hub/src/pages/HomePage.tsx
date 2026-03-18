import { useLocation } from "wouter";
import { Shield, FileText, LayoutDashboard, ArrowRight, Bot } from "lucide-react";

export default function HomePage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-7 h-7 text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">AutoResolve</h1>
          <p className="text-slate-400 text-sm mt-1">Order management portal</p>
        </div>

        <button
          onClick={() => navigate("/form")}
          data-testid="btn-go-form"
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-800/60 backdrop-blur border border-slate-700/50 hover:border-blue-500/50 hover:bg-slate-800/80 transition-all text-left group"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold text-sm">Submit Order</p>
            <p className="text-slate-400 text-xs mt-0.5">Fill out the order submission form</p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-blue-400 transition-colors" />
        </button>

        <button
          onClick={() => navigate("/login")}
          data-testid="btn-go-dashboard"
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-800/60 backdrop-blur border border-slate-700/50 hover:border-blue-500/50 hover:bg-slate-800/80 transition-all text-left group"
        >
          <div className="w-10 h-10 rounded-xl bg-slate-700/50 border border-slate-600/50 flex items-center justify-center shrink-0">
            <LayoutDashboard className="w-5 h-5 text-slate-400" />
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold text-sm">Dashboard</p>
            <p className="text-slate-400 text-xs mt-0.5">View and manage responses</p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-blue-400 transition-colors" />
        </button>

        <button
          onClick={() => navigate("/retail")}
          data-testid="btn-go-retail"
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-800/60 backdrop-blur border border-slate-700/50 hover:border-indigo-500/50 hover:bg-slate-800/80 transition-all text-left group"
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold text-sm">AutoResolve</p>
            <p className="text-slate-400 text-xs mt-0.5">Retail resolution command center</p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
        </button>
      </div>
    </div>
  );
}
