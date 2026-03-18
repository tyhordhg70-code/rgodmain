import { useState, useEffect } from "react";
import { RetailLayout } from "@/components/retail/RetailLayout";
import { RegionBadge, EmptyState } from "@/components/retail/RetailCommon";
import { useRetail, Merchant } from "@/context/RetailContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Search, Store, ExternalLink, Check, X, Download } from "lucide-react";
import { toast } from "sonner";
import { retailApi } from "@/lib/retail-api";

const defaultMerchant = { name: "", url: "", region: "usa", live_chat_available: true, live_chat_selector: "", notes: "" };

function MerchantCard({ merchant }: { merchant: Merchant }) {
  let hostname = merchant.url;
  try { hostname = new URL(merchant.url).hostname; } catch {}
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-sm p-4 card-hover" data-testid={`merchant-card-${merchant.id}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-800 rounded-sm flex items-center justify-center"><Store className="w-5 h-5 text-slate-400" /></div>
          <div>
            <h3 className="font-medium text-white text-sm">{merchant.name}</h3>
            <a href={merchant.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:text-indigo-400 flex items-center gap-1">{hostname}<ExternalLink className="w-3 h-3" /></a>
          </div>
        </div>
        <RegionBadge region={merchant.region} />
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-slate-800">
        <div className="flex items-center gap-2">
          {merchant.live_chat_available
            ? <span className="flex items-center gap-1.5 text-xs text-emerald-400"><Check className="w-3 h-3" />Live Chat</span>
            : <span className="flex items-center gap-1.5 text-xs text-slate-500"><X className="w-3 h-3" />No Live Chat</span>}
        </div>
        {merchant.live_chat_selector && <span className="font-mono text-[10px] text-slate-600 truncate max-w-[100px]" title={merchant.live_chat_selector}>{merchant.live_chat_selector}</span>}
      </div>
      {merchant.notes && <p className="text-xs text-slate-500 mt-2 line-clamp-2">{merchant.notes}</p>}
    </div>
  );
}

export default function RetailMerchants() {
  const { merchants, fetchMerchants, createMerchant, loading } = useRetail();
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newMerchant, setNewMerchant] = useState(defaultMerchant);

  useEffect(() => {
    const filters: Record<string, string> = {};
    if (regionFilter !== "all") filters.region = regionFilter;
    if (search) filters.search = search;
    fetchMerchants(filters);
  }, [regionFilter, search, fetchMerchants]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const r = await retailApi.post<{ success: boolean; imported: number }>("/merchants/import/known", {});
      if (r.success) { toast.success(`Imported ${r.imported} merchants!`); fetchMerchants({}); }
      else toast.error("Import failed");
    } catch { toast.error("Failed to import merchants"); }
    finally { setImporting(false); }
  };

  const handleCreate = async () => {
    try {
      await createMerchant(newMerchant as Partial<Merchant>);
      toast.success("Merchant added successfully");
      setOpen(false);
      setNewMerchant(defaultMerchant);
    } catch { toast.error("Failed to add merchant"); }
  };

  const byRegion = merchants.reduce<Record<string, Merchant[]>>((acc, m) => {
    const r = m.region || "other";
    if (!acc[r]) acc[r] = [];
    acc[r].push(m);
    return acc;
  }, {});

  return (
    <RetailLayout title="Merchants" subtitle="Store directory and live chat configuration">
      <div className="flex flex-wrap items-center gap-4 mb-6" data-testid="merchants-filters">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input placeholder="Search merchants..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-slate-900 border-slate-700" data-testid="merchants-search" />
        </div>
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="w-[150px] bg-slate-900 border-slate-700" data-testid="merchants-region-filter"><SelectValue placeholder="Region" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            <SelectItem value="usa">USA</SelectItem>
            <SelectItem value="canada">Canada</SelectItem>
            <SelectItem value="uk">UK</SelectItem>
            <SelectItem value="eu">EU</SelectItem>
          </SelectContent>
        </Select>
        <Button className="btn-secondary" onClick={handleImport} disabled={importing} data-testid="import-merchants-btn">
          <Download className={`w-4 h-4 mr-2 ${importing ? "animate-spin" : ""}`} />{importing ? "Importing..." : "Import Known Stores"}
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="btn-primary" data-testid="add-merchant-btn"><Plus className="w-4 h-4 mr-2" />Add Merchant</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md bg-slate-900 border-slate-700">
            <DialogHeader><DialogTitle className="font-heading text-white">Add New Merchant</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div><Label className="text-slate-400">Store Name</Label><Input value={newMerchant.name} onChange={(e) => setNewMerchant((p) => ({ ...p, name: e.target.value }))} className="mt-1 bg-slate-950 border-slate-700" placeholder="Amazon, Target..." data-testid="merchant-name-input" /></div>
              <div><Label className="text-slate-400">Website URL</Label><Input value={newMerchant.url} onChange={(e) => setNewMerchant((p) => ({ ...p, url: e.target.value }))} className="mt-1 bg-slate-950 border-slate-700" placeholder="https://www.store.com" data-testid="merchant-url-input" /></div>
              <div>
                <Label className="text-slate-400">Region</Label>
                <Select value={newMerchant.region} onValueChange={(v) => setNewMerchant((p) => ({ ...p, region: v }))}>
                  <SelectTrigger className="mt-1 bg-slate-950 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="usa">USA</SelectItem><SelectItem value="canada">Canada</SelectItem><SelectItem value="uk">UK</SelectItem><SelectItem value="eu">EU</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between"><Label className="text-slate-400">Live Chat Available</Label><Switch checked={newMerchant.live_chat_available} onCheckedChange={(c) => setNewMerchant((p) => ({ ...p, live_chat_available: c }))} /></div>
              <div><Label className="text-slate-400">Live Chat Selector (CSS)</Label><Input value={newMerchant.live_chat_selector} onChange={(e) => setNewMerchant((p) => ({ ...p, live_chat_selector: e.target.value }))} className="mt-1 bg-slate-950 border-slate-700 font-mono text-sm" placeholder="#chat-widget, .live-chat-btn" /></div>
              <div><Label className="text-slate-400">Notes</Label><Textarea value={newMerchant.notes} onChange={(e) => setNewMerchant((p) => ({ ...p, notes: e.target.value }))} className="mt-1 bg-slate-950 border-slate-700" rows={2} placeholder="Additional notes..." /></div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="btn-primary" onClick={handleCreate} data-testid="submit-merchant-btn">Add Merchant</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {merchants.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-sm">
          <EmptyState icon={Store} title="No merchants found" description="Add merchants to start managing live chat automation" action={<Button className="btn-primary" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" />Add Merchant</Button>} />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byRegion).map(([region, ms]) => (
            <div key={region} data-testid={`region-section-${region}`}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="font-heading font-bold text-sm text-white uppercase tracking-wider">{region.toUpperCase()}</h2>
                <span className="text-xs text-slate-500">({ms.length} stores)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {ms.map((m) => <MerchantCard key={m.id} merchant={m} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </RetailLayout>
  );
}
