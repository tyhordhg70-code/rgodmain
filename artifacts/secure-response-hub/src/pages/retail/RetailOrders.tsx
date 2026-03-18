import { useState, useEffect } from "react";
import { RetailLayout } from "@/components/retail/RetailLayout";
import { StatusBadge, IssueTypeBadge, RegionBadge, EmptyState } from "@/components/retail/RetailCommon";
import { useRetail, Order } from "@/context/RetailContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Search, Package, Trash2, Play } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { retailApi } from "@/lib/retail-api";

const defaultOrder = {
  order_number: "", merchant_name: "", merchant_url: "", region: "usa",
  issue_type: "DNA", desired_outcome: "Refund", notes: "",
  customer: { name: "", email: "", phone: "", address: "", city: "", state: "", zip_code: "", country: "USA" },
};

export default function RetailOrders() {
  const { orders, fetchOrders, createOrder, deleteOrder, loading } = useRetail();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [issueFilter, setIssueFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [newOrder, setNewOrder] = useState(defaultOrder);

  useEffect(() => {
    const filters: Record<string, string> = {};
    if (statusFilter !== "all") filters.status = statusFilter;
    if (issueFilter !== "all") filters.issue_type = issueFilter;
    if (regionFilter !== "all") filters.region = regionFilter;
    if (search) filters.search = search;
    fetchOrders(filters);
  }, [statusFilter, issueFilter, regionFilter, search, fetchOrders]);

  const handleCreate = async () => {
    try {
      await createOrder(newOrder as Partial<Order>);
      toast.success("Order created successfully");
      setOpen(false);
      setNewOrder(defaultOrder);
    } catch { toast.error("Failed to create order"); }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Delete this order?")) return;
    try { await deleteOrder(id); toast.success("Order deleted"); }
    catch { toast.error("Failed to delete order"); }
  };

  const handleStartAutomation = async (orderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await retailApi.post<{ success: boolean; session_id?: string }>("/automation/start", { order_id: orderId });
      if (r.success) toast.success("Automation started!", { description: `Session: ${r.session_id?.slice(0, 8)}...` });
      else toast.error("Failed to start automation");
    } catch (err: unknown) { toast.error("Failed to start automation", { description: err instanceof Error ? err.message : String(err) }); }
  };

  const setC = (field: string, val: string) => setNewOrder((p) => ({ ...p, customer: { ...p.customer, [field]: val } }));

  return (
    <RetailLayout title="Orders" subtitle="Manage customer order issues">
      <div className="flex flex-wrap items-center gap-4 mb-6" data-testid="orders-filters">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input placeholder="Search orders..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-slate-900 border-slate-700" data-testid="orders-search" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px] bg-slate-900 border-slate-700" data-testid="status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={issueFilter} onValueChange={setIssueFilter}>
          <SelectTrigger className="w-[150px] bg-slate-900 border-slate-700" data-testid="issue-filter"><SelectValue placeholder="Issue Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Issues</SelectItem>
            <SelectItem value="DNA">DNA</SelectItem>
            <SelectItem value="EB">EB</SelectItem>
            <SelectItem value="Step1">Step1</SelectItem>
            <SelectItem value="Step2">Step2</SelectItem>
            <SelectItem value="LIT">LIT</SelectItem>
            <SelectItem value="Followup">Followup</SelectItem>
          </SelectContent>
        </Select>
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="w-[150px] bg-slate-900 border-slate-700" data-testid="region-filter"><SelectValue placeholder="Region" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            <SelectItem value="usa">USA</SelectItem>
            <SelectItem value="canada">Canada</SelectItem>
            <SelectItem value="uk">UK</SelectItem>
            <SelectItem value="eu">EU</SelectItem>
          </SelectContent>
        </Select>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="btn-primary" data-testid="create-order-btn"><Plus className="w-4 h-4 mr-2" />New Order</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl bg-slate-900 border-slate-700">
            <DialogHeader><DialogTitle className="font-heading text-white">Create New Order</DialogTitle></DialogHeader>
            <ScrollArea className="max-h-[70vh]">
              <div className="grid gap-4 py-4 px-1">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-400">Order Number</Label>
                    <Input value={newOrder.order_number} onChange={(e) => setNewOrder((p) => ({ ...p, order_number: e.target.value }))} className="mt-1 bg-slate-950 border-slate-700" placeholder="123-456-789" data-testid="order-number-input" />
                  </div>
                  <div>
                    <Label className="text-slate-400">Merchant Name</Label>
                    <Input value={newOrder.merchant_name} onChange={(e) => setNewOrder((p) => ({ ...p, merchant_name: e.target.value }))} className="mt-1 bg-slate-950 border-slate-700" placeholder="Amazon, Target..." data-testid="merchant-name-input" />
                  </div>
                </div>
                <div>
                  <Label className="text-slate-400">Merchant URL</Label>
                  <Input value={newOrder.merchant_url} onChange={(e) => setNewOrder((p) => ({ ...p, merchant_url: e.target.value }))} className="mt-1 bg-slate-950 border-slate-700" placeholder="https://..." data-testid="merchant-url-input" />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-slate-400">Region</Label>
                    <Select value={newOrder.region} onValueChange={(v) => setNewOrder((p) => ({ ...p, region: v }))}>
                      <SelectTrigger className="mt-1 bg-slate-950 border-slate-700"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="usa">USA</SelectItem>
                        <SelectItem value="canada">Canada</SelectItem>
                        <SelectItem value="uk">UK</SelectItem>
                        <SelectItem value="eu">EU</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-slate-400">Issue Type</Label>
                    <Select value={newOrder.issue_type} onValueChange={(v) => setNewOrder((p) => ({ ...p, issue_type: v }))}>
                      <SelectTrigger className="mt-1 bg-slate-950 border-slate-700" data-testid="issue-type-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DNA">DNA - Did Not Arrive</SelectItem>
                        <SelectItem value="EB">EB - Empty Box</SelectItem>
                        <SelectItem value="Step1">Step1 - Create Return</SelectItem>
                        <SelectItem value="Step2">Step2 - Return Not Processed</SelectItem>
                        <SelectItem value="LIT">LIT - Lost In Transit</SelectItem>
                        <SelectItem value="Followup">Followup</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-slate-400">Desired Outcome</Label>
                    <Select value={newOrder.desired_outcome} onValueChange={(v) => setNewOrder((p) => ({ ...p, desired_outcome: v }))}>
                      <SelectTrigger className="mt-1 bg-slate-950 border-slate-700"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Refund">Refund</SelectItem>
                        <SelectItem value="Replacement">Replacement</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="border-t border-slate-800 pt-4 mt-2">
                  <h3 className="font-heading font-bold text-sm text-white uppercase tracking-wider mb-3">Customer Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label className="text-slate-400">Full Name</Label><Input value={newOrder.customer.name} onChange={(e) => setC("name", e.target.value)} className="mt-1 bg-slate-950 border-slate-700" data-testid="customer-name-input" /></div>
                    <div><Label className="text-slate-400">Email</Label><Input type="email" value={newOrder.customer.email} onChange={(e) => setC("email", e.target.value)} className="mt-1 bg-slate-950 border-slate-700" data-testid="customer-email-input" /></div>
                    <div><Label className="text-slate-400">Phone</Label><Input value={newOrder.customer.phone} onChange={(e) => setC("phone", e.target.value)} className="mt-1 bg-slate-950 border-slate-700" /></div>
                    <div><Label className="text-slate-400">Country</Label><Input value={newOrder.customer.country} onChange={(e) => setC("country", e.target.value)} className="mt-1 bg-slate-950 border-slate-700" /></div>
                    <div className="col-span-2"><Label className="text-slate-400">Address</Label><Input value={newOrder.customer.address} onChange={(e) => setC("address", e.target.value)} className="mt-1 bg-slate-950 border-slate-700" /></div>
                    <div><Label className="text-slate-400">City</Label><Input value={newOrder.customer.city} onChange={(e) => setC("city", e.target.value)} className="mt-1 bg-slate-950 border-slate-700" /></div>
                    <div><Label className="text-slate-400">State / ZIP</Label>
                      <div className="flex gap-2 mt-1">
                        <Input value={newOrder.customer.state} onChange={(e) => setC("state", e.target.value)} className="bg-slate-950 border-slate-700" placeholder="State" />
                        <Input value={newOrder.customer.zip_code} onChange={(e) => setC("zip_code", e.target.value)} className="bg-slate-950 border-slate-700" placeholder="ZIP" />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <Label className="text-slate-400">Notes</Label>
                  <Textarea value={newOrder.notes} onChange={(e) => setNewOrder((p) => ({ ...p, notes: e.target.value }))} className="mt-1 bg-slate-950 border-slate-700" rows={3} placeholder="Additional notes..." />
                </div>
              </div>
            </ScrollArea>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="btn-primary" onClick={handleCreate} data-testid="submit-order-btn">Create Order</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-sm" data-testid="orders-table">
        {orders.length === 0 ? (
          <EmptyState icon={Package} title="No orders found" description="Create your first order to get started" action={<Button className="btn-primary" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" />New Order</Button>} />
        ) : (
          <ScrollArea className="h-[calc(100vh-280px)]">
            <table className="w-full data-table">
              <thead>
                <tr>
                  <th className="text-left">Order #</th>
                  <th className="text-left">Merchant</th>
                  <th className="text-left">Issue</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">Region</th>
                  <th className="text-left">Created</th>
                  <th className="text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} data-testid={`order-row-${order.id}`}>
                    <td><span className="font-mono text-xs text-slate-300">{order.order_number}</span></td>
                    <td className="text-sm text-slate-400">{order.merchant_name}</td>
                    <td><IssueTypeBadge issueType={order.issue_type} /></td>
                    <td><StatusBadge status={order.status} /></td>
                    <td><RegionBadge region={order.region} /></td>
                    <td className="font-mono text-xs text-slate-500">{order.created_at ? format(new Date(order.created_at), "MMM d, HH:mm") : "—"}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-indigo-400 hover:text-indigo-300" onClick={(e) => handleStartAutomation(order.id, e)} data-testid={`start-automation-${order.id}`}><Play className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={(e) => handleDelete(order.id, e)} data-testid={`delete-order-${order.id}`}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </div>
    </RetailLayout>
  );
}
