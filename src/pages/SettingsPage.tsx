import { useEffect, useState } from "react";
import { Check, Clock3, Database, HardDrive, KeyRound, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { ConnectionState, CredentialPatch, Settings, StorageState } from "../../shared/types";
import { Button, StatusSquare } from "../components/Ui";
import { PageHeader } from "../components/PageHeader";

type CredentialKey = keyof CredentialPatch;

function CredentialField({ label, description, value, configured, source, onChange, onClear }: { label: string; description: string; value: string; configured: boolean; source: "local" | "environment" | "none"; onChange: (value: string) => void; onClear: () => void }) {
  return <div className="credential-field">
    <div className="credential-field__title"><span><strong>{label}</strong><small>{description}</small></span><span><StatusSquare status={configured ? "active" : "paused"} />{configured ? `Connected via ${source}` : "Not configured"}</span></div>
    <div className="credential-field__control">
      <input type="password" autoComplete="new-password" spellCheck={false} value={value} placeholder={configured ? "Saved key — enter a new value to replace it" : "Paste API key"} onChange={(event) => onChange(event.target.value)} aria-label={`${label} API key`} />
      {source === "local" ? <Button variant="text" type="button" onClick={onClear}>Remove local key</Button> : null}
    </div>
  </div>;
}

export function SettingsPage({ settings, connections, storage, busy, onMenu, onSave, onSaveCredentials, onSaveSnapshot, onToast }: { settings: Settings; connections: ConnectionState; storage: StorageState; busy: boolean; onMenu: () => void; onSave: (patch: Partial<Settings>) => Promise<unknown>; onSaveCredentials: (patch: CredentialPatch) => Promise<unknown>; onSaveSnapshot: () => Promise<unknown>; onToast: (message: string) => void }) {
  const [form, setForm] = useState(settings);
  const [tab, setTab] = useState<"brief" | "connections">("brief");
  const [credentials, setCredentials] = useState<Record<CredentialKey, string>>({ apifyToken: "", openrouterKey: "", companiesHouseKey: "" });
  useEffect(() => setForm(settings), [settings]);

  const updateSample = (index: number, value: string) => setForm((current) => ({ ...current, voiceSamples: current.voiceSamples.map((sample, sampleIndex) => sampleIndex === index ? value : sample) }));
  const saveGeneral = async () => { await onSave(form); onToast("Settings saved. New drafts will use this voice brief."); };
  const saveConnections = async () => {
    const patch = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])) as CredentialPatch;
    if (Object.keys(patch).length) await onSaveCredentials(patch);
    await onSave({ analysisModel: form.analysisModel, writingModel: form.writingModel, jsonPersistence: form.jsonPersistence });
    setCredentials({ apifyToken: "", openrouterKey: "", companiesHouseKey: "" });
    onToast("Connections and local storage settings saved.");
  };
  const clearCredential = async (key: CredentialKey) => { await onSaveCredentials({ [key]: null }); onToast("Local key removed."); };
  const updateCredential = (key: CredentialKey, value: string) => setCredentials((current) => ({ ...current, [key]: value }));

  return <main className="page settings-page">
    <PageHeader title="Settings" subtitle="Your market, voice, connections and local storage" onMenu={onMenu} action={<Button variant="primary" disabled={busy} icon={<Save />} onClick={() => void (tab === "brief" ? saveGeneral() : saveConnections())}>{tab === "brief" ? "Save settings" : "Save connections"}</Button>} />
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      <button role="tab" aria-selected={tab === "brief"} className={tab === "brief" ? "active" : ""} onClick={() => setTab("brief")}>Brief & voice</button>
      <button role="tab" aria-selected={tab === "connections"} className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}>Connections & storage</button>
    </div>

    {tab === "brief" ? <div className="settings-grid">
      <section><div className="settings-heading"><h2>Positioning brief</h2><p>The context used to qualify opportunities and shape useful drafts.</p></div><label>Ideal customer profile<textarea value={form.icpBrief} onChange={(event) => setForm({ ...form, icpBrief: event.target.value })} /></label><label>Offer context<textarea value={form.offer} onChange={(event) => setForm({ ...form, offer: event.target.value })} /></label><label>Proof points<textarea value={form.proofPoints} onChange={(event) => setForm({ ...form, proofPoints: event.target.value })} /></label><label>Banned phrases<input value={form.bannedPhrases} onChange={(event) => setForm({ ...form, bannedPhrases: event.target.value })} /></label></section>
      <section><div className="settings-heading"><h2>Writing voice</h2><p>Five to ten real lines create a more authentic starting point.</p></div><div className="voice-list">{form.voiceSamples.map((sample, index) => <div key={index}><span>{String(index + 1).padStart(2, "0")}</span><textarea value={sample} onChange={(event) => updateSample(index, event.target.value)} /><button aria-label="Remove sample" onClick={() => setForm({ ...form, voiceSamples: form.voiceSamples.filter((_, sampleIndex) => sampleIndex !== index) })}><Trash2 /></button></div>)}</div>{form.voiceSamples.length < 10 ? <Button icon={<Plus />} onClick={() => setForm({ ...form, voiceSamples: [...form.voiceSamples, ""] })}>Add voice sample</Button> : null}</section>
      <section className="schedule-settings"><div className="settings-heading"><h2>Daily rhythm and spend</h2><p>Keep each collection small until the searches prove useful. No relevance score removes a valid post.</p></div><div className="inline-fields"><label>Refresh time<input type="time" value={form.refreshTime} onChange={(event) => setForm({ ...form, refreshTime: event.target.value })} /></label><label>Reply target<input type="number" min="1" max="10" value={form.dailyTarget} onChange={(event) => setForm({ ...form, dailyTarget: Number(event.target.value) })} /></label><label>Today queue<input type="number" min="5" max="50" value={form.candidateLimit} onChange={(event) => setForm({ ...form, candidateLimit: Number(event.target.value) })} /></label><label>Posts per search<input type="number" min="5" max="50" value={form.maxPostsPerSource} onChange={(event) => setForm({ ...form, maxPostsPerSource: Number(event.target.value) })} /></label></div><div className="schedule-note"><Clock3 /><span>Next local refresh at <strong>{form.refreshTime}</strong>. Manual collection is always available.</span></div></section>
      <section className="connections-settings"><div className="settings-heading"><h2>Connection summary</h2><p>All three services are required before collection can run.</p></div><div className="connection-rows"><div><KeyRound /><span><strong>Apify</strong><small>Post and group discovery</small></span><span><StatusSquare status={connections.apify ? "active" : "paused"} />{connections.apify ? "Connected" : "Key required"}</span></div><div><KeyRound /><span><strong>OpenRouter</strong><small>Structured scoring and drafts</small></span><span><StatusSquare status={connections.openrouter ? "active" : "paused"} />{connections.openrouter ? "Connected" : "Key required"}</span></div><div><KeyRound /><span><strong>Companies House</strong><small>UK company age and officer evidence</small></span><span><StatusSquare status={connections.companiesHouse ? "active" : "paused"} />{connections.companiesHouse ? "Connected" : "Key required"}</span></div></div><div className="mode-note"><ShieldCheck /><span><strong>{connections.apify && connections.openrouter && connections.companiesHouse ? "API connections ready" : "Setup required"}</strong><small>No endpoint can publish, comment, connect, message or modify LinkedIn.</small></span><Check /></div></section>
    </div> : <div className="settings-grid settings-grid--connections">
      <section className="credentials-settings"><div className="settings-heading"><h2>API keys</h2><p>Keys are submitted only to the local backend and saved in <code>data/secrets.json</code> with owner-only permissions. Saved values are never returned to this page.</p></div>
        <CredentialField label="OpenRouter" description="AI scoring and structured drafts" value={credentials.openrouterKey} configured={connections.openrouter} source={connections.sources.openrouter} onChange={(value) => updateCredential("openrouterKey", value)} onClear={() => void clearCredential("openrouterKey")} />
        <CredentialField label="Apify" description="Public post and group collection" value={credentials.apifyToken} configured={connections.apify} source={connections.sources.apify} onChange={(value) => updateCredential("apifyToken", value)} onClear={() => void clearCredential("apifyToken")} />
        <CredentialField label="Companies House" description="UK company verification" value={credentials.companiesHouseKey} configured={connections.companiesHouse} source={connections.sources.companiesHouse} onChange={(value) => updateCredential("companiesHouseKey", value)} onClear={() => void clearCredential("companiesHouseKey")} />
      </section>
      <section className="provider-settings"><div className="settings-heading"><h2>AI routing</h2><p>OpenRouter uses a fast, ultra-low-cost model for the high-volume work and a newer GA model for longer writing. Both remain editable.</p></div><label>Ranking, replies and search planning<input value={form.analysisModel} onChange={(event) => setForm({ ...form, analysisModel: event.target.value })} placeholder="inception/mercury-2.5-preview" /></label><label>Profile and longer writing<input value={form.writingModel} onChange={(event) => setForm({ ...form, writingModel: event.target.value })} placeholder="deepseek/deepseek-v4-flash-0731" /></label><div className="provider-note"><KeyRound /><span><strong>Task-specific low-cost routing</strong><small>Mercury runs without paid reasoning tokens and with strict output caps. DeepSeek 0731 handles the smaller writing workload.</small></span></div></section>
      <section className="storage-settings"><div className="settings-heading"><h2>Local persistence</h2><p>SQLite remains the durable source of truth. A readable JSON snapshot is updated automatically after local changes.</p></div><label className="toggle-row"><input type="checkbox" checked={form.jsonPersistence} onChange={(event) => setForm({ ...form, jsonPersistence: event.target.checked })} /><span><strong>Keep JSON snapshot in sync</strong><small>{storage.jsonPath ?? "JSON storage unavailable"}</small></span></label><div className="storage-rows"><div><Database /><span><strong>SQLite database</strong><small>{storage.sqlitePath ?? "In-memory database"}</small></span><StatusSquare status={storage.sqlite ? "active" : "paused"} /></div><div><HardDrive /><span><strong>JSON snapshot</strong><small>{storage.lastJsonSavedAt ? `Last saved ${new Date(storage.lastJsonSavedAt).toLocaleString()}` : storage.json ? "Ready to save" : "Disabled"}</small></span><StatusSquare status={storage.jsonError ? "error" : storage.json ? "active" : "paused"} /></div></div>{storage.jsonError ? <p className="storage-error">{storage.jsonError}</p> : null}<Button disabled={busy || !settings.jsonPersistence} icon={<Save />} onClick={() => void onSaveSnapshot().then(() => onToast("JSON snapshot saved locally."))}>Save snapshot now</Button></section>
      <section className="security-settings"><div className="settings-heading"><h2>Local-only boundary</h2><p>Credentials and snapshots remain on this machine.</p></div><div className="mode-note"><ShieldCheck /><span><strong>Manual engagement only</strong><small>Signal Desk cannot publish, comment, connect, message or modify LinkedIn.</small></span><Check /></div></section>
    </div>}
  </main>;
}
