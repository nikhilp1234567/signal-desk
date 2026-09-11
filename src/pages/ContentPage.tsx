import { useState } from "react";
import { Bookmark, CalendarDays, ChevronLeft, ChevronRight, Copy, Info, Lightbulb, List, MoreVertical, Plus, UserRound, X } from "lucide-react";
import type { ContentDraft, ContentIdea } from "../../shared/types";
import { Button, CheckRow, MiniSignal, copyText } from "../components/Ui";
import { PageHeader } from "../components/PageHeader";

export function ContentPage({ drafts, ideas, busy, onMenu, onUpdate, onModify, onToast }: { drafts: ContentDraft[]; ideas: ContentIdea[]; busy: boolean; onMenu: () => void; onUpdate: (id: string, patch: Partial<ContentDraft>) => Promise<unknown>; onModify: (id: string, modifier: string) => Promise<unknown>; onToast: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState(drafts[0]?.id ?? "");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<"week" | "ideas">("week");
  const selected = drafts.find((draft) => draft.id === selectedId) ?? drafts[0];
  const save = async () => { if (!selected) return; await onUpdate(selected.id, { status: "Draft" }); onToast("Draft saved locally."); };
  const openIdeaDraft = () => { const ideaDraft = drafts.find((draft) => draft.status === "Idea") ?? drafts[0]; if (!ideaDraft) return; setSelectedId(ideaDraft.id); setDrawerOpen(true); onToast("Opened the next idea as an editable draft."); };
  return <div className="workspace workspace--inspector">
    <main className="workspace-main">
      <PageHeader title="Content studio" subtitle="Five useful posts, one clear point of view" onMenu={onMenu} action={<Button variant="primary" icon={<Plus />} onClick={openIdeaDraft}>New draft</Button>} />
      <div className="content-controls"><div className="date-control"><button disabled title="This prototype shows the current editorial week"><ChevronLeft /></button><span><CalendarDays />24–28 Aug</span><button disabled title="This prototype shows the current editorial week"><ChevronRight /></button></div><span className="select-control">All pillars<ChevronRight /></span><div className="view-switch"><button className={view === "week" ? "active" : ""} onClick={() => setView("week")}><CalendarDays />Week</button><button className={view === "ideas" ? "active" : ""} onClick={() => setView("ideas")}><List />Ideas</button></div></div>
      {view === "week" ? <div className="editorial-list">
        {drafts.map((draft) => <button key={draft.id} className={`editorial-row${selected?.id === draft.id ? " editorial-row--selected" : ""}`} onClick={() => { setSelectedId(draft.id); setDrawerOpen(true); }}><span className="date-stack"><small>{draft.day}</small><strong>{draft.date}</strong></span><strong className="draft-title">{draft.title}</strong><span>{draft.pillar}</span><span className={`draft-status draft-status--${draft.status.toLowerCase()}`}>{draft.status}</span><MiniSignal /><MoreVertical /></button>)}
      </div> : <div className="idea-board">{ideas.length ? ideas.map((idea) => <button key={idea.id}><Lightbulb /><span><strong>{idea.title}</strong><small>{idea.source}</small></span><Plus /></button>) : <div className="empty-state empty-state--compact"><Lightbulb /><h2>No conversation ideas yet</h2><p>Run an active source from Sources. Qualifying posts will become ideas here.</p></div>}</div>}
      <section className="idea-bank"><div><h2>Idea bank</h2><p>From recent conversations</p></div>{ideas.length ? ideas.map((idea) => <button key={idea.id} onClick={openIdeaDraft}><Lightbulb /><span>{idea.title}</span><small>{idea.ageLabel}</small><Plus /></button>) : <p className="idea-bank__empty">Ideas appear here after a successful collection and AI qualification.</p>}</section>
    </main>
    {selected ? <aside className={`inspector content-inspector${drawerOpen ? " inspector--drawer-open" : ""}`}>
      <div className="inspector-title"><h2>{selected.day === "Mon" ? "Monday’s" : `${selected.day}’s`} post</h2><button className="mobile-drawer-close" aria-label="Close inspector" onClick={() => setDrawerOpen(false)}><X /></button></div>
      <label className="editor-label">Hook<textarea className="hook-editor" value={selected.hook} onChange={(event) => void onUpdate(selected.id, { hook: event.target.value })} /><span>{selected.hook.length} / 150</span></label>
      <label className="editor-label editor-label--body">Draft<textarea value={selected.body} onChange={(event) => void onUpdate(selected.id, { body: event.target.value })} /><span>{selected.body.length} / 1200</span></label>
      <div className="modifier-row"><Button disabled={busy} onClick={() => void onModify(selected.id, "opinionated")}>Tighter hook</Button><Button disabled={busy} onClick={() => void onModify(selected.id, "example")} icon={<Plus />}>Add example</Button><Button disabled={busy} onClick={() => void onModify(selected.id, "personal")} icon={<UserRound />}>More personal</Button></div>
      <div className="checks"><CheckRow>One clear idea</CheckRow><CheckRow>No pitch</CheckRow><CheckRow>Specific takeaway</CheckRow><CheckRow>Sounds like you</CheckRow></div>
      <div className="action-row action-row--two"><Button variant="primary" icon={<Copy />} onClick={async () => { await copyText(`${selected.hook}\n\n${selected.body}`); onToast("Post copied — publish it manually when it feels ready."); }}>Copy post</Button><Button icon={<Bookmark />} onClick={() => void save()}>Save draft</Button></div>
      <div className="manual-note"><Info /><span>You publish manually on LinkedIn.</span></div>
    </aside> : null}
  </div>;
}
