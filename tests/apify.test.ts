import { describe, expect, it } from "vitest";
import { normalizeGroupPost, normalizeProfile, normalizePublicPost } from "../server/integrations/apify.js";
import type { Source } from "../shared/types.js";

const publicSource: Source = { id: "1", kind: "public_search", label: "Agency ops", value: "agency operations", status: "active", cadence: "daily", lastRunAt: null, itemCount: 0, estimatedCost: 0, error: null };
const groupSource: Source = { ...publicSource, id: "2", kind: "linkedin_group", label: "Agency Leaders", value: "https://linkedin.com/groups/1" };

describe("Apify adapters", () => {
  it("normalizes alternate public-post field shapes", () => {
    const item = normalizePublicPost({ id: "p1", postUrl: "https://linkedin.com/posts/p1", text: "A useful question", authorName: "Sam Lee", authorHeadline: "Agency Founder", companyName: "Form Studio", publishedAt: "2026-08-29T08:00:00Z" }, publicSource);
    expect(item).toMatchObject({ id: "p1", author: "Sam Lee", company: "Form Studio", sourceKind: "public_search" });
  });

  it("normalizes the Harvest actor's nested author and date shape", () => {
    const item = normalizePublicPost({
      id: "p2", url: "https://linkedin.com/posts/p2", content: "How should agency founders fix manual delivery?",
      author: { name: "Alex Fox", info: "Founder at Fox Studio | Digital delivery", linkedinUrl: "https://linkedin.com/in/alex-fox", avatar: { url: "https://media.example/avatar.jpg" }, industry: "Design Services" },
      postedAt: { timestamp: 1788163200000, date: "2026-08-31T08:00:00.000Z", postedAgoShort: "1h" },
    }, publicSource);
    expect(item).toMatchObject({ schemaVersion: 3, authorHeadline: "Founder at Fox Studio | Digital delivery", company: "Fox Studio", avatar: "https://media.example/avatar.jpg", authorProfileUrl: "https://linkedin.com/in/alex-fox", industry: "Design Services", postedAt: "2026-08-31T08:00:00.000Z" });
  });

  it("normalizes group posts and drops malformed rows", () => {
    expect(normalizeGroupPost({ postId: "g1", url: "https://linkedin.com/posts/g1", content: "Where does delivery break?", postedAt: "2026-08-31T08:00:00Z", author: { name: "Jo Fox", headline: "Founder", companyName: "Fox & Co" } }, groupSource)).toMatchObject({ sourceKind: "linkedin_group", sourceLabel: "Agency Leaders" });
    expect(normalizeGroupPost({ postId: "bad" }, groupSource)).toBeNull();
  });

  it("normalizes profile enrichment without inventing an industry", () => {
    expect(normalizeProfile({ linkedinUrl: "https://linkedin.com/in/alex", headline: "Founder", photo: "https://media.example/alex.jpg", location: { parsed: { text: "London, United Kingdom" } }, currentPosition: [{ companyName: "North Studio" }] })).toEqual({
      authorProfileUrl: "https://linkedin.com/in/alex", authorHeadline: "Founder", avatar: "https://media.example/alex.jpg", company: "North Studio", industry: undefined, location: "London, United Kingdom",
    });
  });
});
