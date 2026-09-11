import { describe, expect, it, vi } from "vitest";
import { canonicalLinkedInUrl, contentHash, isAtLeastTwoYears, relativeAgeLabel, scorePost } from "../server/services/scoring.js";
import { nameSimilarity } from "../server/integrations/companiesHouse.js";

const post = {
  schemaVersion: 3 as const,
  id: "urn:li:activity:1", url: "https://www.linkedin.com/posts/example?utm_source=test", author: "Alex Smith",
  authorHeadline: "Founder at North Studio", company: "North Studio", content: "Our client reporting handoff is still manual. How are other agency owners solving it?",
  postedAt: new Date().toISOString(), sourceLabel: "Test source", sourceKind: "public_search" as const,
};

describe("signal scoring", () => {
  it("uses only freshness, openness and evidence for the local fallback", () => {
    const result = scorePost(post);
    expect(result?.score).toBeGreaterThanOrEqual(35);
    expect(result?.breakdown.icpFit).toBe(0);
    expect(result?.breakdown.problemRelevance).toBe(0);
  });

  it("keeps promotional-looking posts auditable but rejects stale posts", () => {
    expect(scorePost({ ...post, content: "Register now for our agency webinar" })).not.toBeNull();
    expect(scorePost({ ...post, content: "Comment VOICE and I will send the guide" })).not.toBeNull();
    expect(scorePost({ ...post, postedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() })).toBeNull();
  });

  it("shows an exact relative age and rejects invalid dates", () => {
    expect(relativeAgeLabel("2026-08-31T08:00:00.000Z", new Date("2026-08-31T11:30:00.000Z"))).toBe("3h");
    expect(relativeAgeLabel("not-a-date")).toBe("Date unavailable");
    expect(scorePost({ ...post, postedAt: "not-a-date" })).toBeNull();
  });

  it("keeps uncertain authors reviewable without inventing ICP evidence", () => {
    const result = scorePost({ ...post, authorHeadline: "Sales leader", company: "Software Ltd", content: "How should founders improve sales?" });
    expect(result).not.toBeNull();
    expect(result!.breakdown.icpFit).toBe(0);
  });

  it("does not hardcode a preferred industry or punish service sellers", () => {
    const seller = scorePost({ ...post, authorHeadline: "Founder | AI Automation Specialist for Dental Clinics", company: "Automation Vendor", content: "Missed calls cost dental practices bookings. How are owners solving this?" });
    const clinic = scorePost({ ...post, authorHeadline: "Practice Manager at North Dental", company: "North Dental", content: "We keep missing phone calls while the front desk handles appointment bookings. How are other clinic owners managing this?" });
    expect(seller?.breakdown.icpFit).toBe(0);
    expect(clinic?.breakdown.icpFit).toBe(0);
    expect(seller?.score).toBe(clinic?.score);
  });

  it("canonicalizes URLs and produces stable hashes", () => {
    expect(canonicalLinkedInUrl(post.url)).toBe("https://www.linkedin.com/posts/example");
    expect(contentHash("A   handoff")).toBe(contentHash("a handoff"));
  });
});

describe("company qualification", () => {
  it("uses an inclusive two-year boundary", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    expect(isAtLeastTwoYears("2024-08-29", now)).toBe(true);
    expect(isAtLeastTwoYears("2024-08-30", now)).toBe(false);
  });

  it("matches legal suffix and agency wording without claiming weak names", () => {
    expect(nameSimilarity("North Studio", "NORTH STUDIO LIMITED")).toBe(1);
    expect(nameSimilarity("North Studio", "Completely Different Ltd")).toBeLessThan(0.5);
  });
});
