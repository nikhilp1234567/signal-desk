import { useEffect, useState } from "react";
import type { CredentialPatch, Workspace } from "../shared/types";
import { Sidebar } from "./components/Sidebar";
import { SetupModal } from "./components/SetupModal";
import { Toast } from "./components/Toast";
import { useSignalDesk } from "./hooks/useSignalDesk";
import { ContentPage } from "./pages/ContentPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { TodayPage } from "./pages/TodayPage";

const workspaces: Workspace[] = ["today", "sources", "content", "profile", "settings"];
const initialWorkspace = (): Workspace => {
  const hash = window.location.hash.replace("#", "");
  if (hash === "discover") return "sources";
  const value = hash as Workspace;
  return workspaces.includes(value) ? value : "today";
};

export function App() {
  const desk = useSignalDesk();
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [navOpen, setNavOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { window.history.replaceState(null, "", `#${workspace}`); }, [workspace]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3600); return () => window.clearTimeout(timer); }, [toast]);

  if (!desk.data) return <div className="loading-screen"><span className="loading-mark"><i /><i /><i /><i /></span><p>{desk.error ?? "Preparing today’s signals…"}</p></div>;
  const data = desk.data;
  const common = { onMenu: () => setNavOpen(true) };
  const finishSetup = async (patch: CredentialPatch) => {
    await desk.updateCredentials(patch);
    setWorkspace("sources");
    setToast("Connections saved. Add your first source to start collecting signals.");
  };
  let page;
  switch (workspace) {
    case "today": page = <TodayPage {...common} opportunities={data.opportunities} lastRun={data.lastRun} busy={desk.busy} onRefresh={desk.refresh} onUpdate={desk.updateOpportunity} onModify={desk.modifyOpportunity} onSources={() => setWorkspace("sources")} onToast={setToast} />; break;
    case "sources": page = <SourcesPage {...common} sources={data.sources} reviews={data.candidateReviews ?? []} lastRun={data.lastRun} targetBrief={data.settings.icpBrief} maxPostsPerSource={data.settings.maxPostsPerSource} busy={desk.busy} onAdd={desk.addSource} onSuggest={desk.suggestSources} onMaxPosts={(maxPostsPerSource) => desk.updateSettings({ maxPostsPerSource })} onRefresh={desk.refresh} onUpdate={desk.updateSource} onToast={setToast} />; break;
    case "content": page = <ContentPage {...common} drafts={data.contentDrafts} ideas={data.contentIdeas} busy={desk.busy} onUpdate={desk.updateContent} onModify={desk.modifyContent} onToast={setToast} />; break;
    case "profile": page = <ProfilePage {...common} sections={data.profileSections} settings={data.settings} busy={desk.busy} onGenerate={desk.generateProfile} onUpdate={desk.updateProfile} onToast={setToast} />; break;
    case "settings": page = <SettingsPage {...common} settings={data.settings} connections={data.connections} storage={data.storage} busy={desk.busy} onSave={desk.updateSettings} onSaveCredentials={desk.updateCredentials} onSaveSnapshot={desk.saveJsonSnapshot} onToast={setToast} />; break;
  }
  return <div className="app-shell">
    <Sidebar workspace={workspace} sources={data.sources} ready={!data.setupRequired} open={navOpen} onNavigate={setWorkspace} onClose={() => setNavOpen(false)} />
    {navOpen ? <button className="nav-scrim" onClick={() => setNavOpen(false)} aria-label="Close navigation" /> : null}
    <div className="app-content">{page}</div>
    {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    {desk.error ? <Toast message={desk.error} kind="error" onClose={desk.clearError} /> : null}
    {data.setupRequired ? <SetupModal connections={data.connections} busy={desk.busy} onSave={finishSetup} /> : null}
  </div>;
}
