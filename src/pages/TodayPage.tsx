import { useDeferredValue, useMemo, useState } from "react";
import { Bookmark, ChevronDown, Clock3, ExternalLink, Filter, Globe2, Info, RefreshCw, SortAsc, Sparkles, UsersRound, X } from "lucide-react";
import type { CollectionRunSummary, Opportunity } from "../../shared/types";
import { Button, CopyIcon, MiniSignal, copyText } from "../components/Ui";
import { PageHeader } from "../components/PageHeader";

type TodayProps = {
  opportunities: Opportunity[]; lastRun: CollectionRunSummary | null; busy: boolean; onMenu: () => void; onRefresh: () => Promise<boolean>;
  onUpdate: (id: string, patch: Partial<Opportunity>) => Promise<unknown>; onModify: (id: string, modifier: string) => Promise<unknown>; onSources: () => void; onToast: (message: string) => void;
};

const initials = (name: string) => name.split(" ").map((part) => part[0]).join("").slice(0, 2);

function AuthorAvatar({ item }: { item: Opportunity }) {
  const [failed, setFailed] = useState(false);
  return <span className={`avatar avatar--${item.id.length % 5}`}>
    {item.avatar && !failed ? <img src={item.avatar} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials(item.author)}
  </span>;
}

export function TodayPage({ opportunities, lastRun, busy, onMenu, onRefresh, onUpdate, onModify, onSources, onToast }: TodayProps) {
  const [selectedId, setSelectedId] = useState(opportunities[0]?.id ?? "");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "groups" | "public">("all");
  const deferredFilter = useDeferredValue(filter);
  const [copied, setCopied] = useState(false);
  const visible = useMemo(() => opportunities.filter((item) => deferredFilter === "all" || (deferredFilter === "groups" ? item.sourceKind === "linkedin_group" : item.sourceKind === "public_search")), [opportunities, deferredFilter]);
  const selected = opportunities.find((item) => item.id === selectedId) ?? visible[0] ?? opportunities[0];

  const copyReply = async () => {
    if (!selected) return;
    await copyText(selected.draftReply); setCopied(true); onToast("Reply copied — review it once more before publishing."); setTimeout(() => setCopied(false), 1800);
  };

  return <div className={`workspace${selected ? " workspace--inspector" : ""}`}>
    <main className="workspace-main">
      <PageHeader title="Today’s opportunities" subtitle="Thoughtful conversations worth joining" onMenu={onMenu} action={<button className="text-action" disabled={busy} onClick={() => void onRefresh()}><RefreshCw className={busy ? "spin" : ""} />Refresh signals</button>} />
      <div className="control-rail">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><Filter />All signals<ChevronDown /></button>
        <button className={filter === "groups" ? "active" : ""} onClick={() => setFilter("groups")}><UsersRound />Groups<ChevronDown /></button>
        <button className={filter === "public" ? "active" : ""} onClick={() => setFilter("public")}><Globe2 />Public posts<ChevronDown /></button>
        <span className="rail-spacer" />
        <button><SortAsc />Sort: Best fit<ChevronDown /></button><button><Clock3 />Last 7 days<ChevronDown /></button>
      </div>
      <div className="opportunity-table" role="table" aria-label="Ranked engagement opportunities">
        <div className="opportunity-head" role="row"><span>Author</span><span>Post excerpt</span><span>Age</span><span>Source</span><span>Relevance</span><span>Status</span></div>
        <div className="opportunity-list">
          {visible.length ? visible.map((item) => <button role="row" key={item.id} className={`opportunity-row${selected?.id === item.id ? " opportunity-row--selected" : ""}`} onClick={() => { setSelectedId(item.id); setDrawerOpen(true); }}>
            <span className="author-cell"><AuthorAvatar item={item} /><span><strong>{item.author}</strong><small>{item.company === "Unknown company" ? "Company unverified" : item.company}</small><small className="industry-label">{item.industry || "Industry not provided"}</small></span></span>
            <span className="excerpt-cell">{item.excerpt}</span><span>{item.ageLabel}</span><span className="source-cell">{item.sourceLabel}</span>
            <span className="score-cell"><strong>{item.score}</strong><MiniSignal value={Math.ceil(item.score / 25)} /></span><span className="status-cell"><i />{item.status === "new" ? "New" : item.status}</span>
          </button>) : <div className="empty-state"><Sparkles /><h2>No signals in Today yet</h2><p>{lastRun?.collectedCount ? lastRun.auditVersion >= 2 ? lastRun.aiFailedCount ? `The last run pulled ${lastRun.collectedCount} posts, but all ${lastRun.aiFailedCount} AI attempts failed. That historical run did not preserve a fallback queue; the next run will.` : `The last run pulled ${lastRun.collectedCount} posts but did not produce a queue. Open Sources to inspect its full receipt.` : `The latest run used the old shortlist and sent ${lastRun.analyzedCount} of ${lastRun.prequalifiedCount} valid posts to AI. New runs retain every valid post.` : "No posts have completed collection yet."}</p><Button variant="primary" onClick={onSources}>Open collection receipt</Button></div>}
        </div>
      </div>
      <footer className="workspace-footer"><span>Showing {visible.length} of {opportunities.length} signals</span><span>Next refresh at 08:30 <Clock3 /></span></footer>
    </main>
    {selected ? <aside className={`inspector${drawerOpen ? " inspector--drawer-open" : ""}`} aria-label="Selected opportunity">
      <div className="inspector-top"><div className="selected-author"><AuthorAvatar item={selected} /><span><strong>{selected.author}</strong><small>{selected.authorHeadline || "Headline not provided"}</small><small>{selected.company === "Unknown company" ? "Company unverified" : selected.company}&nbsp;&nbsp;•&nbsp;&nbsp;{selected.industry || "Industry not provided"}</small>{selected.location ? <small>{selected.location}</small> : null}<small>{selected.ageLabel}&nbsp;&nbsp;•&nbsp;&nbsp;{selected.sourceLabel}</small>{selected.authorProfileUrl ? <a className="profile-link" href={selected.authorProfileUrl} target="_blank" rel="noreferrer">View author profile</a> : null}</span></div><div><button aria-label="Save opportunity" onClick={() => void onUpdate(selected.id, { status: "saved" })}><Bookmark /></button><button className="inspector-close" aria-label="Close inspector" onClick={() => setDrawerOpen(false)}><X /></button></div></div>
      <p className="post-copy">{selected.content}</p>
      <section className="inspector-section"><h2><MiniSignal />Why this is worth replying to</h2><p>{selected.fitReasons.join(" ")}</p></section>
      <section className="inspector-section"><h2><MiniSignal />Conversation angle</h2><p>{selected.conversationAngle}</p></section>
      <section className="inspector-section inspector-section--draft"><h2><MiniSignal />Draft reply</h2><textarea aria-label="Draft reply" value={selected.draftReply} onChange={(event) => void onUpdate(selected.id, { draftReply: event.target.value })} /><span className="character-count">{selected.draftReply.length} / 800</span></section>
      <div className="modifier-row"><Button disabled={busy} onClick={() => void onModify(selected.id, "shorter")}>Shorter</Button><Button disabled={busy} onClick={() => void onModify(selected.id, "opinionated")}>More opinionated</Button><Button disabled={busy} onClick={() => void onModify(selected.id, "example")}>Add example</Button></div>
      <div className="action-row"><Button variant="primary" icon={<CopyIcon copied={copied} />} onClick={() => void copyReply()}>Copy reply</Button><a className="button button--secondary" href={selected.url} target="_blank" rel="noreferrer"><ExternalLink />Open on LinkedIn</a><Button onClick={() => { void onUpdate(selected.id, { status: "replied" }); onToast("Marked as replied."); }}>Mark replied</Button></div>
      <div className="manual-note"><Info /><span>You review and publish every reply manually.</span></div>
    </aside> : null}
  </div>;
}
