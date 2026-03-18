import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, LogOut, Copy, Trash2, FileText, ChevronDown, ChevronUp,
  Shield, Clock, Check, StickyNote, PenLine, X, Settings, RefreshCw,
  AlertTriangle, Inbox, Lock, Upload, Download, FileUp, ExternalLink, Home, ShoppingBag,
  Moon, Sun, TrendingUp, DollarSign
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { decryptData, encryptData } from "@/lib/crypto";
import type { FormQuestion } from "@workspace/db";

interface RawResponse {
  id: string;
  encryptedData: string;
  createdAt: string;
  telegramNotified: boolean;
  encryptedNote: string | null;
}

interface DecryptedResponse {
  id: string;
  createdAt: string;
  telegramNotified: boolean;
  answers: Record<string, string>;
  submittedAt?: string;
  note: string;
  encryptedNote: string | null;
  decryptError?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatFieldValue(val: string): string {
  if (!val) return val;
  // Try to parse as address JSON
  try {
    const a = JSON.parse(val);
    if (a && typeof a === "object" && (a.line1 || a.city)) {
      const line2 = a.line2 ? `, ${a.line2}` : "";
      const statePostal = [a.state, a.postal].filter(Boolean).join(" ");
      const parts = [
        a.line1 ? `${a.line1}${line2}` : null,
        a.city,
        statePostal || null,
        a.country,
      ].filter(Boolean);
      return parts.join(", ");
    }
  } catch {}
  return val;
}

const QUESTION_IDS = [
  "agreement","order_ref","order_date","platform","order_value",
  "item_description","quantity","condition","serial_numbers",
  "claim_reason","contacted_seller","evidence_notes",
  "full_name","email","phone","contact_method","telegram_username","refund_details",
];

const DISPLAY_LABELS: Record<string, string> = {
  order_ref: "Order Number",
  platform: "Platform",
  order_value: "Order Value",
  order_date: "Order Date",
  item_description: "Item Description",
  claim_reason: "Claim Reason",
  evidence_notes: "Evidence / Notes",
  full_name: "Full Name",
  refund_details: "Refund Details",
  serial_numbers: "Serial Numbers",
  contact_method: "Contact Method",
  contacted_seller: "Contacted Seller",
  telegram_username: "Telegram Username",
};

const OLD_FIELD_MAP: Record<string, string> = {
  order_number: "order_ref",
  order_id: "order_ref",
  order_no: "order_ref",
  merchant_name: "platform",
  merchant: "platform",
  merchant_url: "platform",
  website: "platform",
  store: "platform",
  "customer.name": "full_name",
  "customer.email": "email",
  "customer.phone": "phone",
  customer_name: "full_name",
  customer_email: "email",
  customer_phone: "phone",
  name: "full_name",
  full_name: "full_name",
  email: "email",
  phone: "phone",
  issue_type: "claim_reason",
  issue: "claim_reason",
  reason: "claim_reason",
  desired_outcome: "refund_details",
  outcome: "refund_details",
  refund_details: "refund_details",
  notes: "evidence_notes",
  additional_notes: "evidence_notes",
  evidence_notes: "evidence_notes",
  order_date: "order_date",
  date: "order_date",
  created_at: "order_date",
  order_value: "order_value",
  value: "order_value",
  total: "order_value",
  amount: "order_value",
  quantity: "quantity",
  qty: "quantity",
  condition: "condition",
  item_description: "item_description",
  item: "item_description",
  items: "item_description",
  description: "item_description",
  serial_numbers: "serial_numbers",
  serial: "serial_numbers",
  contact_method: "contact_method",
  contacted_seller: "contacted_seller",
  telegram: "telegram_username",
  telegram_username: "telegram_username",
  telegram_handle: "telegram_username",
  telegram_user: "telegram_username",
  "@username": "telegram_username",
};

function mapRow(raw: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || v.trim() === "") continue;
    const lk = k.toLowerCase().trim().replace(/\s+/g, "_");
    const mapped = OLD_FIELD_MAP[lk] || lk;
    let val = v;
    if (mapped === "phone") {
      val = val.replace(/^\++/, "+");
    }
    if (mapped in result) {
      const existing = result[mapped].split(" | ").map((s: string) => s.trim());
      if (!existing.includes(val.trim())) {
        result[mapped] = result[mapped] + " | " + val;
      }
    } else {
      result[mapped] = val;
    }
  }
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQuotes) { inQuotes = true; continue; }
      if (ch === '"' && inQuotes) {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
        continue;
      }
      if (ch === ',' && !inQuotes) { fields.push(cur); cur = ""; continue; }
      cur += ch;
    }
    fields.push(cur);
    return fields;
  };

  const headers = parseRow(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseRow(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { if (h.trim()) obj[h.trim()] = vals[idx] ?? ""; });
    rows.push(obj);
  }
  return rows;
}

function isSectionKey(k: string): boolean {
  return /^section[\s_-]*\d+$/i.test(k.trim());
}

function flattenJSON(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
      const nextPrefix = isSectionKey(k) ? prefix : (prefix ? `${prefix}.${k}` : k);
      Object.assign(result, flattenJSON(v as Record<string, unknown>, nextPrefix));
    } else {
      if (isSectionKey(k)) continue;
      const key = prefix ? `${prefix}.${k}` : k;
      result[key] = Array.isArray(v) ? (v as unknown[]).join(", ") : String(v ?? "");
    }
  }
  return result;
}

function downloadTemplate(format: "csv" | "json" = "csv") {
  const sampleRow: Record<string, string> = {
    agreement: "Yes",
    order_ref: "ORD-12345",
    order_date: "2024-01-15",
    platform: "Amazon",
    order_value: "$250.00",
    item_description: "Samsung TV 55 inch",
    quantity: "1",
    condition: "New / Sealed",
    serial_numbers: "SN123456",
    claim_reason: "Item not delivered",
    contacted_seller: "No",
    evidence_notes: "Tracking shows delivered but missing",
    full_name: "John Doe",
    email: "john@example.com",
    phone: "+1 555 0123",
    contact_method: "Email",
    telegram_username: "",
    refund_details: "PayPal: john@example.com",
  };

  if (format === "json") {
    const json = JSON.stringify([sampleRow], null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "import_template.json"; a.click();
    URL.revokeObjectURL(url);
  } else {
    const headers = QUESTION_IDS.join(",");
    const sample = QUESTION_IDS.map(k => `"${sampleRow[k] || ""}"`).join(",");
    const csv = `${headers}\n${sample}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "import_template.csv"; a.click();
    URL.revokeObjectURL(url);
  }
}

function ImportDialog({
  open, onClose, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        if (file.name.toLowerCase().endsWith(".json")) {
          const parsed = JSON.parse(text);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          const mapped = arr.map((item: Record<string, unknown>) => mapRow(flattenJSON(item)));
          setRows(mapped);
        } else {
          const parsed = parseCSV(text);
          setRows(parsed.map(mapRow));
        }
      } catch {
        toast({ title: "Parse error", description: "Could not read file. Check format.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!rows.length) return;
    setImporting(true);
    try {
      const res = await apiRequest("POST", "/api/data/import", { rows });
      const data = await res.json();
      onSuccess(data.count);
      onClose();
    } catch {
      toast({ title: "Import failed", description: "Server error during import.", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const previewRows = rows.slice(0, 5);
  const allKeys = previewRows.length > 0 ? Array.from(new Set(previewRows.flatMap(r => Object.keys(r)))).slice(0, 8) : [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-600" />
            Import Old Responses
          </DialogTitle>
          <DialogDescription>
            Upload a <b>.csv</b> or <b>.json</b> file (array of objects). Column names are automatically mapped — old field names like <code>order_number</code>, <code>merchant_name</code>, <code>telegram</code> etc. all import correctly.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-1">
          {rows.length === 0 ? (
            <div
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${dragOver ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20" : "border-border hover:border-blue-400 hover:bg-muted/30"}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="import-drop-zone"
            >
              <FileUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium text-foreground text-sm">Drop a file here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">Supports .csv and .json — up to 500 rows</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                className="hidden"
                data-testid="input-import-file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium">{fileName}</span>
                  <Badge variant="secondary" className="text-xs">{rows.length} row{rows.length !== 1 ? "s" : ""}</Badge>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { setRows([]); setFileName(""); }}>
                  <X className="w-3.5 h-3.5 mr-1" /> Clear
                </Button>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        {allKeys.map(k => (
                          <th key={k} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-border">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          {allKeys.map(k => (
                            <td key={k} className="px-3 py-1.5 text-foreground max-w-32 truncate">
                              {row[k] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 5 && (
                  <div className="px-3 py-1.5 bg-muted/30 text-xs text-muted-foreground border-t border-border">
                    + {rows.length - 5} more rows not shown
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-blue-500" />
                All {rows.length} rows will be encrypted with your dashboard password before storage.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => downloadTemplate("csv")} data-testid="btn-download-template">
              <Download className="w-3.5 h-3.5" />
              Download CSV Template
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => downloadTemplate("json")} data-testid="btn-download-json-template">
              <FileText className="w-3.5 h-3.5" />
              Download JSON Template
            </Button>
          </div>
        </div>

        <DialogFooter className="pt-2 gap-2">
          <Button variant="outline" onClick={onClose} disabled={importing} data-testid="btn-import-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={rows.length === 0 || importing}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
            data-testid="btn-import-confirm"
          >
            {importing ? (
              <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Importing...</>
            ) : (
              <><Upload className="w-3.5 h-3.5" /> Import {rows.length > 0 ? `${rows.length} Responses` : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="outline" size="sm" onClick={handleCopy} data-testid="btn-copy-response" className="gap-1.5 h-8 text-xs">
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}

function ResponseCard({
  response, questions, onDelete, password, onNoteUpdate, onFieldUpdate,
}: {
  response: DecryptedResponse;
  questions: FormQuestion[];
  onDelete: (id: string) => void;
  password: string;
  onNoteUpdate: (id: string, note: string) => void;
  onFieldUpdate: (id: string, answers: Record<string, string>) => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(response.note || "");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // All fields to display: form questions first, then any extra keys from imported data
  const allFields = useMemo(() => {
    const questionKeys = new Set(questions.map((q) => q.questionId));
    const formFields = questions
      .filter((q) => response.answers[q.questionId])
      .map((q) => ({ key: q.questionId, label: q.questionText }));
    const extraFields = Object.keys(response.answers)
      .filter((k) => !questionKeys.has(k) && response.answers[k] && !isSectionKey(k))
      .map((k) => ({
        key: k,
        label: DISPLAY_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      }));
    return [...formFields, ...extraFields];
  }, [questions, response.answers]);

  const saveNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      const attempt = async () => {
        if (!note.trim()) {
          await apiRequest("DELETE", `/api/data/responses/${response.id}/note`);
          return { note: "" };
        }
        const encryptedNote = await encryptData(note, password);
        await apiRequest("PUT", `/api/data/responses/${response.id}/note`, { encryptedNote });
        return { note };
      };
      try {
        return await attempt();
      } catch {
        await new Promise((r) => setTimeout(r, 600));
        return await attempt();
      }
    },
    onSuccess: (data) => {
      // Update the decrypted list in-place — no re-decryption needed.
      onNoteUpdate(response.id, data.note);
      // Mark cache stale so next window-focus/navigation refetches, but don't fetch now.
      queryClient.invalidateQueries({ queryKey: ["/api/data/responses"], refetchType: "none" });
      toast({ title: "Note saved", description: "Your note has been encrypted and saved." });
    },
    onError: () => {
      toast({ title: "Failed to save note", variant: "destructive" });
    },
  });

  const editFieldMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: string }) => {
      const updatedAnswers = { ...response.answers, [field]: value };
      const encryptedData = await encryptData(JSON.stringify(updatedAnswers), password);
      const fieldLabel = questions.find((q) => q.questionId === field)?.questionText || field;
      await apiRequest("PUT", `/api/data/responses/${response.id}`, {
        encryptedData,
        fieldLabel,
        fieldValue: value,
      });
    },
    onSuccess: (_, { field, value }) => {
      // Update the decrypted list in-place — no re-decryption needed.
      onFieldUpdate(response.id, { ...response.answers, [field]: value });
      // Mark cache stale so next window-focus/navigation refetches, but don't fetch now.
      queryClient.invalidateQueries({ queryKey: ["/api/data/responses"], refetchType: "none" });
      setEditingField(null);
      toast({ title: "Field updated", description: "Saved and re-encrypted." });
    },
    onError: () => {
      toast({ title: "Failed to update field", variant: "destructive" });
    },
  });

  const buildCopyText = () => {
    const lines: string[] = [`Order Submission — ${formatDate(response.createdAt)}`, `ID: ${response.id}`, ""];
    for (const { key, label } of allFields) {
      const val = response.answers[key];
      if (val) lines.push(`${label}: ${val}`);
    }
    if (response.note) { lines.push(""); lines.push(`Notes: ${response.note}`); }
    return lines.join("\n");
  };

  const previewSummaryFields = useMemo(() => {
    const skip = new Set(["agreement"]);
    const textareaKeys = new Set(questions.filter((q) => q.questionType === "textarea").map((q) => q.questionId));
    const orderedFields = QUESTION_IDS
      .filter((qid) => !skip.has(qid) && response.answers[qid] && !textareaKeys.has(qid))
      .map((qid) => {
        const q = questions.find((q) => q.questionId === qid);
        return { key: qid, label: q?.questionText || DISPLAY_LABELS[qid] || qid.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) };
      });
    if (orderedFields.length >= 4) return orderedFields.slice(0, 4);
    const usedKeys = new Set(orderedFields.map((f) => f.key));
    const extras = allFields
      .filter((f) => !usedKeys.has(f.key) && !skip.has(f.key) && response.answers[f.key] && !textareaKeys.has(f.key));
    return [...orderedFields, ...extras].slice(0, 4);
  }, [allFields, questions, response.answers]);

  const descField = useMemo(() => {
    return allFields.find((f) => {
      const q = questions.find((q) => q.questionId === f.key);
      return q && q.questionType === "textarea" && response.answers[f.key];
    })?.key || null;
  }, [allFields, questions, response.answers]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded-2xl overflow-hidden transition-all duration-200 ${
        expanded
          ? "bg-card shadow-lg border-blue-200/60 dark:border-blue-800/40"
          : "bg-card shadow-sm hover:shadow-md border-border hover:border-border/80"
      }`}
      data-testid={`card-response-${response.id}`}
    >
      <div className="p-3 sm:p-5">
        <div className="flex items-start gap-2 sm:gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <code className="font-mono text-[11px] bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-md border border-blue-100 dark:border-blue-900/40" data-testid={`text-response-id-${response.id}`}>
                #{response.id.slice(0, 8).toUpperCase()}
              </code>
              <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid={`text-date-${response.id}`}>
                <Clock className="w-3 h-3" />{formatDate(response.createdAt)}
              </span>
              {response.note && <Badge variant="outline" className="text-xs h-5 px-1.5 gap-1 border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400"><StickyNote className="w-2.5 h-2.5" /> Note</Badge>}
              {response.decryptError && <Badge className="text-xs h-5 px-1.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Decrypt Error</Badge>}
            </div>

            {!expanded && previewSummaryFields.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-2 sm:gap-y-2.5 mt-2.5 sm:mt-3">
                {previewSummaryFields.map(({ key, label }) => (
                  <div key={key} className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-0.5 truncate">{label}</p>
                    <p className="text-sm font-semibold text-foreground truncate">{formatFieldValue(response.answers[key])}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Row 3: Description preview (collapsed only) */}
            {!expanded && descField && response.answers[descField] && (
              <p className="text-xs text-muted-foreground/70 mt-2.5 line-clamp-1 italic border-l-2 border-border pl-2">
                {response.answers[descField]}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 pt-0.5">
            <CopyButton text={buildCopyText()} />
            <Button
              variant="ghost" size="sm"
              onClick={() => setNoteOpen((o) => !o)}
              data-testid={`btn-note-${response.id}`}
              className={`h-8 w-8 p-0 ${noteOpen ? "bg-amber-50 text-amber-600 dark:bg-amber-950/30" : ""}`}
              title="Add note"
            >
              <PenLine className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost" size="sm"
              onClick={() => setExpanded((e) => !e)}
              data-testid={`btn-expand-${response.id}`}
              className="h-8 w-8 p-0"
              title={expanded ? "Collapse" : "Expand all fields"}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive" size="sm"
                  onClick={() => { setConfirmDelete(false); onDelete(response.id); }}
                  data-testid={`btn-delete-confirm-${response.id}`}
                  className="h-7 px-2 text-xs"
                >
                  <Check className="w-3 h-3 mr-1" />Delete
                </Button>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setConfirmDelete(false)}
                  data-testid={`btn-delete-cancel-${response.id}`}
                  className="h-7 w-7 p-0 text-muted-foreground"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost" size="sm"
                onClick={() => setConfirmDelete(true)}
                data-testid={`btn-delete-${response.id}`}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {noteOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 p-3 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-900/30 rounded-lg">
                <div className="flex items-center gap-1.5 mb-2">
                  <StickyNote className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Private Note</span>
                  <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Encrypted
                  </span>
                </div>
                <Textarea
                  data-testid={`textarea-note-${response.id}`}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add your private notes about this response..."
                  className="text-sm min-h-[80px] resize-none bg-white dark:bg-slate-900 border-amber-200/60"
                  rows={3}
                />
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="outline" size="sm" onClick={() => setNoteOpen(false)} className="h-7 text-xs">Cancel</Button>
                  <Button
                    size="sm"
                    onClick={() => saveNoteMutation.mutate(noteText)}
                    disabled={saveNoteMutation.isPending}
                    data-testid={`btn-save-note-${response.id}`}
                    className="h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white"
                  >
                    {saveNoteMutation.isPending ? "Saving..." : "Save Note"}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-blue-100 dark:border-blue-900/30"
          >
            <div className="p-4 sm:p-5 bg-gradient-to-b from-blue-50/40 via-slate-50/20 to-transparent dark:from-blue-950/15 dark:via-slate-900/10 dark:to-transparent">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border/60 rounded-xl overflow-hidden border border-border/50">
                {allFields.map(({ key, label }) => {
                  const rawVal = response.answers[key];
                  const displayVal = formatFieldValue(rawVal || "");
                  const isEditing = editingField === key;
                  return (
                    <div key={key} className="group bg-card/80 backdrop-blur-sm p-3 sm:p-3.5 relative hover:bg-card transition-colors" data-testid={`field-${key}-${response.id}`}>
                      <p className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-1 sm:mb-1.5 flex items-center gap-1.5">
                        {label}
                        {!isEditing && (
                          <button
                            onClick={() => { setEditingField(key); setEditingValue(rawVal || ""); }}
                            className="sm:opacity-0 sm:group-hover:opacity-100 text-muted-foreground hover:text-blue-600 transition-opacity"
                            data-testid={`btn-edit-field-${key}-${response.id}`}
                            title="Edit"
                          >
                            <PenLine className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </p>
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <Textarea
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            className="text-xs min-h-[52px] resize-none"
                            rows={2}
                            autoFocus
                            data-testid={`textarea-edit-field-${key}-${response.id}`}
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => editFieldMutation.mutate({ field: key, value: editingValue })} disabled={editFieldMutation.isPending} className="h-6 text-xs px-2" data-testid={`btn-save-field-${key}-${response.id}`}>
                              {editFieldMutation.isPending ? "…" : "Save"}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setEditingField(null)} className="h-6 text-xs px-2" data-testid={`btn-cancel-field-${key}-${response.id}`}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[13px] sm:text-sm text-foreground leading-snug break-words">
                          {displayVal || <span className="text-muted-foreground/50 italic text-xs">—</span>}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {response.note && (
                <div className="mt-3 p-3 bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 rounded-xl">
                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <StickyNote className="w-3 h-3" /> Note
                  </p>
                  <p className="text-sm text-amber-900 dark:text-amber-200 whitespace-pre-wrap">{response.note}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function DashboardPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  // Primary key and optional legacy key — both set during login
  const [password] = useState(() => sessionStorage.getItem("dk") || "");
  const [legacyPassword] = useState(() => sessionStorage.getItem("dk_legacy") || "");
  const [searchQuery, setSearchQuery] = useState("");
  const [decryptedResponses, setDecryptedResponses] = useState<DecryptedResponse[]>([]);
  const [decrypting, setDecrypting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dash-theme") === "dark" ||
      (!localStorage.getItem("dash-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("dash-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("dash-theme", "light");
    }
  }, [dark]);

  const { data: rawData, isLoading, refetch } = useQuery<{ responses: RawResponse[] }>({
    queryKey: ["/api/data/responses"],
  });

  const { data: questionsData } = useQuery<{ questions: FormQuestion[] }>({
    queryKey: ["/api/data/questions"],
  });

  const questions = questionsData?.questions || [];

  const decryptAll = useCallback(async (pwd: string, raw: RawResponse[], legacyPwd?: string) => {
    setDecrypting(true);
    const results: DecryptedResponse[] = [];
    for (const r of raw) {
      let decrypted: string | null = null;
      // Try primary key first, then legacy key for older encrypted responses
      for (const key of [pwd, legacyPwd].filter(Boolean) as string[]) {
        try {
          decrypted = await decryptData(r.encryptedData, key);
          break;
        } catch { /* try next key */ }
      }
      if (decrypted !== null) {
        try {
          const parsed = JSON.parse(decrypted);
          let note = "";
          if (r.encryptedNote) {
            for (const key of [pwd, legacyPwd].filter(Boolean) as string[]) {
              try { note = await decryptData(r.encryptedNote, key); break; } catch {}
            }
          }
          const rawAnswers = parsed.answers || {};
          const normalizedAnswers: Record<string, string> = {};
          for (const [ak, av] of Object.entries(rawAnswers)) {
            if (typeof av !== "string") continue;
            const cleaned = ak.replace(/^section[\s_-]*\d+[.\s_-]+/i, "");
            if (isSectionKey(cleaned)) continue;
            const lk = cleaned.toLowerCase().trim().replace(/\s+/g, "_");
            const mapped = OLD_FIELD_MAP[lk] || lk;
            if (mapped in normalizedAnswers) {
              const existing = normalizedAnswers[mapped].split(" | ").map((s: string) => s.trim());
              if (!existing.includes((av as string).trim())) {
                normalizedAnswers[mapped] = normalizedAnswers[mapped] + " | " + av;
              }
            } else {
              normalizedAnswers[mapped] = av as string;
            }
          }
          let displayDate = r.createdAt;
          const orderDateVal = normalizedAnswers["order_date"];
          if (orderDateVal) {
            const pd = new Date(orderDateVal);
            if (!isNaN(pd.getTime()) && pd.getTime() > 0) {
              displayDate = pd.toISOString();
            }
          }
          results.push({
            id: r.id,
            createdAt: displayDate,
            telegramNotified: r.telegramNotified,
            answers: normalizedAnswers,
            submittedAt: parsed.submittedAt,
            note,
            encryptedNote: r.encryptedNote,
          });
        } catch {
          results.push({ id: r.id, createdAt: r.createdAt, telegramNotified: r.telegramNotified, answers: {}, note: "", encryptedNote: r.encryptedNote, decryptError: true });
        }
      } else {
        results.push({
          id: r.id,
          createdAt: r.createdAt,
          telegramNotified: r.telegramNotified,
          answers: {},
          note: "",
          encryptedNote: r.encryptedNote,
          decryptError: true,
        });
      }
    }
    setDecryptedResponses(results);
    setDecrypting(false);
  }, []);

  const handleRefresh = async () => {
    const result = await refetch();
    if (result.data && password) {
      await decryptAll(password, result.data.responses, legacyPassword || undefined);
    }
  };

  useEffect(() => {
    if (rawData?.responses && password) {
      decryptAll(password, rawData.responses, legacyPassword || undefined);
    }
  }, [rawData, password, legacyPassword, decryptAll]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/data/responses/${id}`);
    },
    onMutate: (id: string) => {
      // Optimistically remove the card immediately so the UI feels instant
      setDecryptedResponses((prev) => prev.filter((r) => r.id !== id));
    },
    onSuccess: () => {
      // Mark cache stale without refetching — rawData doesn't change so
      // useEffect never fires, decryptAll never runs, no list flash.
      queryClient.invalidateQueries({ queryKey: ["/api/data/responses"], refetchType: "none" });
      toast({ title: "Response deleted" });
    },
    onError: () => {
      // On failure restore the list by re-fetching (full re-decryption is acceptable here)
      queryClient.invalidateQueries({ queryKey: ["/api/data/responses"] });
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/data/responses");
    },
    onSuccess: () => {
      setDecryptedResponses([]);
      setConfirmDeleteAll(false);
      queryClient.invalidateQueries({ queryKey: ["/api/data/responses"] });
      toast({ title: "All responses deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete all responses", variant: "destructive" });
    },
  });

  // Surgically patch decryptedResponses after a note save — no re-decryption cycle.
  const handleNoteUpdate = useCallback((id: string, note: string) => {
    setDecryptedResponses((prev) => prev.map((r) => r.id === id ? { ...r, note } : r));
  }, []);

  // Surgically patch decryptedResponses after a field edit — no re-decryption cycle.
  const handleFieldUpdate = useCallback((id: string, answers: Record<string, string>) => {
    setDecryptedResponses((prev) => prev.map((r) => r.id === id ? { ...r, answers } : r));
  }, []);

  const handleLogout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    sessionStorage.removeItem("dk");
    sessionStorage.removeItem("dk_legacy");
    queryClient.clear();
    navigate("/login");
  };

  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return decryptedResponses.filter((r) => new Date(r.createdAt).toDateString() === today).length;
  }, [decryptedResponses]);

  const totalOrderValueUSD = useMemo(() => {
    // Approximate exchange rates to USD
    const toUSD: Record<string, number> = {
      USD: 1, GBP: 1.27, EUR: 1.09, JPY: 0.0067, CAD: 0.74,
      AUD: 0.65, NZD: 0.60, CHF: 1.13, SEK: 0.096, NOK: 0.094,
      DKK: 0.146, HKD: 0.128, SGD: 0.75, MXN: 0.058, BRL: 0.20,
      INR: 0.012, CNY: 0.14, KRW: 0.00073, TRY: 0.031, ZAR: 0.055,
    };
    const symbolMap: Record<string, string> = {
      "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY",
      "C$": "CAD", "CA$": "CAD", "A$": "AUD", "AU$": "AUD",
      "NZ$": "NZD", "CHF": "CHF", "Fr": "CHF",
      "HK$": "HKD", "S$": "SGD",
      "R$": "BRL", "₹": "INR", "₩": "KRW", "₺": "TRY", "R": "ZAR",
      "MXN": "MXN", "SEK": "SEK", "NOK": "NOK", "DKK": "DKK",
    };
    let total = 0;
    for (const r of decryptedResponses) {
      const raw = (r.answers["order_value"] || "").trim();
      if (!raw) continue;
      // Try to detect currency
      let currency = "USD";
      let numStr = raw;
      // Check multi-char symbols first
      for (const sym of ["CA$", "AU$", "NZ$", "HK$", "S$", "A$", "C$", "R$", "CHF", "Fr", "MXN", "SEK", "NOK", "DKK"]) {
        if (raw.startsWith(sym) || raw.endsWith(sym)) {
          currency = symbolMap[sym] || "USD";
          numStr = raw.replace(sym, "").trim();
          break;
        }
      }
      // Check single-char symbols
      if (numStr === raw) {
        for (const sym of ["£", "€", "¥", "₹", "₩", "₺", "R", "$"]) {
          if (raw.startsWith(sym)) {
            currency = symbolMap[sym] || "USD";
            numStr = raw.slice(sym.length).trim();
            break;
          }
        }
      }
      // Check 3-letter ISO code prefix/suffix
      const isoMatch = raw.match(/^([A-Z]{3})\s*([\d,.]+)$/) || raw.match(/^([\d,.]+)\s*([A-Z]{3})$/);
      if (isoMatch) {
        const code = isoMatch[1].length === 3 && /[A-Z]{3}/.test(isoMatch[1]) ? isoMatch[1] : isoMatch[2];
        if (toUSD[code]) { currency = code; numStr = isoMatch[1].length === 3 ? isoMatch[2] : isoMatch[1]; }
      }
      // Parse number: remove commas, spaces
      const cleaned = numStr.replace(/[, ]/g, "");
      const value = parseFloat(cleaned);
      if (!isNaN(value)) {
        total += value * (toUSD[currency] || 1);
      }
    }
    return total;
  }, [decryptedResponses]);

  const filteredResponses = useMemo(() => {
    if (!searchQuery.trim()) return decryptedResponses;
    const q = searchQuery.toLowerCase();
    return decryptedResponses.filter((r) => {
      const allText = [
        ...Object.values(r.answers),
        r.note,
        r.id,
        formatDate(r.createdAt),
      ].join(" ").toLowerCase();
      return allText.includes(q);
    });
  }, [decryptedResponses, searchQuery]);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card/95 backdrop-blur-sm border-b border-border sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2 sm:py-0 sm:h-14 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
              <Shield className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </div>
            <span className="font-bold text-foreground text-sm">Order Dashboard</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading || decrypting} className="gap-1 sm:gap-1.5 h-7 sm:h-8 text-[11px] sm:text-xs px-2 sm:px-3" data-testid="btn-refresh">
              <RefreshCw className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${decrypting ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-1 sm:gap-1.5 h-7 sm:h-8 text-[11px] sm:text-xs px-2 sm:px-3" data-testid="btn-import">
              <Upload className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Import</span>
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => { window.location.href = "/api/data/db-export"; }}
              className="gap-1 sm:gap-1.5 h-7 sm:h-8 text-[11px] sm:text-xs px-2 sm:px-3"
              data-testid="btn-db-export"
              title="Download full backup (questions + responses) as JSON"
            >
              <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Backup</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 sm:gap-1.5 h-7 sm:h-8 text-[11px] sm:text-xs text-muted-foreground px-2 sm:px-3" data-testid="btn-home">
              <Home className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Home</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/form-editor")} className="gap-1 sm:gap-1.5 h-7 sm:h-8 text-[11px] sm:text-xs px-2 sm:px-3" data-testid="btn-form-editor">
              <Settings className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Editor</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/retail")} className="gap-1 sm:gap-1.5 h-7 sm:h-8 text-[11px] sm:text-xs px-2 sm:px-3" data-testid="btn-retail">
              <ShoppingBag className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Retail</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/form")} className="gap-1 sm:gap-1.5 h-7 sm:h-8 text-[11px] sm:text-xs px-2 sm:px-3" data-testid="btn-view-form">
              <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Form</span>
            </Button>
            <Button
              variant="ghost" size="icon"
              onClick={() => setDark((d) => !d)}
              className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground"
              data-testid="btn-dark-mode"
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1 sm:gap-1.5 h-7 sm:h-8 text-[11px] sm:text-xs text-muted-foreground px-2 sm:px-3" data-testid="btn-logout">
              <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">

        {!isLoading && !decrypting && decryptedResponses.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 border border-border rounded-2xl p-3 sm:p-4">
              <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full bg-foreground/5" />
              <p className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">{decryptedResponses.length}</p>
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground mt-0.5 uppercase tracking-wider">Total</p>
            </div>
            <div className="relative overflow-hidden bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-800 border border-blue-100 dark:border-blue-900/30 rounded-2xl p-3 sm:p-4">
              <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full bg-blue-500/8" />
              <p className="text-2xl sm:text-3xl font-extrabold text-blue-600 dark:text-blue-400 tracking-tight">{todayCount}</p>
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground mt-0.5 uppercase tracking-wider">Today</p>
            </div>
            <div className="relative overflow-hidden bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-800 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl p-3 sm:p-4">
              <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full bg-emerald-500/8" />
              <p className="text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 tracking-tight" data-testid="text-order-total">
                {totalOrderValueUSD >= 1000
                  ? `$${(totalOrderValueUSD / 1000).toFixed(1)}k`
                  : `$${totalOrderValueUSD.toFixed(2)}`}
              </p>
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground mt-0.5 uppercase tracking-wider">Order Total</p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-foreground">Responses</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {searchQuery
                ? `${filteredResponses.length} of ${decryptedResponses.length} shown`
                : `${decryptedResponses.length} submission${decryptedResponses.length !== 1 ? "s" : ""} · end-to-end encrypted`}
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72 sm:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                data-testid="input-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search responses..."
                className="pl-9 pr-9 h-9 text-sm"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {decryptedResponses.length > 0 && (
              confirmDeleteAll ? (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="destructive" size="sm"
                    onClick={() => deleteAllMutation.mutate()}
                    disabled={deleteAllMutation.isPending}
                    data-testid="btn-delete-all-confirm"
                    className="h-9 px-3 text-xs gap-1"
                  >
                    {deleteAllMutation.isPending ? (
                      <><RefreshCw className="w-3 h-3 animate-spin" /> Deleting...</>
                    ) : (
                      <><Trash2 className="w-3 h-3" /> Confirm</>
                    )}
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setConfirmDeleteAll(false)}
                    disabled={deleteAllMutation.isPending}
                    data-testid="btn-delete-all-cancel"
                    className="h-9 w-9 p-0 text-muted-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline" size="sm"
                  onClick={() => setConfirmDeleteAll(true)}
                  data-testid="btn-delete-all"
                  className="h-9 text-xs gap-1.5 text-red-500 hover:text-red-600 border-red-200 hover:border-red-300 hover:bg-red-50 dark:border-red-900 dark:hover:border-red-800 dark:hover:bg-red-950/30 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Delete All</span>
                </Button>
              )
            )}
          </div>
        </div>

        {(isLoading || decrypting) ? (
              <div className="flex flex-col items-center py-16 gap-3">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">{decrypting ? "Decrypting responses..." : "Loading..."}</p>
              </div>
            ) : filteredResponses.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3 text-center">
                {searchQuery ? (
                  <>
                    <Search className="w-10 h-10 text-muted-foreground/40" />
                    <div>
                      <p className="font-medium text-foreground">No results for "{searchQuery}"</p>
                      <p className="text-sm text-muted-foreground mt-1">Try a different search term</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Inbox className="w-10 h-10 text-muted-foreground/40" />
                    <div>
                      <p className="font-medium text-foreground">No submissions yet</p>
                      <p className="text-sm text-muted-foreground mt-1">Responses will appear here once forms are submitted</p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {searchQuery && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Search className="w-3.5 h-3.5" />
                    {filteredResponses.length} result{filteredResponses.length !== 1 ? "s" : ""} for "{searchQuery}"
                  </p>
                )}
                <AnimatePresence>
                  {filteredResponses.map((r) => (
                    <ResponseCard
                      key={r.id}
                      response={r}
                      questions={questions}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      password={password}
                      onNoteUpdate={handleNoteUpdate}
                      onFieldUpdate={handleFieldUpdate}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={(count) => {
          toast({ title: `Imported ${count} response${count !== 1 ? "s" : ""}`, description: "Responses encrypted and saved." });
          queryClient.invalidateQueries({ queryKey: ["/api/data/responses"] });
        }}
      />
    </div>
  );
}
