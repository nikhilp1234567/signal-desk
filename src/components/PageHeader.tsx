import type { ReactNode } from "react";
import { Menu } from "lucide-react";

export function PageHeader({ title, subtitle, action, onMenu }: { title: string; subtitle: string; action?: ReactNode; onMenu: () => void }) {
  return <header className="page-header">
    <button className="menu-button" onClick={onMenu} aria-label="Open navigation"><Menu /></button>
    <div><h1>{title}</h1><p>{subtitle}</p></div>
    {action ? <div className="page-action">{action}</div> : null}
  </header>;
}
