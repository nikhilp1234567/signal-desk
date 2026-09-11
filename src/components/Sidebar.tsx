import { Database, FileText, Home, Settings, UserRound, X } from "lucide-react";
import type { Source, Workspace } from "../../shared/types";
import { SignalMark } from "./SignalMark";

const items: { id: Workspace; label: string; icon: typeof Home }[] = [
  { id: "today", label: "Today", icon: Home }, { id: "sources", label: "Sources", icon: Database }, { id: "content", label: "Content", icon: FileText },
  { id: "profile", label: "Profile", icon: UserRound }, { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({ workspace, sources, ready, open, onNavigate, onClose }: { workspace: Workspace; sources: Source[]; ready: boolean; open: boolean; onNavigate: (workspace: Workspace) => void; onClose: () => void }) {
  const publicCount = sources.filter((source) => source.kind === "public_search").length;
  const groupCount = sources.filter((source) => source.kind === "linkedin_group").length;
  return <aside className={`sidebar${open ? " sidebar--open" : ""}`}>
    <div className="brand"><SignalMark /><span>Signal Desk</span><button className="mobile-close" onClick={onClose} aria-label="Close navigation"><X /></button></div>
    <nav aria-label="Primary">
      {items.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item${workspace === id ? " nav-item--active" : ""}`} onClick={() => { onNavigate(id); onClose(); }}><Icon /><span>{label}</span></button>)}
    </nav>
    <div className="source-summary">
      <p className="rail-label">Sources summary</p>
      <div><span>Public post searches</span><strong>{publicCount}</strong></div>
      <div><span>LinkedIn groups</span><strong>{groupCount}</strong></div>
    </div>
    <div className="connection-note"><span className={`connection-dot${ready ? "" : " connection-dot--setup"}`} /><span>{ready ? <>API connections ready ·<br />manual engagement</> : <>Setup required ·<br />add API keys</>}</span></div>
  </aside>;
}
