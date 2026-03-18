import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Trash2, GripVertical, ChevronLeft, ChevronDown, ChevronUp,
  Save, X, Settings, Shield, AlertTriangle, ExternalLink, Home, PenLine, RefreshCw, ShoppingBag, FileCheck, Send,
  Download, Upload
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { FormQuestion } from "@workspace/db";

type QuestionType = "text" | "textarea" | "radio" | "select" | "date" | "number" | "email" | "phone" | "address" | "url";

interface EditableQuestion {
  id?: string;
  pageNumber: number;
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  options: string[];
  required: boolean;
  sortOrder: number;
  placeholder: string;
  description: string;
  _key: string;
  isNew?: boolean;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  text: "Short Text",
  textarea: "Long Text",
  radio: "Multiple Choice",
  select: "Dropdown",
  date: "Date",
  number: "Number",
  email: "Email",
  phone: "Phone Number",
  address: "Address",
  url: "Website URL",
};

function QuestionEditor({ q, onChange, onDelete, isNew = false }: {
  q: EditableQuestion;
  onChange: (updated: EditableQuestion) => void;
  onDelete: () => void;
  isNew?: boolean;
}) {
  const [open, setOpen] = useState(isNew);
  const [newOption, setNewOption] = useState("");
  const hasOptions = q.questionType === "radio" || q.questionType === "select";

  const addOption = () => {
    if (!newOption.trim()) return;
    onChange({ ...q, options: [...q.options, newOption.trim()] });
    setNewOption("");
  };

  const removeOption = (i: number) => {
    onChange({ ...q, options: q.options.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
        data-testid={`question-header-${q._key}`}
      >
        <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0" onClick={(e) => e.stopPropagation()} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{q.questionText || "(untitled)"}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-xs text-muted-foreground font-mono">{q.questionId}</span>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <Badge variant="outline" className="text-xs h-4 px-1.5">Page {q.pageNumber}</Badge>
            <Badge variant="secondary" className="text-xs h-4 px-1.5">{TYPE_LABELS[q.questionType]}</Badge>
            {q.required && <Badge className="text-xs h-4 px-1.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Required</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
            data-testid={`btn-edit-question-${q._key}`}
          >
            <PenLine className="w-3.5 h-3.5" />
            {open ? "Done" : "Edit"}
          </button>
          <button onClick={onDelete} className="text-muted-foreground hover:text-red-500 transition-colors p-1">
            <Trash2 className="w-4 h-4" />
          </button>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {open && (
        <div className="border-t border-border p-4 space-y-3 bg-muted/10">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Question Text *</Label>
              <Input
                value={q.questionText}
                onChange={(e) => onChange({ ...q, questionText: e.target.value })}
                placeholder="Enter your question..."
                className="h-9 text-sm"
                data-testid={`input-q-text-${q._key}`}
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Page Number</Label>
              <Input
                type="number" min={1} max={10}
                value={q.pageNumber}
                onChange={(e) => onChange({ ...q, pageNumber: parseInt(e.target.value) || 1 })}
                className="h-9 text-sm"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Question Type</Label>
              <Select value={q.questionType} onValueChange={(v) => onChange({ ...q, questionType: v as QuestionType })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Question ID *</Label>
              <Input
                value={q.questionId}
                onChange={(e) => onChange({ ...q, questionId: e.target.value.replace(/\s+/g, "_").toLowerCase() })}
                placeholder="unique_id"
                className="h-9 text-sm font-mono"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Placeholder</Label>
              <Input
                value={q.placeholder}
                onChange={(e) => onChange({ ...q, placeholder: e.target.value })}
                placeholder="Input hint..."
                className="h-9 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Description / Instructions</Label>
              <Textarea
                value={q.description}
                onChange={(e) => onChange({ ...q, description: e.target.value })}
                placeholder="Optional context shown above the question"
                className="text-sm min-h-[60px] resize-none"
                rows={2}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={q.required}
                onCheckedChange={(v) => onChange({ ...q, required: v })}
                id={`req-${q._key}`}
              />
              <Label htmlFor={`req-${q._key}`} className="text-xs text-muted-foreground">Required field</Label>
            </div>
          </div>

          {hasOptions && (
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">Options</Label>
              <div className="space-y-1.5">
                {q.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-1.5 bg-muted rounded-md text-sm">{opt}</div>
                    <button onClick={() => removeOption(i)} className="text-muted-foreground hover:text-red-500 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 mt-2">
                  <Input
                    value={newOption}
                    onChange={(e) => setNewOption(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addOption())}
                    placeholder="Add option..."
                    className="h-8 text-sm"
                    data-testid={`input-add-option-${q._key}`}
                  />
                  <Button variant="outline" size="sm" onClick={addOption} className="h-8 text-xs">Add</Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toEditable(q: FormQuestion): EditableQuestion {
  return {
    id: q.id,
    pageNumber: q.pageNumber,
    questionId: q.questionId,
    questionText: q.questionText,
    questionType: q.questionType as QuestionType,
    options: (q.options as string[]) || [],
    required: q.required ?? true,
    sortOrder: q.sortOrder,
    placeholder: q.placeholder || "",
    description: q.description || "",
    _key: q.id || Math.random().toString(36).slice(2),
  };
}

export default function FormEditorPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [editableQuestions, setEditableQuestions] = useState<EditableQuestion[]>([]);
  const [endPageText, setEndPageText] = useState("");
  const [testingNotif, setTestingNotif] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<{ questions: FormQuestion[] }>({
    queryKey: ["/api/data/questions"],
    staleTime: 0,
    retry: 1,
  });

  const { data: settingsData } = useQuery<{ end_page_text: string }>({
    queryKey: ["/api/form/settings"],
  });

  useEffect(() => {
    if (settingsData?.end_page_text !== undefined) {
      setEndPageText(settingsData.end_page_text);
    }
  }, [settingsData]);

  useEffect(() => {
    if (data?.questions) {
      setEditableQuestions(data.questions.map(toEditable));
    }
  }, [data]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (text: string) => {
      await apiRequest("PUT", "/api/data/form-settings", { end_page_text: text });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/form/settings"] });
      toast({ title: "End page saved", description: "Confirmation text updated." });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const testNotification = async () => {
    setTestingNotif(true);
    try {
      await apiRequest("POST", "/api/data/test-notification", {});
      toast({ title: "✅ Test sent!", description: "Check your Telegram — message delivered." });
    } catch (e: any) {
      let detail = "Unknown error";
      try {
        const msg: string = e?.message || "";
        const jsonPart = msg.slice(msg.indexOf("{"));
        detail = JSON.parse(jsonPart).message || msg;
      } catch { detail = e?.message || "Unknown error"; }
      const isChatNotFound = detail.toLowerCase().includes("chat not found");
      toast({
        title: "Notification failed",
        description: isChatNotFound
          ? "TELEGRAM_CHAT_ID is wrong — chat not found. Your bot must be added to the target chat first. Use the Diagnose button to find the correct ID."
          : detail,
        variant: "destructive",
        duration: 8000,
      });
    } finally {
      setTestingNotif(false);
    }
  };

  const [diagResult, setDiagResult] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const runDiagnose = async () => {
    setDiagLoading(true);
    setDiagResult(null);
    try {
      const res = await apiRequest("GET", "/api/data/telegram-diagnose");
      const data = await res.json();
      setDiagResult(data);
    } catch (e: any) {
      setDiagResult({ ok: false, error: e?.message || "Failed to diagnose" });
    } finally {
      setDiagLoading(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (questions: EditableQuestion[]) => {
      const payload = questions.map((q, i) => ({
        pageNumber: q.pageNumber,
        questionId: q.questionId,
        questionText: q.questionText,
        questionType: q.questionType,
        options: q.options.length > 0 ? q.options : null,
        required: q.required,
        sortOrder: i + 1,
        placeholder: q.placeholder || null,
        description: q.description || null,
      }));
      await apiRequest("PUT", "/api/data/questions", { questions: payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/data/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/form/config"] });
      toast({ title: "Form updated", description: "Questions saved successfully." });
    },
    onError: () => {
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });

  const addQuestion = () => {
    const maxPage = editableQuestions.reduce((m, q) => Math.max(m, q.pageNumber), 1);
    setEditableQuestions((qs) => [
      ...qs,
      {
        pageNumber: maxPage,
        questionId: `question_${Date.now()}`,
        questionText: "New Question",
        questionType: "text",
        options: [],
        required: true,
        sortOrder: qs.length + 1,
        placeholder: "",
        description: "",
        _key: Math.random().toString(36).slice(2),
        isNew: true,
      },
    ]);
  };

  const updateQuestion = (key: string, updated: EditableQuestion) => {
    setEditableQuestions((qs) => qs.map((q) => q._key === key ? updated : q));
  };

  const deleteQuestion = (key: string) => {
    setEditableQuestions((qs) => qs.filter((q) => q._key !== key));
  };

  const pageGroups = editableQuestions.reduce((acc, q) => {
    if (!acc[q.pageNumber]) acc[q.pageNumber] = [];
    acc[q.pageNumber].push(q);
    return acc;
  }, {} as Record<number, EditableQuestion[]>);

  const exportQuestions = () => {
    const exportData = editableQuestions.map(({ _key, isNew, ...q }) => q);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `form-questions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Questions exported", description: "JSON file downloaded." });
  };

  const importQuestions = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed: EditableQuestion[] = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(parsed)) throw new Error("Expected array");
        const withKeys = parsed.map((q) => ({ ...q, _key: Math.random().toString(36).slice(2) }));
        setEditableQuestions(withKeys);
        toast({ title: "Questions imported", description: `Loaded ${withKeys.length} questions. Click "Save Changes" to apply.` });
      } catch {
        toast({ title: "Import failed", description: "Invalid JSON format.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1.5 h-8 text-xs text-muted-foreground" data-testid="btn-home">
              <Home className="w-3.5 h-3.5" />
              Home
            </Button>
            <div className="w-px h-4 bg-border" />
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-1.5 h-8 text-xs">
              <ChevronLeft className="w-3.5 h-3.5" />
              Dashboard
            </Button>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-sm text-foreground">Form Editor</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/retail")} className="gap-1.5 h-8 text-xs" data-testid="btn-retail">
              <ShoppingBag className="w-3.5 h-3.5" />
              Retail
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/form")} className="gap-1.5 h-8 text-xs" data-testid="btn-view-form">
              <ExternalLink className="w-3.5 h-3.5" />
              View Form
            </Button>
            <div className="w-px h-4 bg-border" />
            <Button variant="outline" size="sm" onClick={exportQuestions} className="gap-1.5 h-8 text-xs" data-testid="btn-export-questions" title="Download questions as JSON">
              <Download className="w-3.5 h-3.5" />
              Export
            </Button>
            <label title="Import questions from JSON backup">
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs pointer-events-none" asChild data-testid="btn-import-questions">
                <span><Upload className="w-3.5 h-3.5" />Import</span>
              </Button>
              <input type="file" accept=".json,application/json" className="hidden" onChange={importQuestions} />
            </label>
            <div className="w-px h-4 bg-border" />
            <Button
              onClick={() => saveMutation.mutate(editableQuestions)}
              disabled={saveMutation.isPending}
              data-testid="btn-save-questions"
              className="gap-2 h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Save className="w-3.5 h-3.5" />
              {saveMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-5 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 rounded-xl flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Changes to form questions will only affect new submissions. Existing responses will retain the original answers.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertTriangle className="w-8 h-8 text-red-500" />
            <p className="text-sm text-muted-foreground">
              {(error as Error).message?.startsWith("401")
                ? "Session expired. Please log in again."
                : "Failed to load questions. The server may be restarting — try again in a moment."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </Button>
              {(error as Error).message?.startsWith("401") && (
                <Button variant="outline" size="sm" onClick={() => navigate("/login")} className="gap-1.5">
                  Log in again
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(pageGroups)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([page, qs]) => (
                <div key={page}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                      {page}
                    </div>
                    <span className="text-sm font-semibold text-foreground">Page {page}</span>
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">{qs.length} question{qs.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="space-y-3">
                    <AnimatePresence>
                      {qs.map((q) => (
                        <motion.div
                          key={q._key}
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                        >
                          <QuestionEditor
                            q={q}
                            onChange={(updated) => updateQuestion(q._key, updated)}
                            onDelete={() => deleteQuestion(q._key)}
                            isNew={q.isNew}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}

            <Button
              variant="outline"
              onClick={addQuestion}
              data-testid="btn-add-question"
              className="w-full gap-2 border-dashed h-10 text-sm text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-4 h-4" />
              Add Question
            </Button>
          </div>
        )}

        {/* ── End Page Section ── */}
        <div className="mt-8 rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/30">
            <FileCheck className="w-4 h-4 text-green-600" />
            <span className="font-semibold text-sm text-foreground">End Page — Confirmation Message</span>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-xs text-muted-foreground">
              This text appears on the success screen after a form submission. Leave blank to use the default message.
            </p>
            <Textarea
              value={endPageText}
              onChange={(e) => setEndPageText(e.target.value)}
              placeholder={"Thank you for your submission!\n\nWe have received your order and will review it shortly. You will hear back from us within 24–48 hours."}
              className="min-h-[120px] resize-none text-sm"
              data-testid="input-end-page-text"
            />
            <div className="flex justify-end">
              <Button
                onClick={() => saveSettingsMutation.mutate(endPageText)}
                disabled={saveSettingsMutation.isPending}
                className="gap-2 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                data-testid="btn-save-end-page"
              >
                <Save className="w-3.5 h-3.5" />
                {saveSettingsMutation.isPending ? "Saving..." : "Save Confirmation Text"}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Telegram Test ── */}
        <div className="mt-4 rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/30">
            <Send className="w-4 h-4 text-blue-500" />
            <span className="font-semibold text-sm text-foreground">Telegram Notifications</span>
          </div>
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                Send a test message to verify your Telegram bot and chat ID are configured correctly.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runDiagnose}
                  disabled={diagLoading}
                  className="gap-1.5 h-8 text-xs"
                  data-testid="btn-diagnose-telegram"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${diagLoading ? "animate-spin" : ""}`} />
                  {diagLoading ? "Diagnosing..." : "Diagnose"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testNotification}
                  disabled={testingNotif}
                  className="gap-1.5 h-8 text-xs"
                  data-testid="btn-test-notification"
                >
                  <Send className="w-3.5 h-3.5" />
                  {testingNotif ? "Sending..." : "Send Test"}
                </Button>
              </div>
            </div>
            {diagResult && (
              <div className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap border ${diagResult.ok ? "bg-green-50 dark:bg-green-950/20 border-green-200/50 text-green-900 dark:text-green-300" : "bg-red-50 dark:bg-red-950/20 border-red-200/50 text-red-900 dark:text-red-300"}`}>
                {diagResult.ok ? (
                  <>
                    <p className="font-semibold mb-1">✅ Bot: @{diagResult.bot?.username} ({diagResult.bot?.name})</p>
                    <p>Configured TELEGRAM_CHAT_ID: <b>{diagResult.configuredChatId}</b></p>
                    {diagResult.seenChats?.length > 0 ? (
                      <>
                        <p className="mt-2 font-semibold">Recent chats (use 'id' as TELEGRAM_CHAT_ID):</p>
                        {diagResult.seenChats.map((c: any) => (
                          <p key={c.id} className="pl-2">· [{c.type}] {c.title || c.username || "private"} → <b>{c.id}</b></p>
                        ))}
                      </>
                    ) : (
                      <p className="mt-1 text-amber-700 dark:text-amber-400">{diagResult.hint}</p>
                    )}
                  </>
                ) : (
                  <p>❌ {diagResult.error}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Shield className="w-3.5 h-3.5" />
          <span>Form structure is stored securely</span>
        </div>
      </div>
    </div>
  );
}
