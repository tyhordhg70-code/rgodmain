import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft, Shield, Lock, CheckCircle2, AlertTriangle, Home, ChevronsUpDown, Check, MapPin, Phone, Link, AtSign, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { useToast } from "@/hooks/use-toast";
import type { FormQuestion } from "@workspace/db";

const _cfg = { _e: atob("L2FwaS92MS9zdWJtaXQ=") };

type FormAnswers = Record<string, string>;

// ─── Country data ─────────────────────────────────────────────────────────────

interface Country {
  name: string;
  code: string;
  dial: string;
}

const COUNTRIES: Country[] = [
  { name: "Afghanistan", code: "AF", dial: "+93" },
  { name: "Albania", code: "AL", dial: "+355" },
  { name: "Algeria", code: "DZ", dial: "+213" },
  { name: "Argentina", code: "AR", dial: "+54" },
  { name: "Australia", code: "AU", dial: "+61" },
  { name: "Austria", code: "AT", dial: "+43" },
  { name: "Bangladesh", code: "BD", dial: "+880" },
  { name: "Belgium", code: "BE", dial: "+32" },
  { name: "Brazil", code: "BR", dial: "+55" },
  { name: "Canada", code: "CA", dial: "+1" },
  { name: "Chile", code: "CL", dial: "+56" },
  { name: "China", code: "CN", dial: "+86" },
  { name: "Colombia", code: "CO", dial: "+57" },
  { name: "Croatia", code: "HR", dial: "+385" },
  { name: "Czech Republic", code: "CZ", dial: "+420" },
  { name: "Denmark", code: "DK", dial: "+45" },
  { name: "Egypt", code: "EG", dial: "+20" },
  { name: "Ethiopia", code: "ET", dial: "+251" },
  { name: "Finland", code: "FI", dial: "+358" },
  { name: "France", code: "FR", dial: "+33" },
  { name: "Germany", code: "DE", dial: "+49" },
  { name: "Ghana", code: "GH", dial: "+233" },
  { name: "Greece", code: "GR", dial: "+30" },
  { name: "Hong Kong", code: "HK", dial: "+852" },
  { name: "Hungary", code: "HU", dial: "+36" },
  { name: "India", code: "IN", dial: "+91" },
  { name: "Indonesia", code: "ID", dial: "+62" },
  { name: "Iran", code: "IR", dial: "+98" },
  { name: "Iraq", code: "IQ", dial: "+964" },
  { name: "Ireland", code: "IE", dial: "+353" },
  { name: "Israel", code: "IL", dial: "+972" },
  { name: "Italy", code: "IT", dial: "+39" },
  { name: "Japan", code: "JP", dial: "+81" },
  { name: "Jordan", code: "JO", dial: "+962" },
  { name: "Kenya", code: "KE", dial: "+254" },
  { name: "Kuwait", code: "KW", dial: "+965" },
  { name: "Lebanon", code: "LB", dial: "+961" },
  { name: "Malaysia", code: "MY", dial: "+60" },
  { name: "Mexico", code: "MX", dial: "+52" },
  { name: "Morocco", code: "MA", dial: "+212" },
  { name: "Netherlands", code: "NL", dial: "+31" },
  { name: "New Zealand", code: "NZ", dial: "+64" },
  { name: "Nigeria", code: "NG", dial: "+234" },
  { name: "Norway", code: "NO", dial: "+47" },
  { name: "Pakistan", code: "PK", dial: "+92" },
  { name: "Peru", code: "PE", dial: "+51" },
  { name: "Philippines", code: "PH", dial: "+63" },
  { name: "Poland", code: "PL", dial: "+48" },
  { name: "Portugal", code: "PT", dial: "+351" },
  { name: "Qatar", code: "QA", dial: "+974" },
  { name: "Romania", code: "RO", dial: "+40" },
  { name: "Russia", code: "RU", dial: "+7" },
  { name: "Saudi Arabia", code: "SA", dial: "+966" },
  { name: "Singapore", code: "SG", dial: "+65" },
  { name: "South Africa", code: "ZA", dial: "+27" },
  { name: "South Korea", code: "KR", dial: "+82" },
  { name: "Spain", code: "ES", dial: "+34" },
  { name: "Sweden", code: "SE", dial: "+46" },
  { name: "Switzerland", code: "CH", dial: "+41" },
  { name: "Taiwan", code: "TW", dial: "+886" },
  { name: "Thailand", code: "TH", dial: "+66" },
  { name: "Turkey", code: "TR", dial: "+90" },
  { name: "Ukraine", code: "UA", dial: "+380" },
  { name: "United Arab Emirates", code: "AE", dial: "+971" },
  { name: "United Kingdom", code: "GB", dial: "+44" },
  { name: "United States", code: "US", dial: "+1" },
  { name: "Venezuela", code: "VE", dial: "+58" },
  { name: "Vietnam", code: "VN", dial: "+84" },
];

function flag(code: string) {
  return code.toUpperCase().replace(/./g, (c) =>
    String.fromCodePoint(127397 + c.charCodeAt(0))
  );
}

// Postal code patterns
const POSTAL_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
  AU: /^\d{4}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  IT: /^\d{5}$/,
  ES: /^\d{5}$/,
  NL: /^\d{4} ?[A-Z]{2}$/i,
  JP: /^\d{3}-?\d{4}$/,
  BR: /^\d{5}-?\d{3}$/,
  IN: /^\d{6}$/,
  CN: /^\d{6}$/,
  MX: /^\d{5}$/,
  NZ: /^\d{4}$/,
  SG: /^\d{6}$/,
  ZA: /^\d{4}$/,
  PL: /^\d{2}-\d{3}$/,
  SE: /^\d{3} ?\d{2}$/,
  NO: /^\d{4}$/,
  DK: /^\d{4}$/,
  FI: /^\d{5}$/,
  CH: /^\d{4}$/,
  AT: /^\d{4}$/,
  BE: /^\d{4}$/,
  PT: /^\d{4}(-\d{3})?$/,
};

// ─── Phone Field ──────────────────────────────────────────────────────────────

function PhoneField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);

  const parseValue = (v: string): { country: Country | null; number: string } => {
    if (!v) return { country: COUNTRIES.find(c => c.code === "US") || null, number: "" };
    const match = v.match(/^(\+\d+)\s*(.*)$/);
    if (!match) return { country: COUNTRIES.find(c => c.code === "US") || null, number: v };
    const dial = match[1];
    const num = match[2] || "";
    const found = COUNTRIES.find(c => c.dial === dial && c.code !== "CA") ||
                  COUNTRIES.find(c => c.dial === dial) || null;
    return { country: found, number: num };
  };

  const { country: selectedCountry, number } = parseValue(value);

  const selectCountry = (c: Country) => {
    onChange(`${c.dial} ${number}`);
    setOpen(false);
  };

  const updateNumber = (n: string) => {
    const dial = selectedCountry?.dial || "+1";
    onChange(`${dial} ${n}`);
  };

  return (
    <div className="flex gap-2 mt-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-[130px] shrink-0 h-11 px-3 justify-between font-normal bg-white/90"
            data-testid="phone-country-trigger"
          >
            <span className="flex items-center gap-1.5 overflow-hidden">
              <span className="text-base leading-none">{selectedCountry ? flag(selectedCountry.code) : "🌍"}</span>
              <span className="text-sm">{selectedCountry?.dial || "+?"}</span>
            </span>
            <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search country..." data-testid="phone-country-search" />
            <CommandList className="max-h-[220px]">
              <CommandEmpty>No country found.</CommandEmpty>
              <CommandGroup>
                {COUNTRIES.map((c) => (
                  <CommandItem
                    key={`${c.code}-${c.dial}`}
                    value={`${c.name} ${c.dial}`}
                    onSelect={() => selectCountry(c)}
                    data-testid={`phone-country-${c.code}`}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <span className="text-base w-6">{flag(c.code)}</span>
                    <span className="flex-1 text-sm">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.dial}</span>
                    {selectedCountry?.code === c.code && selectedCountry?.dial === c.dial && (
                      <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        type="tel"
        value={number}
        onChange={(e) => updateNumber(e.target.value)}
        placeholder={placeholder || "Phone number"}
        className="flex-1 h-11"
        data-testid="phone-number-input"
      />
    </div>
  );
}

// ─── Address Field ────────────────────────────────────────────────────────────

interface AddressData {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  countryCode: string;
}

function parseAddress(value: string): AddressData {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") return parsed as AddressData;
  } catch {}
  return { line1: "", line2: "", city: "", state: "", postal: "", country: "", countryCode: "" };
}

function AddressField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [addr, setAddr] = useState<AddressData>(() => parseAddress(value));
  const [countryOpen, setCountryOpen] = useState(false);
  const [postalError, setPostalError] = useState("");

  const update = (patch: Partial<AddressData>) => {
    const next = { ...addr, ...patch };
    setAddr(next);
    onChange(JSON.stringify(next));
  };

  const selectCountry = (c: Country) => {
    update({ country: c.name, countryCode: c.code });
    setCountryOpen(false);
    setPostalError("");
  };

  const validatePostal = (code: string, countryCode: string) => {
    if (!code) { setPostalError(""); return; }
    const pattern = POSTAL_PATTERNS[countryCode];
    if (pattern && !pattern.test(code.trim())) {
      setPostalError("Invalid postal code format for selected country");
    } else {
      setPostalError("");
    }
  };

  const selectedCountryObj = COUNTRIES.find(c => c.code === addr.countryCode) || null;

  return (
    <div className="mt-1 space-y-2.5">
      <Input value={addr.line1} onChange={(e) => update({ line1: e.target.value })} placeholder="Street address, P.O. box" className="h-10 text-sm" data-testid="address-line1" />
      <Input value={addr.line2} onChange={(e) => update({ line2: e.target.value })} placeholder="Apartment, suite, unit (optional)" className="h-10 text-sm" data-testid="address-line2" />
      <div className="grid grid-cols-2 gap-2">
        <Input value={addr.city} onChange={(e) => update({ city: e.target.value })} placeholder="City" className="h-10 text-sm" data-testid="address-city" />
        <Input value={addr.state} onChange={(e) => update({ state: e.target.value })} placeholder="State / Province" className="h-10 text-sm" data-testid="address-state" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Input
            value={addr.postal}
            onChange={(e) => { update({ postal: e.target.value }); validatePostal(e.target.value, addr.countryCode); }}
            placeholder="Postal / ZIP code"
            className={`h-10 text-sm ${postalError ? "border-red-400 focus-visible:ring-red-400" : ""}`}
            data-testid="address-postal"
          />
          {postalError && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3 shrink-0" />{postalError}</p>}
        </div>
        <Popover open={countryOpen} onOpenChange={setCountryOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="h-10 w-full justify-between font-normal text-sm px-3" data-testid="address-country-trigger">
              <span className="flex items-center gap-1.5 overflow-hidden">
                {selectedCountryObj && <span className="text-sm">{flag(selectedCountryObj.code)}</span>}
                <span className="truncate text-sm">{addr.country || <span className="text-muted-foreground">Country</span>}</span>
              </span>
              <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[260px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search country..." data-testid="address-country-search" />
              <CommandList className="max-h-[200px]">
                <CommandEmpty>No country found.</CommandEmpty>
                <CommandGroup>
                  {COUNTRIES.map((c) => (
                    <CommandItem key={c.code} value={c.name} onSelect={() => selectCountry(c)} data-testid={`address-country-${c.code}`} className="flex items-center gap-2 cursor-pointer">
                      <span className="text-base w-6">{flag(c.code)}</span>
                      <span className="flex-1 text-sm">{c.name}</span>
                      {addr.countryCode === c.code && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {(addr.line1 || addr.city) && (
        <div className="flex items-start gap-1.5 px-3 py-2 bg-blue-50/80 dark:bg-blue-950/20 rounded-lg text-xs text-blue-700 dark:text-blue-300">
          <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="leading-relaxed">{[addr.line1, addr.line2, addr.city, addr.state, addr.postal, addr.country].filter(Boolean).join(", ")}</span>
        </div>
      )}
    </div>
  );
}

// ─── URL Field ────────────────────────────────────────────────────────────────

const URL_REGEX = /^(https?:\/\/)?([\w-]+(\.[\w-]+)+)(\/[\w\-./?%&=#]*)?$/i;

function URLField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [touched, setTouched] = useState(false);
  const isValid = !value || URL_REGEX.test(value.trim());

  return (
    <div className="mt-1">
      <div className="relative">
        <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value); setTouched(true); }}
          onBlur={() => setTouched(true)}
          placeholder={placeholder || "example.com or example.com/gb"}
          className={`h-11 pl-9 ${touched && !isValid ? "border-red-400 focus-visible:ring-red-400" : ""}`}
          data-testid="url-input"
        />
      </div>
      {touched && !isValid && (
        <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Please enter a valid website address (e.g. amazon.com or amazon.com/gb)
        </p>
      )}
    </div>
  );
}

// ─── Page helpers ─────────────────────────────────────────────────────────────

function groupByPage(questions: FormQuestion[]): Map<number, FormQuestion[]> {
  const map = new Map<number, FormQuestion[]>();
  for (const q of questions) {
    if (!map.has(q.pageNumber)) map.set(q.pageNumber, []);
    map.get(q.pageNumber)!.push(q);
  }
  return map;
}

function RadioGroup({ question, value, onChange }: { question: FormQuestion; value: string; onChange: (v: string) => void }) {
  const opts = (question.options as string[]) || [];
  return (
    <div className="flex flex-col gap-3 mt-1">
      {opts.map((opt) => (
        <button
          key={opt}
          type="button"
          data-testid={`radio-${question.questionId}-${opt}`}
          onClick={() => onChange(opt)}
          className={`flex items-center gap-3 px-5 py-3.5 rounded-xl border-2 text-left transition-all duration-200 ${
            value === opt
              ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-500"
              : "border-border bg-card hover:border-blue-300 dark:hover:border-blue-700"
          }`}
        >
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
            value === opt ? "border-blue-600 dark:border-blue-400" : "border-muted-foreground/40"
          }`}>
            {value === opt && <div className="w-2.5 h-2.5 rounded-full bg-blue-600 dark:bg-blue-400" />}
          </div>
          <span className="text-sm font-medium text-foreground">{opt}</span>
        </button>
      ))}
    </div>
  );
}

function ParticlesBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    interface Particle { x: number; y: number; r: number; dx: number; dy: number; opacity: number; pulse: number; pulseSpeed: number; }
    const particles: Particle[] = Array.from({ length: 70 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 2.5 + 0.5,
      dx: (Math.random() - 0.5) * 0.35,
      dy: (Math.random() - 0.5) * 0.35,
      opacity: Math.random() * 0.35 + 0.08,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.015 + 0.005,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.pulse += p.pulseSpeed;
        const a = p.opacity * (0.7 + 0.3 * Math.sin(p.pulse));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fill();
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        if (p.y < -10) p.y = canvas.height + 10;
        if (p.y > canvas.height + 10) p.y = -10;
      }
      animFrameId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} />;
}

function QuestionField({ question, value, onChange }: { question: FormQuestion; value: string; onChange: (v: string) => void }) {
  switch (question.questionType) {
    case "phone":
      return <PhoneField value={value} onChange={onChange} placeholder={question.placeholder || undefined} />;
    case "address":
      return <AddressField value={value} onChange={onChange} />;
    case "url":
      return <URLField value={value} onChange={onChange} placeholder={question.placeholder || undefined} />;
    case "radio":
      return <RadioGroup question={question} value={value} onChange={onChange} />;
    case "select":
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger data-testid={`select-${question.questionId}`} className="mt-1 h-11">
            <SelectValue placeholder="Select an option..." />
          </SelectTrigger>
          <SelectContent>
            {((question.options as string[]) || []).map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "textarea":
      return (
        <Textarea
          data-testid={`textarea-${question.questionId}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder || ""}
          className="mt-1 min-h-[100px] resize-none"
          rows={4}
        />
      );
    case "date":
      return (
        <Input
          data-testid={`input-${question.questionId}`}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 h-11"
        />
      );
    case "number":
      return (
        <Input
          data-testid={`input-${question.questionId}`}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const filtered = e.target.value.replace(/[^0-9.,\s$£€¥₹₩₽₺₦₴₪฿₫₱₲₵₸₾]/g, "");
            onChange(filtered);
          }}
          placeholder={question.placeholder || "e.g. $250.00"}
          className="mt-1 h-11"
        />
      );
    case "email":
      return (
        <Input
          data-testid={`input-${question.questionId}`}
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder || "you@example.com"}
          className="mt-1 h-11"
        />
      );
    default:
      return (
        <Input
          data-testid={`input-${question.questionId}`}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder || ""}
          className="mt-1 h-11"
        />
      );
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Accepts: $250.00, £99.99, €150, 250 USD, GBP 99, 1,250.00, etc.
const CURRENCY_REGEX = /^[£€$¥₹₩₺₦₴₪฿₫₱₲₵₸₾]?\s*[\d,]+(\.\d{1,2})?\s*([A-Z]{2,3})?$|^[\d,]+(\.\d{1,2})?\s*[£€$¥₹₩₺₦₴₪฿₫₱₲₵₸₾]$|^[A-Z]{2,4}\s*[\d,]+(\.\d{1,2})?$/;

function getFieldError(q: FormQuestion, value: string, answers?: Record<string, string>): string | null {
  const v = value?.trim() ?? "";

  if (q.questionType === "phone") {
    if (!v) return q.required ? "Phone number is required" : null;
    const match = v.match(/^(\+\d+)\s*(\d[\d\s\-]{3,})$/);
    if (!match) return "Please enter a valid phone number with country code";
    return null;
  }

  if (q.questionType === "address") {
    if (!v) return q.required ? "Address is required" : null;
    try {
      const a: { line1?: string; city?: string; postal?: string; country?: string } = JSON.parse(v);
      const missing: string[] = [];
      if (!a.line1?.trim()) missing.push("street address");
      if (!a.city?.trim()) missing.push("city");
      if (!a.postal?.trim()) missing.push("postal code");
      if (!a.country?.trim()) missing.push("country");
      if (missing.length) return `Please fill in: ${missing.join(", ")}`;
    } catch {
      return "Invalid address";
    }
    return null;
  }

  if (q.questionType === "email") {
    if (!v) return q.required ? "Email is required" : null;
    if (!EMAIL_REGEX.test(v)) return "Please enter a valid email address";
    return null;
  }

  if (q.questionType === "url") {
    if (!v) return q.required ? "Website URL is required" : null;
    if (!URL_REGEX.test(v)) return "Please enter a valid website address (e.g. amazon.com or amazon.com/gb)";
    return null;
  }

  // Currency: order_value field must be a recognisable amount
  if (q.questionId === "order_value") {
    if (!v) return q.required ? "Order value is required" : null;
    if (!CURRENCY_REGEX.test(v.replace(/\s+/g, " ").trim())) {
      return "Enter an amount with currency symbol — e.g. $250.00, £99.99, €150 or 250 USD";
    }
    return null;
  }

  // Telegram username: detect by question ID or text containing "telegram"
  if (
    q.questionId.toLowerCase().includes("telegram") ||
    q.questionText.toLowerCase().includes("telegram")
  ) {
    // Only required if Telegram is the selected contact method (or the field itself is required)
    const contactMethod = answers?.contact_method || "";
    const telegramSelected = contactMethod === "Telegram";
    if (!v) return (q.required || telegramSelected) ? "Telegram username is required when Telegram is selected as contact method" : null;
    if (!v.startsWith("@")) return "Telegram username must start with @";
    return null;
  }

  if (q.required && !v) return "This field is required";
  return null;
}

// ─── Success Overlay ──────────────────────────────────────────────────────────

function SuccessOverlay({ open, text }: { open: boolean; text: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 form-animated-bg flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25, delay: 0.05 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-white/20 p-10 max-w-md w-full text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 400, damping: 20 }}
              className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-6"
            >
              <CheckCircle2 className="w-11 h-11 text-green-600 dark:text-green-400" />
            </motion.div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Order Submitted!</h2>
            <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">
              {text || "Your order has been submitted successfully. Your information has been securely encrypted. We will be in touch shortly."}
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Lock className="w-3.5 h-3.5" />
              <span>End-to-end encrypted</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Main form page ───────────────────────────────────────────────────────────

export default function FormPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [currentPage, setCurrentPage] = useState(1);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery<{ questions: FormQuestion[] }>({
    queryKey: ["/api/form/config"],
  });

  const { data: settingsData } = useQuery<{ end_page_text: string }>({
    queryKey: ["/api/form/settings"],
  });

  const questions = data?.questions || [];
  const pageMap = groupByPage(questions);
  const totalPages = pageMap.size;
  const pageNumbers = Array.from(pageMap.keys()).sort((a, b) => a - b);
  const pageQuestions = pageMap.get(pageNumbers[currentPage - 1]) || [];

  // Hide telegram_username unless user picked Telegram as contact method
  const visiblePageQuestions = pageQuestions.filter((q) => {
    if (q.questionId === "telegram_username") {
      return answers.contact_method === "Telegram";
    }
    return true;
  });

  const validatePage = (): boolean => {
    const newErrors: Record<string, string> = {};
    for (const q of visiblePageQuestions) {
      const err = getFieldError(q, answers[q.questionId] || "", answers);
      if (err) newErrors[q.questionId] = err;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (!validatePage()) return;

    if (currentPage === 1) {
      const agreementQ = pageQuestions.find((q) => q.questionId === "agreement");
      if (agreementQ && answers[agreementQ.questionId] !== "Yes") {
        toast({
          title: "Agreement Required",
          description: "You must agree to the terms to continue.",
          variant: "destructive",
        });
        return;
      }
    }

    setCurrentPage((p) => Math.min(p + 1, totalPages));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePrev = () => {
    setCurrentPage((p) => Math.max(p - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async () => {
    if (!validatePage()) return;
    setSubmitting(true);

    try {
      const payload = JSON.stringify({
        answers,
        submittedAt: new Date().toISOString(),
        meta: { pages: totalPages },
      });

      const res = await fetch(_cfg._e, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload }),
        credentials: "include",
      });

      if (!res.ok) throw new Error("Submission failed");
      setSubmitted(true);
    } catch {
      toast({
        title: "Submission Failed",
        description: "Please try again. If the problem persists, contact support.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen form-animated-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-white/80">Loading form...</p>
        </div>
      </div>
    );
  }

  if (isError || questions.length === 0) {
    return (
      <div className="min-h-screen form-animated-bg flex items-center justify-center p-4">
        <div className="text-center">
          <AlertTriangle className="w-10 h-10 text-white/80 mx-auto mb-3" />
          <p className="text-white/80">Unable to load form. Please try again later.</p>
        </div>
      </div>
    );
  }

  const isLastPage = currentPage === totalPages;
  const progressPercent = Math.round((currentPage / totalPages) * 100);
  const endPageText = settingsData?.end_page_text || "";

  return (
    <div className="min-h-screen form-animated-bg relative">
      <ParticlesBackground />
      <SuccessOverlay open={submitted} text={endPageText} />

      <div className="max-w-2xl mx-auto px-4 py-8 relative z-10">
        <div className="flex justify-start mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="gap-1.5 h-8 text-xs text-white/70 hover:text-white hover:bg-white/10"
            data-testid="btn-home"
          >
            <Home className="w-3.5 h-3.5" />
            Home
          </Button>
        </div>

        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-full px-4 py-2 border border-white/20 shadow-sm mb-5">
            <Shield className="w-4 h-4 text-white" />
            <span className="text-xs font-medium text-white">Encrypted by SecureForm</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight drop-shadow">Submit Your Order</h1>
          <p className="text-white/70 mt-2 text-sm">Step {currentPage} of {totalPages}</p>
        </div>

        <div className="w-full bg-white/20 rounded-full h-1.5 mb-8">
          <motion.div
            className="h-1.5 rounded-full bg-white"
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.2 }}
          >
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
              <div className="p-6 sm:p-8 space-y-7">
                {visiblePageQuestions.map((question) => (
                  <div key={question.questionId} data-testid={`question-${question.questionId}`}>
                    {question.description && (
                      <div className="mb-5 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-xl">
                        <p className="text-sm text-amber-800 dark:text-amber-300 whitespace-pre-line leading-relaxed font-medium">
                          {question.description}
                        </p>
                      </div>
                    )}
                    <div>
                      <Label className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        {question.questionType === "phone" && <Phone className="w-3.5 h-3.5 text-muted-foreground" />}
                        {question.questionType === "address" && <MapPin className="w-3.5 h-3.5 text-muted-foreground" />}
                        {question.questionType === "url" && <Link className="w-3.5 h-3.5 text-muted-foreground" />}
                        {question.questionId === "telegram_username" && <AtSign className="w-3.5 h-3.5 text-sky-500" />}
                        {question.questionId === "order_value" && <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />}
                        {question.questionText}
                        {(question.required || (question.questionId === "telegram_username" && answers.contact_method === "Telegram")) && (
                          <span className="text-red-500">*</span>
                        )}
                      </Label>
                      <QuestionField
                        question={question}
                        value={answers[question.questionId] || ""}
                        onChange={(v) => {
                          setAnswers((a) => ({ ...a, [question.questionId]: v }));
                          if (errors[question.questionId]) {
                            setErrors((e) => { const ne = { ...e }; delete ne[question.questionId]; return ne; });
                          }
                        }}
                      />
                      {errors[question.questionId] && (
                        <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {errors[question.questionId]}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-6 sm:px-8 pb-6 sm:pb-8 flex items-center justify-between gap-3 border-t border-border pt-5">
                <Button
                  variant="outline"
                  onClick={handlePrev}
                  disabled={currentPage === 1}
                  data-testid="btn-prev"
                  className="gap-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </Button>
                {isLastPage ? (
                  <Button
                    onClick={handleSubmit}
                    disabled={submitting}
                    data-testid="btn-submit"
                    className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {submitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        Submit Securely
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={handleNext}
                    data-testid="btn-next"
                    className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-white/60">
          <Lock className="w-3.5 h-3.5" />
          <span>Your data is securely encrypted and protected</span>
        </div>
      </div>
    </div>
  );
}
