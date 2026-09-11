import type { Source } from "../../shared/types.js";
import type { NormalizedPost } from "../services/scoring.js";

type AnyRecord = Record<string, any>;

export const PUBLIC_POST_ACTOR = "harvestapi~linkedin-post-search";
export const GROUP_POST_ACTOR = "unseenuser~linkedin-groups-scraper";
export const PROFILE_ACTOR = "harvestapi~linkedin-profile-scraper";

const founderCompanyPatterns = [
  /\b(?:co-?founder|founder|owner|managing director|agency director|ceo)\b[^|•\n]{0,28}?\b(?:at|of)\s+([^|•,\n]+)/i,
  /\b(?:co-?founder|founder|owner|managing partner|managing director|agency director|ceo)\s*[,·@]\s*([^|•,\n]+)/i,
  /\b(?:co-?founder|founder)\s+([A-Z][^|•,\n]{1,60})/,
];

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizedDate(item: AnyRecord) {
  const posted = item.postedAt;
  const direct = textValue(posted) ?? textValue(item.publishedAt) ?? textValue(item.createdAt);
  if (direct) {
    const date = new Date(direct);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const nested = textValue(posted?.date);
  if (nested) {
    const date = new Date(nested);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const timestamp = posted?.timestamp ?? item.timestamp;
  if (typeof timestamp === "number" || (typeof timestamp === "string" && /^\d+$/.test(timestamp))) {
    const numeric = Number(timestamp);
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function companyFromEvidence(item: AnyRecord, headline: string) {
  const explicit = textValue(item.author?.companyName) ?? textValue(item.author?.company?.name) ?? textValue(item.companyName) ?? textValue(item.company?.name) ?? textValue(item.company);
  if (explicit) return explicit;
  if (item.author?.type === "company") return textValue(item.author?.name) ?? "Unknown company";
  for (const pattern of founderCompanyPatterns) {
    const match = headline.match(pattern)?.[1]?.trim();
    if (match) return match;
  }
  return "Unknown company";
}

function canonicalProfileUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch { return value.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase(); }
}

export interface ProfileEnrichment {
  authorProfileUrl: string;
  authorHeadline?: string;
  avatar?: string;
  company?: string;
  industry?: string;
  location?: string;
}

export function normalizeProfile(item: AnyRecord): ProfileEnrichment | null {
  const authorProfileUrl = textValue(item.linkedinUrl) ?? textValue(item.url) ?? textValue(item.query?.url) ?? textValue(item.query);
  if (!authorProfileUrl) return null;
  const current = Array.isArray(item.currentPosition) ? item.currentPosition[0] : item.currentPosition;
  const experience = Array.isArray(item.experience) ? item.experience.find((entry: AnyRecord) => entry?.endDate?.text === "Present") ?? item.experience[0] : undefined;
  return {
    authorProfileUrl,
    authorHeadline: textValue(item.headline) ?? textValue(item.position),
    avatar: textValue(item.photo) ?? textValue(item.avatar),
    company: textValue(current?.companyName) ?? textValue(experience?.companyName),
    industry: textValue(item.industryName) ?? textValue(item.industry),
    location: textValue(item.location?.parsed?.text) ?? textValue(item.location?.linkedinText) ?? textValue(item.location),
  };
}

export function normalizePublicPost(item: AnyRecord, source: Source): NormalizedPost | null {
  const content = item.content ?? item.text ?? item.postText ?? item.commentary?.text;
  const url = item.url ?? item.postUrl ?? item.linkedinUrl;
  if (!content || !url) return null;
  const author = item.author?.name ?? item.authorName ?? item.user?.name ?? "Unknown author";
  const authorHeadline = textValue(item.author?.info) ?? textValue(item.author?.headline) ?? textValue(item.authorHeadline) ?? textValue(item.user?.headline) ?? "";
  const postedAt = normalizedDate(item);
  if (!postedAt) return null;
  return {
    schemaVersion: 3, id: String(item.postId ?? item.id ?? item.urn ?? url), url: String(url), author: String(author),
    authorHeadline, company: companyFromEvidence(item, authorHeadline),
    avatar: textValue(item.author?.avatar?.url) ?? textValue(item.author?.picture?.url) ?? textValue(item.author?.pictureUrl) ?? textValue(item.avatarUrl),
    authorProfileUrl: textValue(item.author?.linkedinUrl) ?? textValue(item.author?.url) ?? textValue(item.authorUrl),
    industry: textValue(item.author?.industry) ?? textValue(item.industry) ?? textValue(item.user?.industry),
    content: String(content), postedAt, sourceLabel: source.label, sourceKind: "public_search",
  };
}

export function normalizeGroupPost(item: AnyRecord, source: Source): NormalizedPost | null {
  const normalized = normalizePublicPost(item, source);
  return normalized ? { ...normalized, sourceKind: "linkedin_group" } : null;
}

export class ApifyClient {
  constructor(private readonly token: string, private readonly maxChargeUsd = 2, private readonly fetcher: typeof fetch = fetch) {}

  private async request(path: string, init?: RequestInit) {
    const response = await this.fetcher(`https://api.apify.com/v2${path}`, { ...init, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...init?.headers }, signal: init?.signal ?? AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Apify request failed (${response.status})`);
    return response.json() as Promise<AnyRecord>;
  }

  private async runActor(actor: string, input: AnyRecord, chargeCap = this.maxChargeUsd): Promise<{ items: AnyRecord[]; cost: number }> {
    const started = await this.request(`/actors/${actor}/runs?maxTotalChargeUsd=${chargeCap}`, { method: "POST", body: JSON.stringify(input) });
    const runId = String(started.data?.id ?? started.id);
    if (!runId || runId === "undefined") throw new Error("Apify did not return a run id");
    let run = started.data ?? started;
    for (let attempt = 0; attempt < 90 && ["READY", "RUNNING"].includes(run.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const checked = await this.request(`/actor-runs/${runId}`);
      run = checked.data ?? checked;
    }
    if (run.status !== "SUCCEEDED") throw new Error(`Apify actor ended with ${run.status ?? "unknown status"}`);
    const response = await this.request(`/datasets/${run.defaultDatasetId}/items?clean=true&limit=1000`);
    const items = Array.isArray(response) ? response : response.items ?? response.data?.items ?? [];
    return { items, cost: Number(run.usageTotalUsd ?? 0) };
  }

  async runSource(source: Source, maxPosts = 15): Promise<{ items: AnyRecord[]; cost: number }> {
    const actor = source.kind === "public_search" ? PUBLIC_POST_ACTOR : GROUP_POST_ACTOR;
    const input = source.kind === "public_search"
      ? { searchQueries: [source.value], postedLimit: "week", sortBy: "date", maxPosts, scrapeComments: false, scrapeReactions: false }
      : { mode: "group_posts", groupInputs: [source.value], maxPostsPerGroup: maxPosts, sortBy: "date", timeWindow: "week", extractMembers: false };
    return this.runActor(actor, input);
  }

  async enrichProfiles(profileUrls: string[]) {
    const unique = [...new Set(profileUrls.filter(Boolean).map(canonicalProfileUrl))];
    if (!unique.length) return { profiles: new Map<string, ProfileEnrichment>(), cost: 0 };
    const result = await this.runActor(PROFILE_ACTOR, { profileScraperMode: "Profile details no email ($4 per 1k)", queries: unique }, Math.min(this.maxChargeUsd, Math.max(0.05, unique.length * 0.01)));
    const profiles = new Map<string, ProfileEnrichment>();
    result.items.forEach((item) => {
      const profile = normalizeProfile(item);
      if (profile) profiles.set(canonicalProfileUrl(profile.authorProfileUrl), profile);
    });
    return { profiles, cost: result.cost };
  }
}
