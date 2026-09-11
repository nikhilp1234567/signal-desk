import { useCallback, useEffect, useState } from "react";
import type { AppData, ContentDraft, CredentialPatch, Opportunity, ProfileSection, Settings, Source } from "../../shared/types";
import { api } from "../api";

export function useSignalDesk() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.bootstrap()); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load Signal Desk."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async <T,>(action: () => Promise<T>, apply?: (value: T, current: AppData) => AppData) => {
    setBusy(true);
    try {
      const value = await action();
      if (apply) setData((current) => current ? apply(value, current) : current);
      setError(null);
      return value;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That action could not be completed.");
      throw reason;
    } finally { setBusy(false); }
  }, []);

  const replaceOpportunity = (item: Opportunity, current: AppData): AppData => ({ ...current, opportunities: current.opportunities.map((candidate) => candidate.id === item.id ? item : candidate) });
  const replaceSource = (item: Source, current: AppData): AppData => ({ ...current, sources: current.sources.map((source) => source.id === item.id ? item : source) });
  const replaceDraft = (item: ContentDraft, current: AppData): AppData => ({ ...current, contentDrafts: current.contentDrafts.map((draft) => draft.id === item.id ? item : draft) });
  const replaceProfile = (item: ProfileSection, current: AppData): AppData => ({ ...current, profileSections: current.profileSections.map((section) => section.id === item.id ? item : section) });

  return {
    data, error, busy, reload: load,
    approveSource: (id: string) => run(() => api.approveSource(id), (item, current) => ({ ...current, suggestions: current.suggestions.filter((source) => source.id !== item.id), sources: [...current.sources, item] })),
    addSource: (label: string, value: string) => run(() => api.addSource(label, value), (item, current) => ({ ...current, sources: [...current.sources, item] })),
    suggestSources: (brief: string) => run(() => api.suggestSources(brief)),
    updateSource: (id: string, patch: Partial<Source>) => run(() => api.updateSource(id, patch), replaceSource),
    refresh: async () => {
      setBusy(true);
      try {
        await api.refresh();
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          const next = await api.bootstrap();
          setData(next);
          if (!next.lastRun || ["running", "queued"].includes(next.lastRun.status)) continue;
          if (next.lastRun.status === "failed") throw new Error("Collection failed. Check the source error on the Sources page.");
          setError(null);
          return true;
        }
        throw new Error("Collection is still running. Signal Desk will keep the run in local history; check Sources again shortly.");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Collection could not be completed.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    updateOpportunity: (id: string, patch: Partial<Opportunity>) => run(() => api.updateOpportunity(id, patch), replaceOpportunity),
    modifyOpportunity: (id: string, modifier: string) => run(() => api.modifyOpportunity(id, modifier), replaceOpportunity),
    updateContent: (id: string, patch: Partial<ContentDraft>) => run(() => api.updateContent(id, patch), replaceDraft),
    modifyContent: (id: string, modifier: string) => run(() => api.modifyContent(id, modifier), replaceDraft),
    updateProfile: (id: string, patch: Partial<ProfileSection> & { saveVersion?: boolean }) => run(() => api.updateProfile(id, patch), replaceProfile),
    modifyProfile: (id: string, modifier: string) => run(() => api.modifyProfile(id, modifier), replaceProfile),
    generateProfile: (brief: string) => run(() => api.generateProfile(brief), (result, current) => ({ ...current, profileSections: result.sections, settings: result.settings })),
    updateSettings: (patch: Partial<Settings>) => run(() => api.updateSettings(patch), (settings, current) => ({ ...current, settings, storage: { ...current.storage, json: settings.jsonPersistence } })),
    updateCredentials: (patch: CredentialPatch) => run(() => api.updateCredentials(patch), (connections, current) => ({ ...current, connections, setupRequired: !(connections.apify && connections.openrouter && connections.companiesHouse) })),
    saveJsonSnapshot: () => run(api.saveJsonSnapshot, (storage, current) => ({ ...current, storage })),
    clearError: () => setError(null),
  };
}
