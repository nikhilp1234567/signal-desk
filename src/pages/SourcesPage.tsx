import { useState } from "react";
import { CheckCircle2, Clock3, Database, ExternalLink, Globe2, Pause, Play, Plus, RefreshCw, SearchCheck, SlidersHorizontal, Sparkles, TriangleAlert, UsersRound } from "lucide-react";
import type { CandidateReview, CollectionRunSummary, SearchSuggestion, Source } from "../../shared/types";
import { Button, StatusSquare } from "../components/Ui";
import { PageHeader } from "../components/PageHeader";

const relative = (date: string | null) => date ? `${Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 3_600_000))}h ago` : "Not run yet";
const mayReturnJobs = (source: Source) => /\b(hiring|vacanc(?:y|ies)|job advert|recruitment)\b/i.test(`${source.label} ${source.value}`.replaceAll(/\bNOT\s+(?:"[^"]+"|\w+)/gi, ""));

type SourcesPageProps = {
  sources: Source[];
  reviews: CandidateReview[];
  lastRun: CollectionRunSummary | null;
  targetBrief: string;
  maxPostsPerSource: number;
  busy: boolean;
  onMenu: () => void;
  onAdd: (label: string, value: string) => Promise<unknown>;
  onSuggest: (brief: string) => Promise<{ suggestions: SearchSuggestion[] }>;
  onMaxPosts: (maxPostsPerSource: number) => Promise<unknown>;
  onRefresh: () => Promise<boolean>;
  onUpdate: (id: string, patch: Partial<Source>) => Promise<unknown>;
  onToast: (message: string) => void;
};

export function SourcesPage({ sources, reviews, lastRun, targetBrief, maxPostsPerSource, busy, onMenu, onAdd, onSuggest, onMaxPosts, onRefresh, onUpdate, onToast }: SourcesPageProps) {
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const [brief, setBrief] = useState(targetBrief);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [planning, setPlanning] = useState(false);
  const activeSources = sources.filter((source) => source.status === "active");
  const totalItems = activeSources.reduce((sum, source) => sum + source.itemCount, 0);
  const totalCost = activeSources.reduce((sum, source) => sum + source.estimatedCost, 0);
  const receiptStatus = busy ? "running" : lastRun?.aiFailedCount ? "partial" : lastRun?.status;
  const aiSucceeded = lastRun ? Math.max(0, lastRun.analyzedCount - lastRun.aiFailedCount) : 0;
  const unreviewedCount = lastRun ? Math.max(0, lastRun.prequalifiedCount - lastRun.analyzedCount) : 0;
  const maximumPosts = activeSources.length * maxPostsPerSource;

  const runCollection = async () => {
    const completed = await onRefresh();
    if (completed) onToast("Collection finished. Nothing was removed for relevance; review the receipt and ranked queue.");
  };
  const addSearch = async (name = label, value = query) => {
    if (!name.trim() || !value.trim()) return;
    try {
      await onAdd(name.trim(), value.trim());
      setLabel("");
      setQuery("");
      onToast("Search added. Run collection when you’re ready.");
    } catch { /* The shared error toast explains the API failure. */ }
  };
  const planSearches = async () => {
    if (!brief.trim()) return;
    setPlanning(true);
    try {
      const result = await onSuggest(brief.trim());
      setSuggestions(result.suggestions);
      onToast("Search suggestions are ready. Review or edit them before adding.");
    } catch {
      // The shared error toast contains the provider or schema failure.
    } finally {
      setPlanning(false);
    }
  };
  const changeMaxPosts = async (value: number) => {
    try {
      await onMaxPosts(value);
      onToast("Collection size saved for the next run.");
    } catch { /* The shared error toast explains the API failure. */ }
  };
  const updateSuggestion = (index: number, patch: Partial<SearchSuggestion>) => setSuggestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const addSuggestion = async (index: number) => {
    const suggestion = suggestions[index];
    if (!suggestion?.label.trim() || !suggestion.query.trim()) return;
    try {
      await onAdd(suggestion.label.trim(), suggestion.query.trim());
      setSuggestions((current) => current.filter((_, itemIndex) => itemIndex !== index));
      onToast("Search added. You stay in control of when it is collected.");
    } catch { /* The shared error toast explains the API failure. */ }
  };

  return <main className="page">
    <PageHeader title="Sources" subtitle="Describe your buyers, approve searches, control spend" onMenu={onMenu} action={<Button variant="primary" disabled={busy} onClick={() => void runCollection()} icon={<RefreshCw className={busy ? "spin" : ""} />}>{busy ? "Collecting…" : `Collect up to ${maximumPosts}`}</Button>} />
    <div className="summary-band"><div><Database /><span><strong>{activeSources.length}</strong> active searches</span></div><div><Clock3 /><span><strong>{totalItems}</strong> posts last collected</span></div><div><span className="currency">£</span><span><strong>${totalCost.toFixed(2)}</strong> recorded run cost</span></div><div><TriangleAlert /><span><strong>{maximumPosts}</strong> maximum posts next run</span></div></div>

    <section className="search-planner" aria-labelledby="search-planner-title">
      <div className="search-planner__heading"><span className="section-icon"><Sparkles /></span><span><h2 id="search-planner-title">Turn your target into searches</h2><p>Write who you want to find in plain English. The low-cost planning model suggests LinkedIn-compatible searches; nothing runs until you approve one.</p></span></div>
      <div className="search-planner__prompt"><label>Who do you want to find?<textarea value={brief} placeholder="e.g. UK clinic and home-services owners dealing with missed calls, scheduling and repetitive admin" onChange={(event) => setBrief(event.target.value)} /></label><Button variant="primary" disabled={busy || planning || !brief.trim()} onClick={() => void planSearches()} icon={<Sparkles className={planning ? "spin" : ""} />}>{planning ? "Planning…" : "Suggest searches"}</Button></div>
      {suggestions.length ? <div className="search-suggestions" aria-live="polite">{suggestions.map((suggestion, index) => <article key={`${suggestion.query}-${index}`}>
        <label>Search name<input value={suggestion.label} onChange={(event) => updateSuggestion(index, { label: event.target.value })} /></label>
        <label>LinkedIn search<input value={suggestion.query} onChange={(event) => updateSuggestion(index, { query: event.target.value })} /></label>
        <p>{suggestion.rationale}</p>
        <Button disabled={busy || !suggestion.label.trim() || !suggestion.query.trim()} onClick={() => void addSuggestion(index)} icon={<Plus />}>Add search</Button>
      </article>)}</div> : null}
      <details className="manual-search"><summary>Add an exact search manually</summary><div className="source-builder__fields"><label>Search name<input value={label} placeholder="e.g. Dental clinic missed calls" onChange={(event) => setLabel(event.target.value)} /></label><label>LinkedIn post search<input value={query} placeholder='e.g. "missed calls" AND (clinic OR dental)' onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addSearch(); }} /></label><Button variant="primary" disabled={busy || !label.trim() || !query.trim()} onClick={() => void addSearch()} icon={<Plus />}>Add search</Button></div></details>
    </section>

    <section className="filter-control" aria-label="Collection size"><SlidersHorizontal /><span><strong>Collection size—not a relevance filter</strong><small>Signal Desk keeps every valid post from the last seven days, ranks all of them, and shows the top queue. Unknown company details and low AI scores never delete a result.</small></span><select aria-label="Maximum posts per search" value={maxPostsPerSource} disabled={busy} onChange={(event) => void changeMaxPosts(Number(event.target.value))}><option value="5">5 per search · cheapest</option><option value="10">10 per search</option><option value="15">15 per search · recommended</option><option value="25">25 per search</option><option value="50">50 per search · highest spend</option></select></section>

    {lastRun ? <section className={`run-receipt run-receipt--${receiptStatus}`} aria-live="polite">
      <div className="run-receipt__heading">{receiptStatus === "running" ? <RefreshCw className="spin" /> : receiptStatus === "failed" || receiptStatus === "partial" ? <TriangleAlert /> : <CheckCircle2 />}<span><strong>{receiptStatus === "running" ? "Collection in progress" : receiptStatus === "failed" ? "Collection failed" : receiptStatus === "partial" ? "Collection completed with AI issues" : "Latest collection completed"}</strong><small>{receiptStatus === "running" ? "Fetching approved searches now. Counts update during the run." : receiptStatus === "partial" ? `${lastRun.aiFailedCount} of ${lastRun.analyzedCount} AI attempts failed. The receipt below shows exactly what happened.` : lastRun.error || "Every valid post was retained and ranked for review."}</small></span></div>
      <div className="run-funnel"><span><Database /><strong>{lastRun.collectedCount}</strong><small>pulled</small></span><i>→</i><span><SearchCheck /><strong>{lastRun.prequalifiedCount}</strong><small>valid 7-day posts</small></span><i>→</i><span><Sparkles /><strong>{aiSucceeded}</strong><small>AI scored</small></span><i>→</i><span><CheckCircle2 /><strong>{lastRun.itemCount}</strong><small>shown Today</small></span></div>
      {receiptStatus !== "running" ? lastRun.auditVersion >= 2 ? <div className={`run-audit${lastRun.aiFailedCount ? " run-audit--warning" : ""}`}><p><strong>No relevance rules discarded posts.</strong> Today shows the top {lastRun.itemCount} of {lastRun.prequalifiedCount} ranked posts. Any remaining posts stay visible in the decision audit below.</p><p>AI scored <strong>{aiSucceeded}</strong> posts successfully and failed on <strong>{lastRun.aiFailedCount}</strong>. {lastRun.aiFailedCount && !lastRun.itemCount ? "This older run lost its queue; new runs now keep fallback-ranked posts instead." : "Fallback ranking keeps Today usable when individual AI requests fail."} Recorded model cost: ${lastRun.cost.toFixed(4)}.</p></div> : lastRun.auditVersion === 1 ? <div className="run-audit run-audit--legacy"><p>This historical run used the old AI shortlist: <strong>{lastRun.analyzedCount}</strong> valid posts were sent to AI and <strong>{unreviewedCount}</strong> were held back.</p><p>New runs retain and rank every valid post. Historical run cost: ${lastRun.cost.toFixed(4)}.</p></div> : <div className="run-audit run-audit--legacy"><p>This historical collection predates the transparent decision audit. Run collection again to retain and rank every valid post.</p><p>Historical run cost: ${lastRun.cost.toFixed(4)}.</p></div> : null}
    </section> : null}

    {reviews.length ? <details className="decision-ledger"><summary>Inspect all {reviews.length} ranked posts <span>{lastRun?.auditVersion && lastRun.auditVersion >= 2 ? "No hidden relevance discard" : `${unreviewedCount} posts were not AI-reviewed in this historical run`}</span></summary><div className="decision-list">{reviews.map((review) => <article key={review.id}><span className={`decision-badge decision-badge--${review.decision}`}>{review.decision.replace("_", " ")}</span><span><strong>{review.author}</strong><small>{review.authorHeadline || review.company} · {review.sourceLabel}</small><p>{review.excerpt}</p><em>{review.reason}</em></span><span className="decision-score">{review.score}</span><a href={review.url} target="_blank" rel="noreferrer" aria-label={`Open ${review.author}'s post`}><ExternalLink /></a></article>)}</div></details> : null}
    {sources.some((source) => source.status === "active" && !source.lastRunAt) ? <div className="first-run-note"><RefreshCw /><span><strong>Ready for the first collection</strong><small>This search is active but has not run yet. You decide when to spend.</small></span><Button variant="primary" disabled={busy} onClick={() => void runCollection()}>{busy ? "Collecting…" : "Run first collection"}</Button></div> : null}
    <div className="source-table" role="table">
      <div className="source-head" role="row"><span>Search</span><span>Status</span><span>Cadence</span><span>Last run</span><span>Items</span><span>Est. cost</span><span /></div>
      {sources.map((source) => <div className="source-row" role="row" key={source.id}>
        <span className="source-name"><span>{source.kind === "linkedin_group" ? <UsersRound /> : <Globe2 />}</span><span><strong>{source.label}</strong><small>{source.value}</small>{mayReturnJobs(source) ? <small className="source-warning">This wording may return job adverts</small> : null}</span></span>
        <span><StatusSquare status={source.status} />{source.status}</span><span>{source.cadence}</span><span>{relative(source.lastRunAt)}</span><span>{source.itemCount}</span><span>${source.estimatedCost.toFixed(2)}</span>
        <span className="row-actions"><button title={source.status === "active" ? "Pause search" : "Activate search"} onClick={async () => { await onUpdate(source.id, { status: source.status === "active" ? "paused" : "active" }); onToast(source.status === "active" ? "Search paused." : "Search activated."); }}>{source.status === "active" ? <Pause /> : <Play />}</button></span>
      </div>)}
      {!sources.length ? <div className="empty-state"><Database /><h2>No searches added</h2><p>Describe your buyers above and approve one suggested search.</p></div> : null}
    </div>
    <div className="source-foot"><span><StatusSquare status="active" />Runs daily while this local backend is open.</span><span>Manual collection remains available at any time.</span></div>
  </main>;
}
