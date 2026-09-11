import type { AppData, ConnectionState, ContentDraft, CredentialPatch, Opportunity, ProfileGenerationResult, ProfileSection, SearchSuggestion, Settings, Source, StorageState } from "../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(payload.error ?? payload.reason ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  bootstrap: () => request<AppData>("/api/bootstrap"),
  addSource: (label: string, value: string) => request<Source>("/api/sources", { method: "POST", body: JSON.stringify({ label, value }) }),
  suggestSources: (brief: string) => request<{ suggestions: SearchSuggestion[] }>("/api/sources/suggest", { method: "POST", body: JSON.stringify({ brief }) }),
  approveSource: (id: string) => request<Source>(`/api/sources/${id}/approve`, { method: "POST" }),
  updateSource: (id: string, patch: Partial<Source>) => request<Source>(`/api/sources/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  refresh: () => request<{ accepted: boolean; runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ trigger: "manual" }) }),
  updateOpportunity: (id: string, patch: Partial<Opportunity>) => request<Opportunity>(`/api/opportunities/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  modifyOpportunity: (id: string, modifier: string) => request<Opportunity>(`/api/opportunities/${id}/regenerate`, { method: "POST", body: JSON.stringify({ modifier }) }),
  updateContent: (id: string, patch: Partial<ContentDraft>) => request<ContentDraft>(`/api/content/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  modifyContent: (id: string, modifier: string) => request<ContentDraft>(`/api/content/${id}/regenerate`, { method: "POST", body: JSON.stringify({ modifier }) }),
  updateProfile: (id: string, patch: Partial<ProfileSection> & { saveVersion?: boolean }) => request<ProfileSection>(`/api/profile/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  modifyProfile: (id: string, modifier: string) => request<ProfileSection>(`/api/profile/${id}/regenerate`, { method: "POST", body: JSON.stringify({ modifier }) }),
  generateProfile: (brief: string) => request<ProfileGenerationResult>("/api/profile/generate", { method: "POST", body: JSON.stringify({ brief }) }),
  updateSettings: (patch: Partial<Settings>) => request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),
  updateCredentials: (patch: CredentialPatch) => request<ConnectionState>("/api/settings/credentials", { method: "PUT", body: JSON.stringify(patch) }),
  saveJsonSnapshot: () => request<StorageState>("/api/storage/snapshot", { method: "POST" }),
};
