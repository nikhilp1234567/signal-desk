import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.js";
import { SignalDeskStore } from "../server/db.js";
import { LocalSecretStore } from "../server/secrets.js";

const stores: SignalDeskStore[] = [];
const setup = () => {
  const store = new SignalDeskStore(":memory:");
  stores.push(store);
  const app = createApp(store, { openrouterModel: "openai/gpt-5.4", maxChargeUsd: 2 });
  return { store, app };
};
afterEach(() => { while (stores.length) stores.pop()?.db.close(); });

describe("Signal Desk API", () => {
  it("returns a clean setup bootstrap without sample records or secrets", async () => {
    const { app } = setup();
    const response = await request(app).get("/api/bootstrap").expect(200);
    expect(response.body.setupRequired).toBe(true);
    expect(response.body.opportunities).toEqual([]);
    expect(response.body.sources).toEqual([]);
    expect(response.body.suggestions).toEqual([]);
    expect(response.body.contentIdeas).toEqual([]);
    expect(response.body.contentDrafts).toHaveLength(5);
    expect(response.body.contentDrafts.every((item: { body: string }) => item.body === "")).toBe(true);
    expect(response.body.profileSections.every((item: { current: string; suggested: string }) => item.current === "" && item.suggested === "")).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("API_TOKEN");
    expect(JSON.stringify(response.body)).not.toContain("urn:li:activity:fixture");
  });

  it("adds an explicitly approved public search", async () => {
    const { app } = setup();
    const added = await request(app).post("/api/sources").send({ label: "Agency operations", value: "agency founder AND delivery operations" }).expect(201);
    expect(added.body.status).toBe("active");
    const updated = await request(app).patch(`/api/sources/${added.body.id}`).send({ status: "paused" }).expect(200);
    expect(updated.body.status).toBe("paused");
  });

  it("requires all credentials before creating a collection run", async () => {
    const { app, store } = setup();
    const response = await request(app).post("/api/runs").send({ trigger: "manual" }).expect(428);
    expect(response.body.setupRequired).toBe(true);
    expect(store.getLastRun()).toBeNull();
  });

  it("requires an approved source before creating a collection run", async () => {
    const store = new SignalDeskStore(":memory:");
    stores.push(store);
    const app = createApp(store, {
      openrouterModel: "openai/gpt-5.4",
      maxChargeUsd: 2,
      openrouterKey: "test-openrouter",
      apifyToken: "test-apify",
      companiesHouseKey: "test-companies-house",
    });
    const response = await request(app).post("/api/runs").send({ trigger: "manual" }).expect(422);
    expect(response.body.sourceRequired).toBe(true);
    expect(response.body.reason).toContain("Sources");
    expect(store.getLastRun()).toBeNull();
  });

  it("prevents overlapping collection runs at the store lock", () => {
    const { store } = setup();
    expect(store.createRun("manual")).toEqual(expect.any(String));
    expect(store.createRun("manual")).toBeNull();
  });

  it("recovers a collection left running by a backend restart", () => {
    const path = join(tmpdir(), `signal-desk-recovery-${crypto.randomUUID()}.sqlite`);
    let first: SignalDeskStore | null = null;
    let recovered: SignalDeskStore | null = null;
    try {
      first = new SignalDeskStore(path, null);
      expect(first.createRun("manual")).toEqual(expect.any(String));
      first.db.close();
      first = null;
      recovered = new SignalDeskStore(path, null);
      expect(recovered.getLastRun()).toMatchObject({ status: "failed", error: expect.stringContaining("backend restarted") });
    } finally {
      first?.db.close();
      recovered?.db.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        try { unlinkSync(`${path}${suffix}`); } catch { /* Temporary SQLite sidecar may not exist. */ }
      }
    }
  });

  it("has no endpoint capable of publishing or connecting on LinkedIn", async () => {
    const { app } = setup();
    await request(app).post("/api/linkedin/publish").send({ text: "No" }).expect(404);
    await request(app).post("/api/linkedin/connect").send({ profile: "No" }).expect(404);
    await request(app).post("/api/linkedin/message").send({ profile: "No" }).expect(404);
  });

  it("purges expired normalized post records", () => {
    const { store } = setup();
    store.db.prepare("INSERT INTO signal_posts (id, canonical_url, content_hash, payload, collected_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run("old", "https://example.com", "hash", "{}", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z");
    expect(store.purgeExpired(new Date("2026-08-29T00:00:00Z"))).toBe(1);
  });

  it("persists conversation-derived content ideas", () => {
    const { store } = setup();
    store.upsertContentIdea({ id: "idea-test", title: "Why agency handoffs lose context", source: "Test Founder · Agency operations", ageLabel: "recent" });
    expect(store.getContentIdeas()).toEqual([
      { id: "idea-test", title: "Why agency handoffs lose context", source: "Test Founder · Agency operations", ageLabel: "recent" },
    ]);
  });

  it("collects a post, ranks it, and persists its AI content idea", async () => {
    const store = new SignalDeskStore(":memory:");
    stores.push(store);
    store.addSearch("Agency operations", "agency founder workflow");
    const reply = "The useful place to start is the handoff rather than the software. Map who owns the decision, what context needs to move, and how exceptions are handled. That usually reveals whether automation will remove work or simply make the existing ambiguity faster.";
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.apify.com/v2/actors/")) return new Response(JSON.stringify({ data: { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.01 } }), { status: 201 });
      if (url.includes("api.apify.com/v2/datasets/dataset-1/items")) return new Response(JSON.stringify([{ id: "post-1", url: "https://www.linkedin.com/feed/update/urn:li:activity:1", authorName: "Test Founder", authorHeadline: "Founder at Creative Agency", content: "How are agency founders fixing manual reporting workflow bottlenecks?", postedAt: new Date().toISOString() }]), { status: 200 });
      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        const body = JSON.parse(String(init?.body));
        const [{ id }] = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("[")));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ analyses: [{ id, score: 88, fitReasons: ["Founder discussing an agency workflow"], conversationAngle: "Clarify ownership before tooling", draftReply: reply, riskFlags: [], contentIdea: "Why agency reporting problems are usually ownership problems" }] }) } }], usage: { cost: 0.001 } }), { status: 200 });
      }
      throw new Error(`Unexpected mocked request: ${url}`);
    };
    const app = createApp(store, { openrouterModel: "openai/gpt-5.4", maxChargeUsd: 2, openrouterKey: "test-openrouter", apifyToken: "test-apify", companiesHouseKey: "test-companies-house", fetcher });
    await request(app).post("/api/runs").send({ trigger: "manual" }).expect(202);
    for (let attempt = 0; attempt < 20 && store.getLastRun()?.status === "running"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.getLastRun()?.status).toBe("succeeded");
    expect(store.getLastRun()).toMatchObject({ collectedCount: 1, uniqueCount: 1, prequalifiedCount: 1, analyzedCount: 1, aiFailedCount: 0, filteredCount: 0, itemCount: 1, strongCount: 1, possibleCount: 0, suppressedCount: 0, belowThresholdCount: 0, filterMode: "broad", threshold: 0, auditVersion: 2 });
    expect(store.getOpportunities()).toHaveLength(1);
    expect(store.getCandidateReviews()).toEqual([expect.objectContaining({ author: "Test Founder", decision: "shown", score: 88 })]);
    expect(store.getContentIdeas()).toEqual([
      expect.objectContaining({ title: "Why agency reporting problems are usually ownership problems", source: expect.stringContaining("Test Founder") }),
    ]);
  });

  it("reviews every eligible post in efficient AI batches instead of truncating the set", async () => {
    const store = new SignalDeskStore(":memory:");
    stores.push(store);
    store.addSearch("Clinic operations", "clinic owner missed calls");
    const posts = Array.from({ length: 55 }, (_, index) => ({
      id: `post-${index}`,
      url: `https://www.linkedin.com/feed/update/urn:li:activity:${index}`,
      authorName: `Clinic Owner ${index}`,
      authorHeadline: `Owner at Clinic ${index}`,
      content: `Clinic owner ${index} asks how other practices handle missed calls, appointment admin and follow-up?`,
      postedAt: new Date().toISOString(),
    }));
    let aiCalls = 0;
    const reply = "The useful starting point is measuring what happens after each missed call. Separate genuine after-hours demand from calls missed while staff are busy, then track which ones become bookings. That gives you a clear baseline before changing the receptionist workflow or adding automation.";
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.apify.com/v2/actors/")) return new Response(JSON.stringify({ data: { id: "run-all", status: "SUCCEEDED", defaultDatasetId: "dataset-all", usageTotalUsd: 0.02 } }), { status: 201 });
      if (url.includes("api.apify.com/v2/datasets/dataset-all/items")) return new Response(JSON.stringify(posts), { status: 200 });
      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        aiCalls += 1;
        const body = JSON.parse(String(init?.body));
        const requested = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf("["))) as Array<{ id: string }>;
        const analyses = requested.map(({ id }, index) => ({ id, score: 70, fitReasons: ["Clinic owner discussing missed calls"], conversationAngle: "Measure the missed-call path", draftReply: reply, riskFlags: [], contentIdea: `Missed-call workflow idea ${aiCalls}-${index}` }));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ analyses }) } }], usage: { cost: 0.002 } }), { status: 200 });
      }
      throw new Error(`Unexpected mocked request: ${url}`);
    };
    const app = createApp(store, { openrouterModel: "inception/mercury-2.5-preview", maxChargeUsd: 2, openrouterKey: "test-openrouter", apifyToken: "test-apify", companiesHouseKey: "test-companies-house", fetcher });
    await request(app).post("/api/runs").send({ trigger: "manual" }).expect(202);
    for (let attempt = 0; attempt < 100 && store.getLastRun()?.status === "running"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));

    expect(store.getLastRun()).toMatchObject({ status: "succeeded", prequalifiedCount: 55, analyzedCount: 55, aiFailedCount: 0, itemCount: 15 });
    expect(aiCalls).toBe(6);
    expect(store.getCandidateReviews()).toHaveLength(55);
    expect(store.getContentIdeas()).toHaveLength(55);
  });

  it("keeps a fallback-ranked Today queue when OpenRouter fails", async () => {
    const store = new SignalDeskStore(":memory:");
    stores.push(store);
    store.addSearch("Clinic calls", '"missed calls" AND clinic');
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.apify.com/v2/actors/")) return new Response(JSON.stringify({ data: { id: "run-fallback", status: "SUCCEEDED", defaultDatasetId: "dataset-fallback", usageTotalUsd: 0.01 } }), { status: 201 });
      if (url.includes("api.apify.com/v2/datasets/dataset-fallback/items")) return new Response(JSON.stringify([{ id: "fallback-post", url: "https://www.linkedin.com/feed/update/urn:li:activity:fallback", authorName: "Clinic Owner", authorHeadline: "Owner", content: "We keep missing calls while the front desk handles appointments. How are other clinics managing this?", postedAt: new Date().toISOString() }]), { status: 200 });
      if (url.includes("openrouter.ai/api/v1/chat/completions")) return new Response(JSON.stringify({ error: { message: "Provider timed out" } }), { status: 504 });
      throw new Error(`Unexpected mocked request: ${url}`);
    };
    const app = createApp(store, { openrouterModel: "inception/mercury-2.5-preview", maxChargeUsd: 2, openrouterKey: "test-openrouter", apifyToken: "test-apify", companiesHouseKey: "test-companies-house", fetcher });
    await request(app).post("/api/runs").send({ trigger: "manual" }).expect(202);
    for (let attempt = 0; attempt < 40 && store.getLastRun()?.status === "running"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.getLastRun()).toMatchObject({ status: "partial", collectedCount: 1, prequalifiedCount: 1, analyzedCount: 1, aiFailedCount: 1, itemCount: 1 });
    expect(store.getOpportunities()).toHaveLength(1);
    expect(store.getCandidateReviews()).toEqual([expect.objectContaining({ decision: "shown", reason: expect.stringContaining("fallback") })]);
  });

  it("stores API keys locally without returning them to the browser", async () => {
    const path = join(tmpdir(), `signal-desk-secrets-${crypto.randomUUID()}.json`);
    try {
      const store = new SignalDeskStore(":memory:");
      stores.push(store);
      const secretStore = new LocalSecretStore(path);
      const app = createApp(store, { openrouterModel: "openai/gpt-5.4", maxChargeUsd: 2, secretStore });
      const response = await request(app).put("/api/settings/credentials").send({ openrouterKey: "sk-or-test-secret", apifyToken: "apify-test-secret", companiesHouseKey: "ch-test-secret" }).expect(200);
      expect(response.body.openrouter).toBe(true);
      expect(response.body.apify).toBe(true);
      expect(response.body.companiesHouse).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain("sk-or-test-secret");
      expect(JSON.parse(readFileSync(path, "utf8")).openrouterKey).toBe("sk-or-test-secret");
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const bootstrap = await request(app).get("/api/bootstrap").expect(200);
      expect(bootstrap.body.setupRequired).toBe(false);
      expect(JSON.stringify(bootstrap.body)).not.toContain("apify-test-secret");
    } finally {
      try { unlinkSync(path); } catch { /* file was not created */ }
    }
  });

  it("builds and persists a profile plus ranking context from one brief", async () => {
    const store = new SignalDeskStore(":memory:");
    stores.push(store);
    const generated = {
      positioning: "Practical AI automation for physical service businesses.",
      headline: "AI receptionists for UK clinics and home-service businesses",
      about: "I help service businesses reduce missed calls and repetitive admin.",
      featured: "Create a walkthrough of a missed-call recovery flow.",
      experience: "Builds AI receptionists and workflow automations.",
      contact: "Message me with the repetitive task taking up your week.",
      icpBrief: "Owners of UK clinics and home-service businesses.",
      offer: "AI receptionists and practical automation.",
      proofPoints: "No proof supplied yet.",
    };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(generated) } }] }), { status: 200 });
    const app = createApp(store, { openrouterModel: "openai/gpt-5.4", maxChargeUsd: 2, openrouterKey: "test-openrouter", fetcher });
    const brief = "I build AI receptionists for UK clinics and home-service businesses. Do not invent proof.";
    const response = await request(app).post("/api/profile/generate").send({ brief }).expect(200);
    expect(response.body.sections).toHaveLength(6);
    expect(response.body.sections.find((item: { id: string }) => item.id === "headline").suggested).toBe(generated.headline);
    expect(response.body.settings).toMatchObject({ profileBrief: brief, icpBrief: generated.icpBrief, offer: generated.offer, proofPoints: generated.proofPoints });
    expect(store.getProfileSections().every((item) => item.status === "Draft")).toBe(true);
  });

  it("persists and validates the per-search collection cap", async () => {
    const { app, store } = setup();
    const response = await request(app).patch("/api/settings").send({ maxPostsPerSource: 10 }).expect(200);
    expect(response.body.maxPostsPerSource).toBe(10);
    expect(store.getSettings().maxPostsPerSource).toBe(10);
    await request(app).patch("/api/settings").send({ maxPostsPerSource: 500 }).expect(400);
  });

  it("writes a secret-free JSON snapshot after local changes", () => {
    const path = join(tmpdir(), `signal-desk-data-${crypto.randomUUID()}.json`);
    try {
      const store = new SignalDeskStore(":memory:", path);
      stores.push(store);
      store.addSearch("Agency operations", "agency founder AND operations");
      const snapshot = JSON.parse(readFileSync(path, "utf8"));
      expect(snapshot.sources).toHaveLength(1);
      expect(snapshot.sources[0].label).toBe("Agency operations");
      expect(snapshot.opportunities).toEqual([]);
      expect(JSON.stringify(snapshot)).not.toContain("apiKey");
      expect(JSON.stringify(snapshot)).not.toContain("openrouterKey");
    } finally {
      try { unlinkSync(path); } catch { /* file was not created */ }
    }
  });
});
