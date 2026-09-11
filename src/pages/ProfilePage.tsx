import { useEffect, useState } from "react";
import { Check, Copy, FileText, Info, Save, Sparkles } from "lucide-react";
import type { ProfileSection, Settings } from "../../shared/types";
import { Button, copyText } from "../components/Ui";
import { PageHeader } from "../components/PageHeader";

type ProfilePageProps = {
  sections: ProfileSection[];
  settings: Settings;
  busy: boolean;
  onMenu: () => void;
  onGenerate: (brief: string) => Promise<unknown>;
  onUpdate: (id: string, patch: Partial<ProfileSection> & { saveVersion?: boolean }) => Promise<unknown>;
  onToast: (message: string) => void;
};

export function ProfilePage({ sections, settings, busy, onMenu, onGenerate, onUpdate, onToast }: ProfilePageProps) {
  const [brief, setBrief] = useState(settings.profileBrief);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(sections.map((section) => [section.id, section.suggested])));
  useEffect(() => setBrief(settings.profileBrief), [settings.profileBrief]);
  useEffect(() => setDrafts(Object.fromEntries(sections.map((section) => [section.id, section.suggested]))), [sections]);
  const hasProfile = sections.some((section) => section.suggested.trim());

  const generate = async () => {
    try {
      await onGenerate(brief.trim());
      onToast("Profile generated. Your ICP, offer and proof context were updated too.");
    } catch { /* The shared error toast explains the provider failure. */ }
  };
  const copyAll = async () => {
    const text = sections.map((section) => `${section.label}\n${drafts[section.id] || section.suggested}`).join("\n\n");
    await copyText(text);
    onToast("Complete profile draft copied.");
  };

  return <main className="page profile-builder-page">
    <PageHeader title="Build your LinkedIn profile" subtitle="Give Signal Desk the rough truth. AI will organise it without inventing proof." onMenu={onMenu} />
    <section className="profile-brief-card">
      <div className="profile-brief-card__heading"><span className="section-icon"><Sparkles /></span><span><h2>Tell us what you know</h2><p>Write this like notes to a colleague. Include what you do, who you want to help, the problems you solve, any real proof or experience, your preferred tone, and how people should contact you. It does not need to be polished.</p></span></div>
      <label>Your business and profile brief<textarea aria-label="Your business and profile brief" value={brief} placeholder="For example: I build AI receptionists and practical automations for UK clinics and home-service businesses. I want to reduce missed calls and repetitive admin. My tone is direct and useful. I don't have case-study metrics yet, so don't invent any…" onChange={(event) => setBrief(event.target.value)} /><span>{brief.length.toLocaleString()} / 10,000</span></label>
      <div className="profile-brief-card__actions"><Button variant="primary" disabled={busy || brief.trim().length < 20} icon={<Sparkles />} onClick={() => void generate()}>{busy ? "Building profile…" : hasProfile ? "Regenerate profile" : "Build my profile"}</Button><small>This also fills the ICP, offer and proof fields used to rank posts. You can fine-tune them later in Settings.</small></div>
    </section>

    {hasProfile ? <section className="profile-results">
      <div className="profile-results__heading"><span><Check /><span><strong>Your profile draft</strong><small>Review every section, edit anything you want, then copy it into LinkedIn manually.</small></span></span><Button icon={<Copy />} onClick={() => void copyAll()}>Copy all</Button></div>
      <div className="profile-result-grid">{sections.map((section) => <article className={`profile-result-card profile-result-card--${section.id}`} key={section.id}>
        <div><span><FileText /></span><span><h3>{section.label}</h3><p>{section.guidance}</p></span></div>
        <textarea aria-label={`${section.label} draft`} value={drafts[section.id] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [section.id]: event.target.value }))} />
        <footer><span>{(drafts[section.id] ?? "").length.toLocaleString()} characters</span><span><Button variant="text" icon={<Copy />} onClick={async () => { await copyText(drafts[section.id] ?? ""); onToast(`${section.label} copied.`); }}>Copy</Button><Button variant="text" icon={<Save />} onClick={async () => { await onUpdate(section.id, { suggested: drafts[section.id] ?? "", status: "Draft", saveVersion: true }); onToast(`${section.label} saved locally.`); }}>Save</Button></span></footer>
      </article>)}</div>
      <div className="manual-note"><Info /><span>Signal Desk prepares the copy only. You remain in control of every LinkedIn profile change.</span></div>
    </section> : <section className="profile-empty"><FileText /><h2>No checklist. No missing-field hunt.</h2><p>One useful description is enough to create your first complete draft. You can regenerate it whenever your offer changes.</p></section>}
  </main>;
}
