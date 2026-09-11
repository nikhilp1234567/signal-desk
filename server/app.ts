import express from "express";
import { z } from "zod";
import { SignalDeskStore } from "./db.js";
import { collectSignals, connectionState, type RuntimeConfig } from "./services/collection.js";
import { ProfileAI, SearchPlannerAI } from "./integrations/openrouter.js";

const modifierSchema = z.object({ modifier: z.enum(["shorter", "opinionated", "example", "personal", "specific", "proof"]) });
const sourceSchema = z.object({ label: z.string().min(2).max(80), value: z.string().min(3).max(500) });
const credentialSchema = z.object({
  apifyToken: z.string().max(500).nullable().optional(),
  openrouterKey: z.string().max(500).nullable().optional(),
  companiesHouseKey: z.string().max(500).nullable().optional(),
}).strict();

const transforms: Record<string, (text: string) => string> = {
  shorter: (text) => text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "),
  opinionated: (text) => `I think ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
  example: (text) => `${text}\n\nFor example, one clear owner at intake prevents three people rebuilding the same context later.`,
  personal: (text) => `What I keep seeing is this: ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
  specific: (text) => text.replace(/practical/gi, "delivery-focused").replace(/agencies/gi, "founder-led UK agencies"),
  proof: (text) => `${text}\n\nThe strongest proof is a before-and-after view of the handoff, not another list of tools.`,
};

export function createApp(store: SignalDeskStore, config: RuntimeConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  app.get("/api/bootstrap", (_request, response) => {
    const connections = connectionState(config);
    response.json({ ...store.getAppData(), connections, setupRequired: !(connections.apify && connections.openrouter && connections.companiesHouse) });
  });

  app.post("/api/sources", (request, response) => {
    const parsed = sourceSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "A label and search query are required." });
    return response.status(201).json(store.addSearch(parsed.data.label, parsed.data.value));
  });
  app.post("/api/sources/suggest", async (request, response) => {
    const parsed = z.object({ brief: z.string().max(3000).optional() }).strict().safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Describe the audience you want to find." });
    if (!config.openrouterKey) return response.status(428).json({ error: "Add your OpenRouter API key in Settings before generating searches." });
    try {
      const settings = store.getSettings();
      const suggestions = await new SearchPlannerAI(config.openrouterKey, config.openrouterModel, config.fetcher).generate(parsed.data.brief?.trim() || settings.icpBrief, settings);
      return response.json({ suggestions });
    } catch (error) {
      return response.status(502).json({ error: error instanceof Error ? error.message : "OpenRouter could not generate searches." });
    }
  });
  app.post("/api/sources/:id/approve", (request, response) => {
    const source = store.approveSource(request.params.id);
    return source ? response.json(source) : response.status(404).json({ error: "Source not found." });
  });
  app.patch("/api/sources/:id", (request, response) => {
    const parsed = z.object({ status: z.enum(["active", "paused"]).optional(), cadence: z.enum(["daily", "manual"]).optional() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid source update." });
    const source = store.updateSource(request.params.id, parsed.data);
    return source ? response.json(source) : response.status(404).json({ error: "Source not found." });
  });
  app.post("/api/runs", async (request, response) => {
    const result = await collectSignals(store, config, request.body?.trigger === "schedule" ? "schedule" : "manual");
    const failureStatus = "setupRequired" in result && result.setupRequired ? 428 : "sourceRequired" in result && result.sourceRequired ? 422 : 409;
    return result.accepted ? response.status(202).json(result) : response.status(failureStatus).json(result);
  });
  app.get("/api/runs/latest", (_request, response) => response.json(store.getLastRun()));

  app.patch("/api/opportunities/:id", (request, response) => {
    const parsed = z.object({ status: z.enum(["new", "saved", "replied", "dismissed"]).optional(), draftReply: z.string().max(1200).optional() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid opportunity update." });
    const item = store.updateOpportunity(request.params.id, parsed.data);
    return item ? response.json(item) : response.status(404).json({ error: "Opportunity not found." });
  });
  app.post("/api/opportunities/:id/regenerate", (request, response) => {
    const parsed = modifierSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Unknown draft modifier." });
    const item = store.getOpportunities().find((candidate) => candidate.id === request.params.id);
    if (!item) return response.status(404).json({ error: "Opportunity not found." });
    const draftReply = transforms[parsed.data.modifier](item.draftReply);
    return response.json(store.updateOpportunity(item.id, { draftReply }));
  });

  app.patch("/api/content/:id", (request, response) => {
    const parsed = z.object({ hook: z.string().max(300).optional(), body: z.string().max(5000).optional(), status: z.enum(["Ready", "Draft", "Outline", "Idea"]).optional() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid content update." });
    const item = store.updateContentDraft(request.params.id, parsed.data);
    return item ? response.json(item) : response.status(404).json({ error: "Draft not found." });
  });
  app.post("/api/content/:id/regenerate", (request, response) => {
    const parsed = modifierSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Unknown content modifier." });
    const item = store.getContentDrafts().find((draft) => draft.id === request.params.id);
    if (!item) return response.status(404).json({ error: "Draft not found." });
    const key = parsed.data.modifier === "opinionated" ? "opinionated" : parsed.data.modifier === "example" ? "example" : "personal";
    return response.json(store.updateContentDraft(item.id, { body: transforms[key](item.body), status: "Draft" }));
  });

  app.patch("/api/profile/:id", (request, response) => {
    const parsed = z.object({ current: z.string().max(5000).optional(), suggested: z.string().max(5000).optional(), status: z.enum(["Ready", "Needs edit", "Draft", "Missing"]).optional(), saveVersion: z.boolean().optional() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid profile update." });
    const { saveVersion, ...patch } = parsed.data;
    const item = store.updateProfileSection(request.params.id, patch, saveVersion);
    return item ? response.json(item) : response.status(404).json({ error: "Profile section not found." });
  });
  app.post("/api/profile/:id/regenerate", (request, response) => {
    const parsed = modifierSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Unknown profile modifier." });
    const item = store.getProfileSections().find((section) => section.id === request.params.id);
    if (!item) return response.status(404).json({ error: "Profile section not found." });
    return response.json(store.updateProfileSection(item.id, { suggested: transforms[parsed.data.modifier](item.suggested), status: "Draft" }));
  });
  app.post("/api/profile/generate", async (request, response) => {
    const parsed = z.object({ brief: z.string().trim().min(20).max(10_000) }).strict().safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Add a little more detail to your profile brief before generating." });
    if (!config.openrouterKey) return response.status(428).json({ error: "Add your OpenRouter API key in Settings before generating a profile." });
    try {
      const currentSettings = store.getSettings();
      const generated = await new ProfileAI(config.openrouterKey, config.openrouterModel, config.fetcher).generate(parsed.data.brief, currentSettings);
      const values: Record<string, string> = generated;
      const sections = store.replaceProfileSections(store.getProfileSections().map((section) => ({
        ...section,
        status: "Draft",
        summary: "Generated from your profile brief",
        suggested: values[section.id] ?? section.suggested,
      })));
      const settings = store.updateSettings({ profileBrief: parsed.data.brief, icpBrief: generated.icpBrief, offer: generated.offer, proofPoints: generated.proofPoints });
      return response.json({ sections, settings });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenRouter could not generate the profile.";
      return response.status(502).json({ error: message });
    }
  });

  app.patch("/api/settings", (request, response) => {
    const parsed = z.object({ profileBrief: z.string().max(10_000).optional(), icpBrief: z.string().max(3000).optional(), offer: z.string().max(2000).optional(), proofPoints: z.string().max(3000).optional(), bannedPhrases: z.string().max(2000).optional(), voiceSamples: z.array(z.string().max(1000)).min(1).max(10).optional(), refreshTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), dailyTarget: z.number().int().min(1).max(10).optional(), candidateLimit: z.number().int().min(5).max(50).optional(), maxPostsPerSource: z.number().int().min(5).max(50).optional(), filterMode: z.enum(["broad", "balanced", "strict"]).optional(), analysisModel: z.string().trim().min(3).max(150).optional(), writingModel: z.string().trim().min(3).max(150).optional(), jsonPersistence: z.boolean().optional() }).strict().safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid settings update." });
    return response.json(store.updateSettings(parsed.data));
  });
  app.put("/api/settings/credentials", (request, response) => {
    const parsed = credentialSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid credential update." });
    if (!config.secretStore) return response.status(503).json({ error: "Local credential storage is not available." });
    const values = config.secretStore.update(parsed.data);
    config.apifyToken = values.apifyToken;
    config.openrouterKey = values.openrouterKey;
    config.companiesHouseKey = values.companiesHouseKey;
    return response.json(connectionState(config));
  });
  app.post("/api/storage/snapshot", (_request, response) => response.json(store.saveJsonSnapshot()));

  app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found." }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error instanceof Error ? error.message : "Unexpected request error");
    response.status(500).json({ error: "Signal Desk could not complete that request." });
  });
  return app;
}
