import type { LucideIcon } from "lucide-react";
import { Check, Loader2 } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { AttemptOutcome } from "../../core/prove";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: LucideIcon;
  loading?: boolean;
  size?: "sm" | "md";
};

export function Button({ variant = "secondary", icon: Icon, loading, size = "md", children, className = "", ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 className="spin" size={15} /> : Icon && <Icon size={15} strokeWidth={2} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Spinner({ size = 15 }: { size?: number }) {
  return <Loader2 className="spin" size={size} />;
}

const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
  verified: "Verified",
  errors: "Lean errors",
  sorries: "Unfinished",
  rejected: "Rejected",
  refused: "Refused",
  "no verdict": "Timed out",
};

const OUTCOME_TONE: Record<AttemptOutcome, Tone> = {
  verified: "ok",
  errors: "bad",
  sorries: "warn",
  rejected: "bad",
  refused: "bad",
  "no verdict": "warn",
};

type Tone = "ok" | "bad" | "warn" | "info" | "neutral";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: AttemptOutcome }) {
  return <Badge tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABEL[outcome]}</Badge>;
}

export function outcomeTone(outcome: AttemptOutcome): Tone {
  return OUTCOME_TONE[outcome];
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`dot dot-${tone}`} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      icon={done ? Check : undefined}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}
