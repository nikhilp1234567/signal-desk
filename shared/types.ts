export type Workspace = "today" | "sources" | "content" | "profile" | "settings";
export type SourceKind = "public_search" | "linkedin_group";
export type SourceStatus = "pending" | "active" | "paused" | "error";
export type OpportunityStatus = "new" | "saved" | "replied" | "dismissed";
export type EvidenceConfidence = "verified" | "likely" | "unknown";

export interface Source {
  id: string;
  kind: SourceKind;
  label: string;
  value: string;
  status: SourceStatus;
  cadence: "daily" | "manual";
  lastRunAt: string | null;
  itemCount: number;
  estimatedCost: number;
  error: string | null;
  suggested?: boolean;
  description?: string;
  memberCount?: number;
}

export interface CompanyMatch {
  companyName: string;
  companyNumber?: string;
  status?: string;
  dateOfCreation?: string;
  ageYears?: number;
  ukCompany: boolean;
  founderLed: EvidenceConfidence;
  ageConfidence: EvidenceConfidence;
  matchConfidence: number;
}

export interface Opportunity {
  id: string;
  postId: string;
  url: string;
  author: string;
  authorHeadline: string;
  company: string;
  avatar?: string;
  authorProfileUrl?: string;
  industry?: string;
  location?: string;
  postedAt: string;
  ageLabel: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: SourceKind;
  excerpt: string;
  content: string;
  score: number;
  scoreBreakdown: {
    icpFit: number;
    problemRelevance: number;
    openness: number;
    freshness: number;
    evidence: number;
  };
  fitReasons: string[];
  conversationAngle: string;
  draftReply: string;
  riskFlags: string[];
  contentIdea: string;
  status: OpportunityStatus;
  companyMatch: CompanyMatch;
}

export type ContentPillar = "Systems" | "Education" | "Proof" | "Opinion" | "Framework";
export type DraftStatus = "Ready" | "Draft" | "Outline" | "Idea";

export interface ContentDraft {
  id: string;
  day: string;
  date: string;
  title: string;
  pillar: ContentPillar;
  status: DraftStatus;
  hook: string;
  body: string;
}

export interface ContentIdea {
  id: string;
  title: string;
  source: string;
  ageLabel: string;
}

export interface ProfileSection {
  id: string;
  label: string;
  status: "Ready" | "Needs edit" | "Draft" | "Missing";
  summary: string;
  guidance: string;
  current: string;
  suggested: string;
  checks: string[];
}

export interface Settings {
  profileBrief: string;
  icpBrief: string;
  offer: string;
  proofPoints: string;
  bannedPhrases: string;
  voiceSamples: string[];
  refreshTime: string;
  dailyTarget: number;
  candidateLimit: number;
  maxPostsPerSource: number;
  filterMode: "broad" | "balanced" | "strict";
  analysisModel: string;
  writingModel: string;
  jsonPersistence: boolean;
}

export interface ProfileGenerationResult {
  sections: ProfileSection[];
  settings: Settings;
}

export interface SearchSuggestion {
  label: string;
  query: string;
  rationale: string;
}

export interface CredentialPatch {
  apifyToken?: string | null;
  openrouterKey?: string | null;
  companiesHouseKey?: string | null;
}

export interface ConnectionState {
  apify: boolean;
  openrouter: boolean;
  companiesHouse: boolean;
  sources: {
    apify: "local" | "environment" | "none";
    openrouter: "local" | "environment" | "none";
    companiesHouse: "local" | "environment" | "none";
  };
}

export interface StorageState {
  sqlite: boolean;
  sqlitePath: string | null;
  json: boolean;
  jsonPath: string | null;
  lastJsonSavedAt: string | null;
  jsonError: string | null;
}

export interface AppData {
  setupRequired: boolean;
  connections: ConnectionState;
  storage: StorageState;
  opportunities: Opportunity[];
  sources: Source[];
  suggestions: Source[];
  contentDrafts: ContentDraft[];
  contentIdeas: ContentIdea[];
  profileSections: ProfileSection[];
  settings: Settings;
  lastRun: CollectionRunSummary | null;
  candidateReviews: CandidateReview[];
}

export interface CollectionRunSummary {
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  itemCount: number;
  collectedCount: number;
  uniqueCount: number;
  prequalifiedCount: number;
  analyzedCount: number;
  aiFailedCount: number;
  filteredCount: number;
  strongCount: number;
  possibleCount: number;
  suppressedCount: number;
  belowThresholdCount: number;
  filterMode: "broad" | "balanced" | "strict";
  threshold: number;
  auditVersion: number;
  error: string | null;
  cost: number;
}

export interface CandidateReview {
  id: string;
  runId: string;
  author: string;
  authorHeadline: string;
  company: string;
  sourceLabel: string;
  url: string;
  excerpt: string;
  score: number;
  decision: "shown" | "skipped" | "below_threshold" | "queue_limit" | "ai_failed";
  reason: string;
  riskFlags: string[];
}
