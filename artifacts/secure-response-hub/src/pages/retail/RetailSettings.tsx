import { useState, useEffect, useCallback } from "react";
import { RetailLayout } from "@/components/retail/RetailLayout";
import { useRetail, SystemStatus } from "@/context/RetailContext";
import { retailApi } from "@/lib/retail-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Shield, Bot, Wifi, Key, Settings as SettingsIcon,
  Check, AlertCircle, Eye, EyeOff, RefreshCw, Play, Square,
  Globe, Loader2,
} from "lucide-react";

function StatusRow({
  label, status, icon: Icon,
}: {
  label: string;
  status: boolean | undefined;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Icon className="w-4 h-4 text-slate-500" />
        <span className="text-sm text-slate-300">{label}</span>
      </div>
      {status
        ? <span className="flex items-center gap-1.5 text-sm text-emerald-400"><span className="w-2 h-2 bg-emerald-400 rounded-full" />Connected</span>
        : <span className="flex items-center gap-1.5 text-sm text-slate-500"><span className="w-2 h-2 bg-slate-500 rounded-full" />Not connected</span>}
    </div>
  );
}

interface DolphinProfile {
  id: number;
  name: string;
  status?: string;
  browserType?: string;
  tags?: string[];
  proxy?: { type: string; host: string; port: number } | null;
}

export default function RetailSettings() {
  const { systemStatus, fetchSystemStatus } = useRetail();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; error?: string } | null>(null);
  const [profiles, setProfiles] = useState<DolphinProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [actionStates, setActionStates] = useState<Record<number, "starting" | "stopping" | null>>({});
  const [statusMap, setStatusMap] = useState<Record<number, "running" | "stopped">>({});

  const extStatus = systemStatus as (SystemStatus & { dolphin_url?: string; dolphin_profile_id?: string | null }) | null;

  useEffect(() => { fetchSystemStatus(); }, [fetchSystemStatus]);

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError(null);
    try {
      const result = await retailApi.get<{ data: DolphinProfile[]; meta: { total: number } }>(
        "/dolphin/profiles",
      );
      setProfiles(result.data ?? []);
    } catch (e: any) {
      setProfilesError(e.message ?? "Failed to load profiles");
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await retailApi.post<{ connected: boolean; error?: string }>(
        "/dolphin/test",
        {},
      );
      setTestResult(res);
      if (res.connected) {
        await loadProfiles();
        await fetchSystemStatus();
      }
    } catch (e: any) {
      setTestResult({ connected: false, error: e.message });
    } finally {
      setTesting(false);
    }
  }, [loadProfiles, fetchSystemStatus]);

  const startProfile = useCallback(async (id: number) => {
    setActionStates((s) => ({ ...s, [id]: "starting" }));
    try {
      await retailApi.post(`/dolphin/profiles/${id}/start`, {});
      setStatusMap((s) => ({ ...s, [id]: "running" }));
    } catch (e: any) {
      alert(`Start failed: ${e.message}`);
    } finally {
      setActionStates((s) => ({ ...s, [id]: null }));
    }
  }, []);

  const stopProfile = useCallback(async (id: number) => {
    setActionStates((s) => ({ ...s, [id]: "stopping" }));
    try {
      await retailApi.post(`/dolphin/profiles/${id}/stop`, {});
      setStatusMap((s) => ({ ...s, [id]: "stopped" }));
    } catch (e: any) {
      alert(`Stop failed: ${e.message}`);
    } finally {
      setActionStates((s) => ({ ...s, [id]: null }));
    }
  }, []);

  useEffect(() => {
    if (extStatus?.dolphin_connected) loadProfiles();
  }, [extStatus?.dolphin_connected, loadProfiles]);

  return (
    <RetailLayout title="Settings" subtitle="System configuration and credentials">
      <div className="max-w-3xl space-y-6">

        {/* ── System Status ── */}
        <section className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="system-status-section">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-400" />System Status
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <StatusRow label="Telegram Bot"  status={systemStatus?.telegram_connected} icon={Bot} />
            <StatusRow label="Encryption"    status={systemStatus?.encryption_ready}   icon={Key} />
            <StatusRow label="Dolphin Browser" status={systemStatus?.dolphin_connected} icon={SettingsIcon} />
            <StatusRow label="Proxy Pool"    status={systemStatus?.proxy_configured}   icon={Wifi} />
          </div>
        </section>

        {/* ── Telegram Bot ── */}
        <section className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="telegram-section">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
              <Bot className="w-4 h-4 text-indigo-400" />Telegram Bot
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <Label className="text-slate-400">Bot Token</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value="••••••••••••••••••••••••••••"
                  readOnly
                  className="bg-slate-950 border-slate-700 font-mono"
                />
                <Button variant="ghost" size="icon" onClick={() => setShowKey(!showKey)} className="text-slate-400">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-slate-500 mt-1">Token is stored securely in environment variables</p>
            </div>
            <Separator className="bg-slate-800" />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-300">Auto-start Bot</Label>
                <p className="text-xs text-slate-500 mt-0.5">Automatically start bot when server restarts</p>
              </div>
              <Switch defaultChecked />
            </div>
          </div>
        </section>

        {/* ── Encryption ── */}
        <section className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="encryption-section">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-400" />Encryption
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-sm p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-amber-200 font-medium">Encryption password is set at runtime</p>
                  <p className="text-xs text-amber-300/70 mt-1">
                    The encryption password is requested via Telegram bot when starting.
                    This ensures the password is never stored in the system.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-300">Status</Label>
                <p className="text-xs text-slate-500 mt-0.5">Current encryption status</p>
              </div>
              {systemStatus?.encryption_ready
                ? <span className="flex items-center gap-1.5 text-sm text-emerald-400"><Check className="w-4 h-4" />Ready</span>
                : <span className="flex items-center gap-1.5 text-sm text-amber-400"><AlertCircle className="w-4 h-4" />Awaiting password</span>}
            </div>
          </div>
        </section>

        {/* ── Dolphin Anty ── */}
        <section className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="dolphin-section">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
              <SettingsIcon className="w-4 h-4 text-indigo-400" />Dolphin Anty Browser
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={testConnection}
              disabled={testing}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              {testing
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Testing…</>
                : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Test Connection</>}
            </Button>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-400">RDP Server</Label>
                <Input value="64.188.112.247" readOnly className="mt-1 bg-slate-950 border-slate-700 font-mono text-sm" />
              </div>
              <div>
                <Label className="text-slate-400">API Endpoint</Label>
                <Input
                  value={extStatus?.dolphin_url ?? "http://64.188.112.247:3001"}
                  readOnly
                  className="mt-1 bg-slate-950 border-slate-700 font-mono text-sm"
                />
              </div>
            </div>

            {extStatus?.dolphin_profile_id && (
              <div>
                <Label className="text-slate-400">Automation Profile</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={`Profile #${extStatus.dolphin_profile_id}`}
                    readOnly
                    className="bg-slate-950 border-slate-700 font-mono text-sm"
                  />
                  <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 shrink-0">
                    AUTO
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 mt-1">This profile is launched automatically when a new order is received.</p>
              </div>
            )}

            {testResult && (
              <div className={`rounded-sm p-3 flex items-center gap-2 text-sm ${testResult.connected ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border border-red-500/30 text-red-300"}`}>
                {testResult.connected
                  ? <><Check className="w-4 h-4 shrink-0" />Connected to Dolphin Anty API</>
                  : <><AlertCircle className="w-4 h-4 shrink-0" />{testResult.error ?? "Connection failed"}</>}
              </div>
            )}

            <p className="text-xs text-slate-500">
              Dolphin Anty runs on the RDP server. Make sure the application is running before starting automation.
            </p>

            <Separator className="bg-slate-800" />

            {/* Profile List */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-slate-300">Browser Profiles</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadProfiles}
                  disabled={profilesLoading}
                  className="text-slate-400 hover:text-slate-200 h-7 px-2"
                >
                  {profilesLoading
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                </Button>
              </div>

              {profilesError && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-sm px-3 py-2">
                  {profilesError}
                </p>
              )}

              {profiles.length === 0 && !profilesLoading && !profilesError && (
                <p className="text-sm text-slate-500 text-center py-4">
                  No profiles loaded — click Test Connection or Refresh to load.
                </p>
              )}

              {profiles.length > 0 && (
                <div className="space-y-2">
                  {profiles.map((p) => {
                    const isActive = statusMap[p.id] === "running";
                    const action = actionStates[p.id];
                    const isDefault = extStatus?.dolphin_profile_id === String(p.id);
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-sm px-4 py-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Globe className="w-4 h-4 text-slate-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm text-slate-200 truncate">
                              {p.name}
                              {isDefault && (
                                <Badge className="ml-2 bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px] py-0">AUTO</Badge>
                              )}
                            </p>
                            <p className="text-xs text-slate-500">ID: {p.id}{p.proxy ? ` · proxy: ${p.proxy.host}:${p.proxy.port}` : ""}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isActive && (
                            <span className="flex items-center gap-1 text-xs text-emerald-400">
                              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />Running
                            </span>
                          )}
                          {!isActive ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startProfile(p.id)}
                              disabled={action === "starting"}
                              className="h-7 border-slate-700 text-slate-300 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-300"
                            >
                              {action === "starting"
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <><Play className="w-3 h-3 mr-1" />Start</>}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => stopProfile(p.id)}
                              disabled={action === "stopping"}
                              className="h-7 border-slate-700 text-slate-300 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-300"
                            >
                              {action === "stopping"
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <><Square className="w-3 h-3 mr-1" />Stop</>}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Proxy ── */}
        <section className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="proxy-section">
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
              <Wifi className="w-4 h-4 text-indigo-400" />Proxy Configuration
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <Label className="text-slate-400">Proxy Server</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input value="residential.spyderproxy.com:7777" readOnly className="bg-slate-950 border-slate-700 font-mono text-sm" />
                {systemStatus?.proxy_configured
                  ? <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 shrink-0">Active</Badge>
                  : <Badge variant="outline" className="border-slate-600 text-slate-500 shrink-0">Inactive</Badge>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-400">Username</Label>
                <Input type="password" value="configured" readOnly className="mt-1 bg-slate-950 border-slate-700" />
              </div>
              <div>
                <Label className="text-slate-400">Password</Label>
                <Input type="password" value="configured" readOnly className="mt-1 bg-slate-950 border-slate-700" />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Proxy credentials are stored in environment variables and pushed to Dolphin profiles when automation starts.
            </p>
          </div>
        </section>

      </div>
    </RetailLayout>
  );
}
