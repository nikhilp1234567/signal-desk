import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check, Copy } from "lucide-react";

export function Button({ children, variant = "secondary", icon, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "text"; icon?: ReactNode }) {
  return <button {...props} className={`button button--${variant}${props.className ? ` ${props.className}` : ""}`}>{icon}{children}</button>;
}
export function StatusSquare({ status }: { status: string }) { return <span className={`status-square status-square--${status.toLowerCase().replaceAll(" ", "-")}`} aria-hidden="true" />; }
export function MiniSignal({ value = 3 }: { value?: number }) { return <span className="mini-signal" aria-hidden="true">{[1,2,3,4].map((n) => <i key={n} className={n <= value ? "active" : ""} />)}</span>; }
export function CheckRow({ children }: { children: ReactNode }) { return <div className="check-row"><span className="check-icon"><Check /></span><span>{children}</span></div>; }
export async function copyText(text: string) { await navigator.clipboard.writeText(text); }
export function CopyIcon({ copied }: { copied: boolean }) { return copied ? <Check /> : <Copy />; }
