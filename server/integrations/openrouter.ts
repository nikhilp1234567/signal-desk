import { z } from "zod";
import type { Opportunity, SearchSuggestion, Settings } from "../../shared/types.js";

const outputSchema = z.object({
  score: z.number().int().min(0).max(100),
  fitReasons: z.array(z.string()).min(1).max(3),
  conversationAngle: z.string(),
  draftReply: z.string(),
  riskFlags: z.array(z.string()),
  contentIdea: z.string(),
}).strict();

const batchOutputSchema = z.object({
  analyses: z.array(outputSchema.extend({ id: z.string().min(1) }).strict()).min(1),
}).strict();

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "fitReasons", "conversationAngle", "draftReply", "riskFlags", "contentIdea"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    fitReasons: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    conversationAngle: { type: "string" },
    draftReply: { type: "string" },
    riskFlags: { type: "array", items: { type: "string" } },
    contentIdea: { type: "string" },
  },
};

const batchJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["analyses"],
  properties: {
    analyses: {
      type: "array",
      minItems: 1,
      items: {
        ...jsonSchema,
        required: ["id", ...jsonSchema.required],
        properties: { id: { type: "string" }, ...jsonSchema.properties },
      },
    },
  },
};

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z.object({ cost: z.number().optional() }).passthrough().optional(),
});

const profileOutputSchema = z.object({
  positioning: z.string().min(1),
  headline: z.string().min(1),
  about: z.string().min(1),
  featured: z.string().min(1),
  experience: z.string().min(1),
  contact: z.string().min(1),
  icpBrief: z.string().min(1),
  offer: z.string().min(1),
  proofPoints: z.string(),
}).strict();

const searchPlanSchema = z.object({
  searches: z.array(z.object({
    label: z.string().min(2).max(60),
    query: z.string().min(2).max(180),
    rationale: z.string().min(2).max(240),
  }).strict()).min(3).max(6),
}).strict();

const searchPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["searches"],
  properties: {
    searches: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "query", "rationale"],
        properties: { label: { type: "string" }, query: { type: "string" }, rationale: { type: "string" } },
      },
    },
  },
};

const profileJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["positioning", "headline", "about", "featured", "experience", "contact", "icpBrief", "offer", "proofPoints"],
  properties: {
    positioning: { type: "string" }, headline: { type: "string" }, about: { type: "string" },
    featured: { type: "string" }, experience: { type: "string" }, contact: { type: "string" },
    icpBrief: { type: "string" }, offer: { type: "string" }, proofPoints: { type: "string" },
  },
};

export type ProfileAIOutput = z.infer<typeof profileOutputSchema>;

export function validateDraft(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const blocked = /\b(book a call|dm me|we can help|game[- ]changer|10x|unlock|revolutioni[sz]e)\b/i.test(text);
  return { valid: words.length >= 30 && words.length <= 100 && !blocked, wordCount: words.length, blocked };
}

export class OpportunityAI {
  constructor(
    private readonly apiKey: string,
    private readonly model = "inception/mercury-2.5-preview",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private systemPrompt(settings: Settings) {
    return `You help one UK automation consultant rank LinkedIn conversations. Never pitch. Never invent experience, company, industry, or verification facts. Draft 40–80 words in the supplied voice. Score each post only against the supplied ICP: 70–100 direct buyer and useful conversation, 40–69 adjacent or uncertain but potentially useful, 0–39 weak fit. Risk flags are transparent notes for the human reviewer, never instructions to discard a post. Unknown company, location, age, or founder status must not reduce the score by itself. Keep fit reasons factual and specific. ICP: ${settings.icpBrief}. Offer context only: ${settings.offer}. Proof: ${settings.proofPoints}. Banned phrases: ${settings.bannedPhrases}. Voice samples: ${settings.voiceSamples.join(" | ")}`;
  }

  async enhanceMany(items: Opportunity[], settings: Settings): Promise<{ opportunities: Opportunity[]; cost: number }> {
    if (!items.length) return { opportunities: [], cost: 0 };
    const response = await this.fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:5173",
        "X-OpenRouter-Title": "Signal Desk",
      },
      body: JSON.stringify({
        model: settings.analysisModel || this.model,
        max_tokens: Math.min(4_500, 500 + items.length * 380),
        temperature: 0.2,
        reasoning: { effort: "none", exclude: true },
        messages: [
          { role: "system", content: this.systemPrompt(settings) },
          { role: "user", content: `Assess every post in this JSON array using only the supplied facts. Return exactly one analysis for every id. ${JSON.stringify(items.map((item) => ({ id: item.id, author: item.author, headline: item.authorHeadline, companyEvidence: item.companyMatch, post: item.content })))}` },
        ],
        response_format: { type: "json_schema", json_schema: { name: "opportunity_batch_analysis", strict: true, schema: batchJsonSchema } },
        provider: { require_parameters: true },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(errorBody.error?.message || `OpenRouter request failed (${response.status})`);
    }
    const completion = responseSchema.parse(await response.json());
    const parsed = batchOutputSchema.parse(JSON.parse(completion.choices[0].message.content));
    const byId = new Map(parsed.analyses.map((analysis) => [analysis.id, analysis]));
    const opportunities = items.map((item) => {
      const analysis = byId.get(item.id);
      if (!analysis) return { ...item, riskFlags: [...item.riskFlags, "AI analysis failed: model omitted this post"] };
      const { id: _analysisId, ...output } = analysis;
      if (!validateDraft(output.draftReply).valid) return { ...item, ...output, draftReply: item.draftReply, riskFlags: [...output.riskFlags, "AI draft needs manual rewrite"] };
      return { ...item, ...output };
    });
    return { opportunities, cost: completion.usage?.cost ?? 0 };
  }

  async enhance(item: Opportunity, settings: Settings): Promise<Opportunity> {
    const result = await this.enhanceMany([item], settings);
    return result.opportunities[0];
  }
}

export class ProfileAI {
  constructor(
    private readonly apiKey: string,
    private readonly model = "deepseek/deepseek-v4-flash-0731",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generate(brief: string, settings: Settings): Promise<ProfileAIOutput> {
    const response = await this.fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:5173",
        "X-OpenRouter-Title": "Signal Desk",
      },
      body: JSON.stringify({
        model: settings.writingModel || this.model,
        max_tokens: 2_500,
        temperature: 0.55,
        messages: [
          { role: "system", content: `Turn rough notes into a credible LinkedIn profile for one consultant. Return polished positioning, headline, About, Featured recommendation, Experience copy, contact path, plus concise ICP, offer, and proof context used by an engagement assistant. Use only facts in the user's brief. Never invent clients, years, metrics, credentials, industries, outcomes, experience, or case studies. If proof is absent, say that no proof was supplied rather than fabricating it. Write in direct British English, avoid hype and hard pitches, and respect these banned phrases: ${settings.bannedPhrases}. The Featured field may recommend what to create, but must not pretend that asset already exists.` },
          { role: "user", content: brief },
        ],
        response_format: { type: "json_schema", json_schema: { name: "linkedin_profile", strict: true, schema: profileJsonSchema } },
        provider: { require_parameters: true },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(errorBody.error?.message || `OpenRouter request failed (${response.status})`);
    }
    const completion = responseSchema.parse(await response.json());
    return profileOutputSchema.parse(JSON.parse(completion.choices[0].message.content));
  }
}

export class SearchPlannerAI {
  constructor(
    private readonly apiKey: string,
    private readonly model = "inception/mercury-2.5-preview",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generate(brief: string, settings: Settings): Promise<SearchSuggestion[]> {
    const response = await this.fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:5173",
        "X-OpenRouter-Title": "Signal Desk",
      },
      body: JSON.stringify({
        model: settings.analysisModel || this.model,
        max_tokens: 1_200,
        temperature: 0.35,
        reasoning: { effort: "none", exclude: true },
        messages: [
          { role: "system", content: "Create four narrow LinkedIn post-search queries for finding conversations written by the target buyers themselves. Queries use the same syntax as LinkedIn's search bar and may use quotes, AND, OR and NOT. Prefer short pain-language phrases buyers naturally write over broad industry buzzwords. Avoid searches centred on AI, automation vendors, consultants, agencies, recruiters or job adverts unless those are explicitly the target. Each query must be meaningfully different and understandable to a non-technical user." },
          { role: "user", content: `Target description: ${brief || settings.icpBrief}. Offer context: ${settings.offer}. Return editable searches with plain-English rationales.` },
        ],
        response_format: { type: "json_schema", json_schema: { name: "linkedin_search_plan", strict: true, schema: searchPlanJsonSchema } },
        provider: { require_parameters: true },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(errorBody.error?.message || `OpenRouter request failed (${response.status})`);
    }
    const completion = responseSchema.parse(await response.json());
    return searchPlanSchema.parse(JSON.parse(completion.choices[0].message.content)).searches;
  }
}
