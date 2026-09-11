import { createHash } from "node:crypto";
import type { Opportunity, SourceKind } from "../../shared/types.js";

export interface NormalizedPost {
  schemaVersion: 3;
  id: string;
  url: string;
  author: string;
  authorHeadline: string;
  company: string;
  avatar?: string;
  authorProfileUrl?: string;
  industry?: string;
  location?: string;
  content: string;
  postedAt: string;
  sourceLabel: string;
  sourceKind: SourceKind;
}

const questionPattern = /\?|\b(curious|how do you|what are|has anyone|looking for)\b/i;
const operatorPattern = /\b(founder|co-founder|owner|managing director|managing partner|practice manager|clinic manager|operations manager)\b/i;

export function relativeAgeLabel(postedAt: string, now = new Date()) {
  const timestamp = new Date(postedAt).getTime();
  if (Number.isNaN(timestamp)) return "Date unavailable";
  const minutes = Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function contentHash(content: string) {
  return createHash("sha256").update(content.trim().toLowerCase().replaceAll(/\s+/g, " ")).digest("hex");
}

export function canonicalLinkedInUrl(url: string) {
  try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, ""); }
  catch { return url.split("?")[0].replace(/\/$/, ""); }
}

export function isAtLeastTwoYears(dateOfCreation: string, now = new Date()) {
  const created = new Date(`${dateOfCreation}T00:00:00Z`);
  if (Number.isNaN(created.getTime())) return false;
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  return created <= cutoff;
}

export function scorePost(post: NormalizedPost, evidence = 5) {
  const timestamp = new Date(post.postedAt).getTime();
  if (Number.isNaN(timestamp)) return null;
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  if (ageHours > 24 * 7) return null;
  // This is deliberately target-agnostic. It only provides a stable fallback
  // order when AI is unavailable; ICP relevance is never hardcoded here.
  const breakdown = {
    icpFit: 0,
    problemRelevance: 0,
    openness: questionPattern.test(post.content) ? 15 : 5,
    freshness: Math.max(5, Math.round(20 - ageHours / 9)),
    evidence: Math.max(0, Math.min(15, evidence)),
  };
  return { score: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown };
}

export function baseOpportunity(post: NormalizedPost, score: ReturnType<typeof scorePost>): Opportunity {
  if (!score) throw new Error("Suppressed posts cannot become opportunities");
  return {
    id: post.id, postId: post.id, url: canonicalLinkedInUrl(post.url), author: post.author, authorHeadline: post.authorHeadline,
    company: post.company, avatar: post.avatar, authorProfileUrl: post.authorProfileUrl, industry: post.industry, location: post.location,
    postedAt: post.postedAt, ageLabel: relativeAgeLabel(post.postedAt), sourceId: post.sourceLabel.toLowerCase().replaceAll(/\W+/g, "-"), sourceLabel: post.sourceLabel, sourceKind: post.sourceKind,
    excerpt: post.content.length > 110 ? `${post.content.slice(0, 110)}…` : post.content, content: post.content, score: score.score,
    scoreBreakdown: score.breakdown, fitReasons: ["Relevant operational discussion", "There may be room to add a practical point of view"],
    conversationAngle: "Answer the operational question directly and end with one specific follow-up question.",
    draftReply: "The useful place to start is usually the handoff, not the tool. Map who decides, what context must move and who owns the exception. That tends to show whether automation will remove work or simply hide it. Where does the current process lose the most context?",
    riskFlags: [], contentIdea: "What this conversation reveals about day-to-day operating systems", status: "new",
    companyMatch: { companyName: post.company, ukCompany: false, founderLed: operatorPattern.test(post.authorHeadline) ? "likely" : "unknown", ageConfidence: "unknown", matchConfidence: 0 },
  };
}
