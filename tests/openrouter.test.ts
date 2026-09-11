import { describe, expect, it } from "vitest";
import { OpportunityAI, ProfileAI, SearchPlannerAI } from "../server/integrations/openrouter.js";
import { initialSettings } from "../server/seed.js";
import type { Opportunity } from "../shared/types.js";

const draft = "The handoff usually matters more than the tool. Mapping the decision points and one clear owner before automating tends to expose the actual gap. I would look at where context first gets rebuilt, then decide whether software is even the missing piece.";
const opportunity: Opportunity = {
  id: "test-opportunity", postId: "urn:li:activity:test", url: "https://www.linkedin.com/feed/update/urn:li:activity:test", author: "Test Founder", authorHeadline: "Founder", company: "Test Agency Ltd", postedAt: "2026-08-29T08:00:00.000Z", ageLabel: "1d", sourceId: "test-source", sourceLabel: "Agency operations", sourceKind: "public_search", excerpt: "Our team keeps rebuilding context during client handoffs.", content: "Our team keeps rebuilding context during client handoffs. How are other agency owners solving this?", score: 80,
  scoreBreakdown: { icpFit: 20, problemRelevance: 18, openness: 18, freshness: 14, evidence: 10 }, fitReasons: ["Agency founder discussing an operational problem"], conversationAngle: "Start with handoff ownership", draftReply: draft, riskFlags: [], contentIdea: "Map the handoff before the tool", status: "new",
  companyMatch: { companyName: "Test Agency Ltd", ukCompany: true, founderLed: "likely", ageConfidence: "verified", matchConfidence: 0.9 },
};

describe("OpenRouter adapter", () => {
  it("uses chat completions with strict structured output", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ analyses: [{ id: opportunity.id, score: 91, fitReasons: ["Strong agency operations fit"], conversationAngle: "Start with ownership", draftReply: draft, riskFlags: [], contentIdea: "Map the handoff before the tool" }] }) } }], usage: { cost: 0.001 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const result = await new OpportunityAI("sk-or-test", "inception/mercury-2.5-preview", fetcher).enhance(opportunity, initialSettings);
    expect(result.score).toBe(91);
    expect(calls[0].input).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.model).toBe("inception/mercury-2.5-preview");
    expect(body.reasoning).toEqual({ effort: "none", exclude: true });
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "opportunity_batch_analysis", strict: true } });
    expect(body.messages[1].content).toContain(opportunity.id);
    expect(body.provider.require_parameters).toBe(true);
  });

  it("rejects malformed structured output", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    await expect(new OpportunityAI("sk-or-test", "inception/mercury-2.5-preview", fetcher).enhance(opportunity, initialSettings)).rejects.toThrow();
  });

  it("generates a complete profile and targeting brief without a second provider flow", async () => {
    const output = {
      positioning: "Practical AI automation for busy local service businesses.",
      headline: "AI receptionists and automations for UK clinics and home-service businesses",
      about: "I help busy physical service businesses reduce missed calls and repetitive admin.",
      featured: "Create a short walkthrough showing how an enquiry moves from missed call to booked appointment.",
      experience: "Builds practical AI receptionists, booking workflows and admin automations.",
      contact: "Send a message with the repetitive task you want to remove.",
      icpBrief: "Owners of UK clinics and home-service businesses with missed-call and admin pressure.",
      offer: "AI receptionists and practical workflow automation.",
      proofPoints: "No proof supplied yet.",
    };
    const calls: Array<{ init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      calls.push({ init });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200 });
    };
    const result = await new ProfileAI("sk-or-test", "deepseek/deepseek-v4-flash-0731", fetcher).generate("I build AI receptionists for UK clinics. Do not invent proof.", initialSettings);
    expect(result).toEqual(output);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "linkedin_profile", strict: true } });
    expect(body.messages[0].content).toContain("Never invent clients");
  });

  it("keeps AI scoring when a draft fails the reply guardrail", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ analyses: [{ id: opportunity.id, score: 84, fitReasons: ["Direct buyer problem"], conversationAngle: "Ask about call handling", draftReply: "Great post", riskFlags: [], contentIdea: "Missed calls as an operating signal" }] }) } }] }), { status: 200 });
    const result = await new OpportunityAI("sk-or-test", undefined, fetcher).enhance(opportunity, initialSettings);
    expect(result.score).toBe(84);
    expect(result.draftReply).toBe(opportunity.draftReply);
    expect(result.riskFlags).toContain("AI draft needs manual rewrite");
  });

  it("turns a plain-English target into editable LinkedIn searches", async () => {
    const searches = [
      { label: "Missed clinic calls", query: '"missed calls" AND (clinic OR dental)', rationale: "Finds owners discussing lost phone enquiries." },
      { label: "Reception workload", query: '"front desk" AND (overwhelmed OR busy)', rationale: "Finds staffing pressure in physical businesses." },
      { label: "Booking admin", query: '"appointment booking" AND manual', rationale: "Finds repetitive scheduling work." },
    ];
    const calls: Array<{ init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      calls.push({ init });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ searches }) } }] }), { status: 200 });
    };
    const result = await new SearchPlannerAI("sk-or-test", undefined, fetcher).generate("UK clinics with missed-call problems", initialSettings);
    expect(result).toEqual(searches);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.model).toBe("inception/mercury-2.5-preview");
    expect(body.reasoning).toEqual({ effort: "none", exclude: true });
    expect(body.response_format.json_schema.name).toBe("linkedin_search_plan");
  });
});
