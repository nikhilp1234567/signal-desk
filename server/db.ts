import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppData, CandidateReview, ContentDraft, ContentIdea, Opportunity, ProfileSection, Settings, Source, StorageState } from "../shared/types.js";
import type { NormalizedPost } from "./services/scoring.js";
import { initialContentDrafts, initialProfileSections, initialSettings } from "./seed.js";

type Row = Record<string, unknown>;
const legacyOpportunityIds = ["sarah", "james", "priya", "tom", "rachel", "dan", "olivia", "marcus", "emma", "ben", "aisha", "harry", "lucy", "noah", "maya"];
const legacySourceIds = ["src-1", "src-2", "src-3", "src-4", "src-5", "src-6", ...Array.from({ length: 8 }, (_, index) => `group-${index + 1}`), "suggest-1", "suggest-2", "suggest-3", "suggest-4"];
const legacyDraftIds = ["mon", "tue", "wed", "thu", "fri"];
const legacyProfileIds = ["positioning", "headline", "about", "featured", "experience", "contact"];
const legacyProofPoints = "Workflow mapping before automation; clear ownership; fewer manual handoffs; websites that explain operational value.";
const legacyVoiceSamples = [
  "The handoff is usually the real problem, not the tool.",
  "The happy path is easy. Good systems make the exception visible.",
  "A useful automation should make ownership clearer, not invisible.",
  "Start with the decision, then choose the tool.",
  "Most dashboards fail because the conversation around them never changed.",
];

export class SignalDeskStore {
  readonly db: DatabaseSync;
  private readonly databasePath: string | null;
  private readonly jsonPath: string | null;
  private lastJsonSavedAt: string | null = null;
  private jsonError: string | null = null;

  constructor(path = "data/signal-desk.sqlite", jsonPath = path === ":memory:" ? null : path.replace(/\.sqlite$/i, ".json")) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.databasePath = path === ":memory:" ? null : path;
    this.jsonPath = jsonPath;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
    this.recoverInterruptedRuns();
    this.removeLegacySampleData();
    this.seed();
    this.removeLegacyWritingSamples();
    this.migrateLegacySettings();
    this.persistJson();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, value TEXT NOT NULL,
        status TEXT NOT NULL, cadence TEXT NOT NULL, last_run_at TEXT, item_count INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0, error TEXT, suggested INTEGER NOT NULL DEFAULT 0,
        description TEXT, member_count INTEGER
      );
      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_drafts (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_ideas (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profile_sections (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profile_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, section_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collection_runs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
        item_count INTEGER NOT NULL DEFAULT 0, error TEXT, trigger TEXT NOT NULL, cost REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS signal_posts (
        id TEXT PRIMARY KEY, canonical_url TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL,
        collected_at TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS company_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id TEXT NOT NULL, payload TEXT NOT NULL, checked_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS engagements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candidate_reviews (
        run_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_signal_posts_expiry ON signal_posts(expires_at);
    `);
    const runColumns = new Set((this.db.prepare("PRAGMA table_info(collection_runs)").all() as Row[]).map((row) => String(row.name)));
    for (const [name, definition] of Object.entries({ collected_count: "INTEGER NOT NULL DEFAULT 0", unique_count: "INTEGER NOT NULL DEFAULT 0", prequalified_count: "INTEGER NOT NULL DEFAULT 0", analyzed_count: "INTEGER NOT NULL DEFAULT 0", ai_failed_count: "INTEGER NOT NULL DEFAULT 0", filtered_count: "INTEGER NOT NULL DEFAULT 0", strong_count: "INTEGER NOT NULL DEFAULT 0", possible_count: "INTEGER NOT NULL DEFAULT 0", suppressed_count: "INTEGER NOT NULL DEFAULT 0", below_threshold_count: "INTEGER NOT NULL DEFAULT 0", filter_mode: "TEXT NOT NULL DEFAULT 'broad'", threshold: "INTEGER NOT NULL DEFAULT 40", audit_version: "INTEGER NOT NULL DEFAULT 0" })) {
      if (!runColumns.has(name)) this.db.exec(`ALTER TABLE collection_runs ADD COLUMN ${name} ${definition}`);
    }
  }

  private recoverInterruptedRuns() {
    this.db.prepare("UPDATE collection_runs SET status = 'failed', finished_at = ?, error = ? WHERE status IN ('running', 'queued')")
      .run(new Date().toISOString(), "The local backend restarted before this collection finished. Run collection again.");
  }

  private removeLegacySampleData() {
    const completed = this.db.prepare("SELECT value FROM app_metadata WHERE key = 'sample-data-removed-v1'").get();
    if (completed) return;
    const placeholders = (items: string[]) => items.map(() => "?").join(",");
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`DELETE FROM engagements WHERE opportunity_id IN (${placeholders(legacyOpportunityIds)})`).run(...legacyOpportunityIds);
      this.db.prepare(`DELETE FROM company_matches WHERE opportunity_id IN (${placeholders(legacyOpportunityIds)})`).run(...legacyOpportunityIds);
      this.db.prepare(`DELETE FROM opportunities WHERE id IN (${placeholders(legacyOpportunityIds)})`).run(...legacyOpportunityIds);
      this.db.prepare(`DELETE FROM sources WHERE id IN (${placeholders(legacySourceIds)})`).run(...legacySourceIds);
      this.db.prepare(`DELETE FROM content_drafts WHERE id IN (${placeholders(legacyDraftIds)})`).run(...legacyDraftIds);
      this.db.prepare("DELETE FROM content_ideas WHERE id IN ('idea-1', 'idea-2')").run();
      this.db.prepare(`DELETE FROM profile_versions WHERE section_id IN (${placeholders(legacyProfileIds)})`).run(...legacyProfileIds);
      this.db.prepare(`DELETE FROM profile_sections WHERE id IN (${placeholders(legacyProfileIds)})`).run(...legacyProfileIds);
      this.db.prepare("DELETE FROM collection_runs").run();
      this.db.prepare("INSERT INTO app_metadata (key, value) VALUES ('sample-data-removed-v1', ?)").run(new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private seed() {
    const now = new Date().toISOString();
    const draftCount = this.db.prepare("SELECT COUNT(*) AS count FROM content_drafts").get() as Row;
    if (Number(draftCount.count) === 0) {
      const insert = this.db.prepare("INSERT INTO content_drafts (id, payload, updated_at) VALUES (?, ?, ?)");
      for (const item of initialContentDrafts) insert.run(item.id, JSON.stringify(item), now);
    }
    const profileCount = this.db.prepare("SELECT COUNT(*) AS count FROM profile_sections").get() as Row;
    if (Number(profileCount.count) === 0) {
      const insert = this.db.prepare("INSERT INTO profile_sections (id, payload, updated_at) VALUES (?, ?, ?)");
      for (const item of initialProfileSections) insert.run(item.id, JSON.stringify(item), now);
    }
    const settingsCount = this.db.prepare("SELECT COUNT(*) AS count FROM settings").get() as Row;
    if (Number(settingsCount.count) === 0) this.db.prepare("INSERT INTO settings (id, payload, updated_at) VALUES (1, ?, ?)").run(JSON.stringify(initialSettings), now);
  }

  private removeLegacyWritingSamples() {
    const completed = this.db.prepare("SELECT value FROM app_metadata WHERE key = 'seeded-writing-removed-v1'").get();
    if (completed) return;
    const row = this.db.prepare("SELECT payload FROM settings WHERE id = 1").get() as Row | undefined;
    if (row?.payload) {
      const current = JSON.parse(String(row.payload)) as Partial<Settings>;
      const matchesVoice = JSON.stringify(current.voiceSamples) === JSON.stringify(legacyVoiceSamples);
      const next = {
        ...current,
        proofPoints: current.proofPoints === legacyProofPoints ? "" : current.proofPoints,
        voiceSamples: matchesVoice ? [""] : current.voiceSamples,
      };
      this.db.prepare("UPDATE settings SET payload = ?, updated_at = ? WHERE id = 1").run(JSON.stringify(next), new Date().toISOString());
    }
    this.db.prepare("INSERT INTO app_metadata (key, value) VALUES ('seeded-writing-removed-v1', ?)").run(new Date().toISOString());
  }

  private migrateLegacySettings() {
    const row = this.db.prepare("SELECT payload FROM settings WHERE id = 1").get() as Row;
    const current = JSON.parse(String(row.payload)) as Partial<Settings> & { model?: string };
    const { model: legacyModel, ...currentSettings } = current;
    const oldDefaults = ["gpt-5.6-terra", "openai/gpt-5.4", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash"];
    const customLegacyModel = legacyModel && !oldDefaults.includes(legacyModel) ? legacyModel : undefined;
    const next: Settings = {
      ...initialSettings,
      ...currentSettings,
      analysisModel: current.analysisModel ?? customLegacyModel ?? initialSettings.analysisModel,
      writingModel: current.writingModel ?? customLegacyModel ?? initialSettings.writingModel,
      maxPostsPerSource: current.maxPostsPerSource ?? initialSettings.maxPostsPerSource,
      jsonPersistence: current.jsonPersistence ?? true,
    };
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      this.db.prepare("UPDATE settings SET payload = ?, updated_at = ? WHERE id = 1").run(JSON.stringify(next), new Date().toISOString());
    }
  }

  private payloadRows(table: string) {
    return (this.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Row[]).map((row) => ({
      ...row,
      payload: row.payload ? JSON.parse(String(row.payload)) : undefined,
    }));
  }

  private persistJson() {
    if (!this.jsonPath || !this.getSettings().jsonPersistence) return;
    try {
      const savedAt = new Date().toISOString();
      const snapshot = {
        version: 1,
        savedAt,
        sources: [...this.getSources(false), ...this.getSources(true)],
        opportunities: this.getOpportunities(),
        contentDrafts: this.getContentDrafts(),
        contentIdeas: this.getContentIdeas(),
        profileSections: this.getProfileSections(),
        settings: this.getSettings(),
        collectionRuns: this.db.prepare("SELECT * FROM collection_runs ORDER BY started_at DESC").all(),
        signalPosts: this.payloadRows("signal_posts"),
        companyMatches: this.payloadRows("company_matches"),
        engagements: this.db.prepare("SELECT * FROM engagements ORDER BY created_at DESC").all(),
        profileVersions: this.db.prepare("SELECT * FROM profile_versions ORDER BY created_at DESC").all(),
        candidateReviews: this.getCandidateReviews(),
      };
      mkdirSync(dirname(this.jsonPath), { recursive: true });
      const temporaryPath = `${this.jsonPath}.tmp`;
      writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, this.jsonPath);
      chmodSync(this.jsonPath, 0o600);
      this.lastJsonSavedAt = savedAt;
      this.jsonError = null;
    } catch (error) {
      this.jsonError = error instanceof Error ? error.message : "JSON snapshot could not be saved.";
    }
  }

  saveJsonSnapshot(): StorageState {
    this.persistJson();
    return this.getStorageState();
  }

  getStorageState(): StorageState {
    return {
      sqlite: true,
      sqlitePath: this.databasePath,
      json: Boolean(this.jsonPath && this.getSettings().jsonPersistence),
      jsonPath: this.jsonPath,
      lastJsonSavedAt: this.lastJsonSavedAt,
      jsonError: this.jsonError,
    };
  }

  private rows<T>(sql: string, ...params: (string | number | bigint | null | Uint8Array)[]): T[] {
    return this.db.prepare(sql).all(...params).map((row: Row) => JSON.parse(String(row.payload)) as T);
  }

  getSources(suggested = false): Source[] {
    return (this.db.prepare("SELECT * FROM sources WHERE suggested = ? ORDER BY kind, label").all(suggested ? 1 : 0) as Row[]).map((row) => ({
      id: String(row.id), kind: row.kind as Source["kind"], label: String(row.label), value: String(row.value), status: row.status as Source["status"], cadence: row.cadence as Source["cadence"], lastRunAt: row.last_run_at ? String(row.last_run_at) : null, itemCount: Number(row.item_count), estimatedCost: Number(row.estimated_cost), error: row.error ? String(row.error) : null, suggested: Boolean(row.suggested), description: row.description ? String(row.description) : undefined, memberCount: row.member_count ? Number(row.member_count) : undefined,
    }));
  }

  approveSource(id: string): Source | null {
    this.db.prepare("UPDATE sources SET suggested = 0, status = 'active' WHERE id = ?").run(id);
    const source = this.getSources(false).find((item) => item.id === id) ?? null;
    this.persistJson();
    return source;
  }

  addSearch(label: string, value: string): Source {
    const source: Source = { id: `source-${crypto.randomUUID()}`, kind: "public_search", label, value, status: "active", cadence: "daily", lastRunAt: null, itemCount: 0, estimatedCost: 0, error: null };
    this.db.prepare(`INSERT INTO sources (id, kind, label, value, status, cadence, last_run_at, item_count, estimated_cost, error, suggested)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(source.id, source.kind, source.label, source.value, source.status, source.cadence, null, 0, 0, null);
    this.persistJson();
    return source;
  }

  updateSource(id: string, patch: Partial<Pick<Source, "status" | "cadence">>): Source | null {
    const current = this.getSources(false).find((source) => source.id === id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db.prepare("UPDATE sources SET status = ?, cadence = ? WHERE id = ?").run(next.status, next.cadence, id);
    this.persistJson();
    return next;
  }

  getOpportunities(): Opportunity[] {
    return this.rows<Opportunity>("SELECT payload FROM opportunities ORDER BY json_extract(payload, '$.score') DESC");
  }

  updateOpportunity(id: string, patch: Partial<Opportunity>): Opportunity | null {
    const current = this.getOpportunities().find((item) => item.id === id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db.prepare("UPDATE opportunities SET payload = ?, status = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(next), next.status, new Date().toISOString(), id);
    if (patch.status) this.db.prepare("INSERT INTO engagements (opportunity_id, action, created_at) VALUES (?, ?, ?)").run(id, patch.status, new Date().toISOString());
    this.persistJson();
    return next;
  }

  upsertOpportunity(item: Opportunity) {
    this.db.prepare(`INSERT INTO opportunities (id, payload, status, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, status = excluded.status, updated_at = excluded.updated_at`)
      .run(item.id, JSON.stringify(item), item.status, new Date().toISOString());
    this.persistJson();
  }

  removeFreshOpportunitiesForSources(sourceLabels: string[]) {
    if (!sourceLabels.length) return 0;
    const marks = sourceLabels.map(() => "?").join(", ");
    const changes = this.db.prepare(`DELETE FROM opportunities WHERE status = 'new' AND json_extract(payload, '$.sourceLabel') IN (${marks})`).run(...sourceLabels).changes;
    if (changes) this.persistJson();
    return changes;
  }

  getContentDrafts(): ContentDraft[] { return this.rows<ContentDraft>("SELECT payload FROM content_drafts ORDER BY rowid"); }
  updateContentDraft(id: string, patch: Partial<ContentDraft>): ContentDraft | null {
    const current = this.getContentDrafts().find((item) => item.id === id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db.prepare("UPDATE content_drafts SET payload = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(next), new Date().toISOString(), id);
    this.persistJson();
    return next;
  }

  getContentIdeas() { return this.rows<ContentIdea>("SELECT payload FROM content_ideas ORDER BY created_at DESC"); }
  upsertContentIdea(item: ContentIdea) {
    this.db.prepare(`INSERT INTO content_ideas (id, payload, created_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`)
      .run(item.id, JSON.stringify(item), new Date().toISOString());
    this.persistJson();
  }
  getProfileSections(): ProfileSection[] { return this.rows<ProfileSection>("SELECT payload FROM profile_sections ORDER BY rowid"); }
  updateProfileSection(id: string, patch: Partial<ProfileSection>, saveVersion = false): ProfileSection | null {
    const current = this.getProfileSections().find((item) => item.id === id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db.prepare("UPDATE profile_sections SET payload = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(next), new Date().toISOString(), id);
    if (saveVersion) this.db.prepare("INSERT INTO profile_versions (section_id, content, created_at) VALUES (?, ?, ?)").run(id, next.suggested, new Date().toISOString());
    this.persistJson();
    return next;
  }

  replaceProfileSections(sections: ProfileSection[]): ProfileSection[] {
    const update = this.db.prepare("UPDATE profile_sections SET payload = ?, updated_at = ? WHERE id = ?");
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      for (const section of sections) update.run(JSON.stringify(section), now, section.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.persistJson();
    return this.getProfileSections();
  }

  getSettings(): Settings {
    const row = this.db.prepare("SELECT payload FROM settings WHERE id = 1").get() as Row;
    return { ...initialSettings, ...JSON.parse(String(row.payload)) } as Settings;
  }
  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch };
    this.db.prepare("UPDATE settings SET payload = ?, updated_at = ? WHERE id = 1").run(JSON.stringify(next), new Date().toISOString());
    this.persistJson();
    return next;
  }

  createRun(trigger: string): string | null {
    const active = this.db.prepare("SELECT id FROM collection_runs WHERE status IN ('running', 'queued') LIMIT 1").get();
    if (active) return null;
    const id = crypto.randomUUID();
    this.db.prepare("INSERT INTO collection_runs (id, status, started_at, trigger) VALUES (?, 'running', ?, ?)").run(id, new Date().toISOString(), trigger);
    this.persistJson();
    return id;
  }
  finishRun(id: string, status: "succeeded" | "partial" | "failed", itemCount: number, error: string | null, cost = 0, funnel: { collectedCount?: number; uniqueCount?: number; prequalifiedCount?: number; analyzedCount?: number; aiFailedCount?: number; filteredCount?: number; strongCount?: number; possibleCount?: number; suppressedCount?: number; belowThresholdCount?: number; filterMode?: "broad" | "balanced" | "strict"; threshold?: number } = {}) {
    this.db.prepare("UPDATE collection_runs SET status = ?, finished_at = ?, item_count = ?, error = ?, cost = ?, collected_count = ?, unique_count = ?, prequalified_count = ?, analyzed_count = ?, ai_failed_count = ?, filtered_count = ?, strong_count = ?, possible_count = ?, suppressed_count = ?, below_threshold_count = ?, filter_mode = ?, threshold = ?, audit_version = 2 WHERE id = ?")
      .run(status, new Date().toISOString(), itemCount, error, cost, funnel.collectedCount ?? 0, funnel.uniqueCount ?? 0, funnel.prequalifiedCount ?? 0, funnel.analyzedCount ?? 0, funnel.aiFailedCount ?? 0, funnel.filteredCount ?? 0, funnel.strongCount ?? 0, funnel.possibleCount ?? 0, funnel.suppressedCount ?? 0, funnel.belowThresholdCount ?? 0, funnel.filterMode ?? "broad", funnel.threshold ?? 40, id);
    this.persistJson();
  }
  updateRunProgress(id: string, funnel: { collectedCount?: number; uniqueCount?: number; prequalifiedCount?: number; analyzedCount?: number; aiFailedCount?: number }, cost = 0) {
    this.db.prepare("UPDATE collection_runs SET cost = ?, collected_count = ?, unique_count = ?, prequalified_count = ?, analyzed_count = ?, ai_failed_count = ? WHERE id = ? AND status = 'running'")
      .run(cost, funnel.collectedCount ?? 0, funnel.uniqueCount ?? 0, funnel.prequalifiedCount ?? 0, funnel.analyzedCount ?? 0, funnel.aiFailedCount ?? 0, id);
  }
  getLastRun() {
    const row = this.db.prepare("SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT 1").get() as Row | undefined;
    return row ? {
      status: String(row.status), startedAt: String(row.started_at), finishedAt: row.finished_at ? String(row.finished_at) : null,
      itemCount: Number(row.item_count), collectedCount: Number(row.collected_count), uniqueCount: Number(row.unique_count),
      prequalifiedCount: Number(row.prequalified_count), analyzedCount: Number(row.analyzed_count), aiFailedCount: Number(row.ai_failed_count ?? 0), filteredCount: Number(row.filtered_count),
      strongCount: Number(row.strong_count), possibleCount: Number(row.possible_count), suppressedCount: Number(row.suppressed_count), belowThresholdCount: Number(row.below_threshold_count),
      filterMode: (row.filter_mode ?? "broad") as "broad" | "balanced" | "strict", threshold: Number(row.threshold ?? 40), auditVersion: Number(row.audit_version ?? 0),
      error: row.error ? String(row.error) : null, cost: Number(row.cost),
    } : null;
  }

  replaceCandidateReviews(runId: string, reviews: CandidateReview[]) {
    const insert = this.db.prepare("INSERT INTO candidate_reviews (run_id, id, payload, created_at) VALUES (?, ?, ?, ?)");
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM candidate_reviews WHERE run_id = ?").run(runId);
      for (const review of reviews) insert.run(runId, review.id, JSON.stringify(review), now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.persistJson();
  }

  getCandidateReviews(): CandidateReview[] {
    const latest = this.db.prepare("SELECT id FROM collection_runs ORDER BY started_at DESC LIMIT 1").get() as Row | undefined;
    return latest ? this.rows<CandidateReview>("SELECT payload FROM candidate_reviews WHERE run_id = ? ORDER BY json_extract(payload, '$.score') DESC", String(latest.id)) : [];
  }

  updateSourceRun(id: string, itemCount: number, error: string | null, estimatedCost = 0) {
    this.db.prepare("UPDATE sources SET last_run_at = ?, item_count = ?, error = ?, estimated_cost = ?, status = CASE WHEN ? IS NULL THEN status ELSE 'error' END WHERE id = ?")
      .run(new Date().toISOString(), itemCount, error, estimatedCost, error, id);
    this.persistJson();
  }

  hasSignalPost(id: string, canonicalUrl: string, hash: string) {
    const row = this.db.prepare("SELECT payload FROM signal_posts WHERE id = ? OR canonical_url = ? OR content_hash = ? LIMIT 1").get(id, canonicalUrl, hash) as Row | undefined;
    if (!row) return false;
    try { return JSON.parse(String(row.payload)).schemaVersion === 3; }
    catch { return false; }
  }

  storeSignalPost(post: NormalizedPost, canonicalUrl: string, hash: string) {
    const collectedAt = new Date();
    const expiresAt = new Date(collectedAt.getTime() + 30 * 86_400_000);
    this.db.prepare(`INSERT INTO signal_posts (id, canonical_url, content_hash, payload, collected_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET canonical_url = excluded.canonical_url, content_hash = excluded.content_hash, payload = excluded.payload, collected_at = excluded.collected_at, expires_at = excluded.expires_at`)
      .run(post.id, canonicalUrl, hash, JSON.stringify(post), collectedAt.toISOString(), expiresAt.toISOString());
    this.persistJson();
  }

  saveCompanyMatch(opportunityId: string, payload: Opportunity["companyMatch"]) {
    this.db.prepare("INSERT INTO company_matches (opportunity_id, payload, checked_at) VALUES (?, ?, ?)").run(opportunityId, JSON.stringify(payload), new Date().toISOString());
    this.persistJson();
  }

  purgeExpired(now = new Date()) {
    const changes = this.db.prepare("DELETE FROM signal_posts WHERE expires_at < ?").run(now.toISOString()).changes;
    const reviewCutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const reviewChanges = this.db.prepare("DELETE FROM candidate_reviews WHERE created_at < ?").run(reviewCutoff).changes;
    if (changes || reviewChanges) this.persistJson();
    return Number(changes) + Number(reviewChanges);
  }

  getAppData(): Omit<AppData, "setupRequired" | "connections"> {
    return {
      opportunities: this.getOpportunities(), sources: this.getSources(false), suggestions: this.getSources(true),
      contentDrafts: this.getContentDrafts(), contentIdeas: this.getContentIdeas() as AppData["contentIdeas"],
      profileSections: this.getProfileSections(), settings: this.getSettings(), lastRun: this.getLastRun(), storage: this.getStorageState(),
      candidateReviews: this.getCandidateReviews(),
    };
  }
}
