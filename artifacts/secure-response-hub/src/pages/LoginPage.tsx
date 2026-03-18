import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Lock, Eye, EyeOff, Shield, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const from = new URLSearchParams(window.location.search).get("from") || "/dashboard";
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);

    try {
      const res = await apiRequest("POST", "/api/auth/login", { password });
      const data = await res.json();
      sessionStorage.setItem("dk", data.encryptionKey);
      sessionStorage.removeItem("dk_legacy");
      // Immediately update the auth cache to avoid race condition with AuthGuard
      queryClient.setQueryData(["/api/auth/check"], { authenticated: true });
      navigate(decodeURIComponent(from));
    } catch {
      toast({
        title: "Access Denied",
        description: "Incorrect password. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-7 h-7 text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Secure Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Enter your access password to continue</p>
        </div>

        <form onSubmit={handleLogin} className="bg-slate-800/60 backdrop-blur border border-slate-700/50 rounded-2xl p-6 shadow-2xl">
          <div className="space-y-4">
            <div>
              <Label className="text-slate-300 text-sm font-medium">Password</Label>
              <div className="relative mt-1.5">
                <Input
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter dashboard password"
                  className="bg-slate-900/50 border-slate-600/50 text-white placeholder:text-slate-500 pr-10 h-11"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              data-testid="btn-login"
              disabled={loading || !password.trim()}
              className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-semibold gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              {loading ? "Authenticating..." : "Access Dashboard"}
            </Button>
          </div>
        </form>

        <div className="flex justify-center mt-6">
          <button
            onClick={() => navigate("/")}
            data-testid="btn-home"
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            <Home className="w-3 h-3" />
            Back to Home
          </button>
        </div>
      </motion.div>
    </div>
  );
}
