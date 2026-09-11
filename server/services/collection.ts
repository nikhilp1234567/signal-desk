import { randomUUID } from "node:crypto";
import type { CandidateReview, Opportunity, Source } from "../../shared/types.js";
import { SignalDeskStore } from "../db.js";
import { ApifyClient, normalizeGroupPost, normalizePublicPost } from "../integrations/apify.js";
import { CompaniesHouseClient } from "../integrations/companiesHouse.js";
import { OpportunityAI } from "../integrations/openrouter.js";
import type { LocalSecretStore } from "../secrets.js";
import { baseOpportunity, canonicalLinkedInUrl, contentHash, scorePost, type NormalizedPost } from "./scoring.js";

export interface RuntimeConfig {
  apifyToken?: string;
  openrouterKey?: string;
  companiesHouseKey?: string;
  openrouterModel: string;
  maxChargeUsd: number;
  secretStore?: LocalSecretStore;
  fetcher?: typeof fetch;
}

const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

async function mapWithConcurrency<T, U>(items: T[], concurrency: number, mapper: (item: T) => Promise<U>) {
  const results: U[] = [];
  for (const group of chunks(items, concurrency)) results.push(...await Promise.all(group.map(mapper)));
  return results;
}

export async function collectSignals(store: SignalDeskStore, config: RuntimeConfig, trigger: "manual" | "schedule") {
  const missing = [!config.apifyToken ? "Apify" : null, !config.openrouterKey ? "OpenRouter" : null, !config.companiesHouseKey ? "Companies House" : null].filter(Boolean);
  if (missing.length) return { accepted: false, setupRequired: true, reason: `Add the required API keys before collecting signals: ${missing.join(", ")}.` };
  const activeSources = store.getSources(false).filter((source) => source.status === "active");
  if (!activeSources.length) return { accepted: false, sourceRequired: true, reason: "Add at least one LinkedIn post search in Sources before refreshing signals." };
  const settings = store.getSettings();
  const runId = store.createRun(trigger);
  if (!runId) return { accepted: false, reason: "A collection run is already active." };
  console.info("[collection] run started", { runId, trigger, sourceCount: activeSources.length });

  void (async () => {
    let totalCost = 0;
    const sourceFailures: string[] = [];
    const funnel = { collectedCount: 0, uniqueCount: 0, prequalifiedCount: 0, analyzedCount: 0, aiFailedCount: 0, filteredCount: 0, strongCount: 0, possibleCount: 0, suppressedCount: 0, belowThresholdCount: 0, filterMode: store.getSettings().filterMode, threshold: 40 };
    try {
      const client = new ApifyClient(config.apifyToken!, config.maxChargeUsd, config.fetcher);
      const normalized: NormalizedPost[] = [];
      for (const group of chunks(activeSources, 3)) {
        const results = await Promise.allSettled(group.map((source) => client.runSource(source, settings.maxPostsPerSource)));
        results.forEach((result, index) => {
          const source = group[index];
          if (result.status === "rejected") {
            const message = result.reason instanceof Error ? result.reason.message : "Actor run failed";
            sourceFailures.push(`${source.label}: ${message}`);
            store.updateSourceRun(source.id, 0, message);
            return;
          }
          totalCost += result.value.cost;
          const normalize = source.kind === "public_search" ? normalizePublicPost : normalizeGroupPost;
          const items = result.value.items.flatMap((item) => {
            const post = normalize(item, source);
            return post ? [post] : [];
          });
          normalized.push(...items);
          store.updateSourceRun(source.id, items.length, null, result.value.cost);
        });
      }
      if (sourceFailures.length === activeSources.length) {
        console.error("[collection] every source failed", { runId, failures: sourceFailures.length });
        store.finishRun(runId, "failed", 0, sourceFailures.join(" | "), totalCost, funnel);
        return;
      }

      const seen = new Set<string>();
      const scored: Opportunity[] = [];
      funnel.collectedCount = normalized.length;
      for (const post of normalized) {
        const canonicalUrl = canonicalLinkedInUrl(post.url);
        const hash = contentHash(post.content);
        const key = post.id || canonicalUrl || hash;
        if (seen.has(key)) continue;
        seen.add(key);
        store.storeSignalPost(post, canonicalUrl, hash);
        const scoredPost = scorePost(post);
        if (!scoredPost) continue;
        scored.push(baseOpportunity(post, scoredPost));
      }
      funnel.uniqueCount = seen.size;
      funnel.prequalifiedCount = scored.length;
      store.updateRunProgress(runId, funnel, totalCost);
      console.info("[collection] sources normalized", { runId, collected: funnel.collectedCount, unique: funnel.uniqueCount, eligible: funnel.prequalifiedCount, sourceFailures: sourceFailures.length });
      let candidates = scored.sort((a, b) => b.score - a.score);
      const companyClient = config.companiesHouseKey ? new CompaniesHouseClient(config.companiesHouseKey, config.fetcher) : null;
      const ai = config.openrouterKey ? new OpportunityAI(config.openrouterKey, config.openrouterModel, config.fetcher) : null;
      const companyEnriched = await mapWithConcurrency(candidates, 12, async (item) => {
        let next = item;
        if (companyClient && item.company !== "Unknown company") {
          try { next = { ...next, companyMatch: await companyClient.match(item.company, item.author, item.authorHeadline) }; store.saveCompanyMatch(item.id, next.companyMatch); }
          catch (error) { next = { ...next, riskFlags: [...next.riskFlags, error instanceof Error ? error.message : "Company verification failed"] }; }
        }
        return { ...next, id: next.id || randomUUID() };
      });
      console.info("[collection] company verification complete", { runId, candidates: companyEnriched.length });

      // Review every valid post while keeping request overhead and provider load bounded.
      const aiBatches = chunks(companyEnriched, 10);
      const enrichedGroups = await mapWithConcurrency(aiBatches, 3, async (batch) => {
        try {
          if (!ai) throw new Error("OpenRouter is not configured");
          const result = await ai.enhanceMany(batch, settings);
          totalCost += result.cost;
          funnel.analyzedCount += batch.length;
          funnel.aiFailedCount += result.opportunities.filter((item) => item.riskFlags.some((flag) => /^AI analysis failed:/i.test(flag))).length;
          store.updateRunProgress(runId, funnel, totalCost);
          console.info("[collection] AI batch complete", { runId, completed: funnel.analyzedCount, eligible: funnel.prequalifiedCount, failed: funnel.aiFailedCount });
          return result.opportunities;
        } catch (error) {
          funnel.analyzedCount += batch.length;
          funnel.aiFailedCount += batch.length;
          store.updateRunProgress(runId, funnel, totalCost);
          const detail = error instanceof Error ? error.message : "Unknown OpenRouter error";
          console.error("[collection] AI batch failed", { runId, batchSize: batch.length, completed: funnel.analyzedCount, error: detail });
          return batch.map((item) => ({ ...item, riskFlags: [...item.riskFlags, `AI analysis failed: ${detail}`] }));
        }
      });
      const enriched = enrichedGroups.flat();
      const aiFailurePattern = /^AI analysis failed:/i;
      const ranked = enriched.sort((a, b) => b.score - a.score);
      const qualified = ranked.slice(0, settings.candidateLimit);
      const qualifiedIds = new Set(qualified.map((item) => item.id));
      funnel.filterMode = settings.filterMode;
      funnel.threshold = 0;
      funnel.strongCount = qualified.filter((item) => item.score >= 70).length;
      funnel.possibleCount = qualified.filter((item) => item.score < 70).length;
      funnel.suppressedCount = 0;
      funnel.belowThresholdCount = 0;
      funnel.filteredCount = Math.max(0, funnel.uniqueCount - qualified.length);
      const reviews: CandidateReview[] = enriched.map((item) => {
        const aiFailure = item.riskFlags.find((flag) => aiFailurePattern.test(flag));
        const decision: CandidateReview["decision"] = qualifiedIds.has(item.id) ? "shown" : aiFailure ? "ai_failed" : "queue_limit";
        const reason = decision === "shown" ? aiFailure ? "AI was unavailable; included using the transparent freshness and conversation fallback" : item.score >= 70 ? "High-ranked match for manual review" : "Included in the top review queue"
          : decision === "ai_failed" ? aiFailure!
          : `${settings.candidateLimit} higher-ranked posts filled the Today queue; this post remains available in the audit`;
        return { id: item.id, runId, author: item.author, authorHeadline: item.authorHeadline, company: item.company, sourceLabel: item.sourceLabel, url: item.url, excerpt: item.excerpt, score: item.score, decision, reason, riskFlags: item.riskFlags };
      });
      store.replaceCandidateReviews(runId, reviews);
      store.removeFreshOpportunitiesForSources(activeSources.map((source) => source.label));
      qualified.forEach((item) => {
        store.upsertOpportunity(item);
      });
      ranked.filter((item) => !item.riskFlags.some((flag) => aiFailurePattern.test(flag))).forEach((item) => {
        if (item.contentIdea.trim()) {
          store.upsertContentIdea({
            id: `idea-${contentHash(`${item.id}:${item.contentIdea}`).slice(0, 20)}`,
            title: item.contentIdea.trim(),
            source: `${item.author} · ${item.sourceLabel}`,
            ageLabel: item.ageLabel,
          });
        }
      });
      store.purgeExpired();
      const finalStatus = funnel.aiFailedCount ? "partial" as const : "succeeded" as const;
      const finalMessage = funnel.aiFailedCount ? `${funnel.aiFailedCount} of ${funnel.analyzedCount} AI analyses failed. The Today queue still includes fallback-ranked posts for manual review.` : null;
      store.finishRun(runId, finalStatus, qualified.length, finalMessage, totalCost, funnel);
      console.info("[collection] run finished", { runId, eligible: funnel.prequalifiedCount, analyzed: funnel.analyzedCount, aiFailed: funnel.aiFailedCount, shown: qualified.length, cost: totalCost });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Collection failed";
      console.error("[collection] run failed", { runId, error: message });
      store.finishRun(runId, "failed", 0, message, totalCost, funnel);
    }
  })();
  return { accepted: true, runId };
}

export function connectionState(config: RuntimeConfig) {
  const stored = config.secretStore?.connectionState();
  return {
    apify: Boolean(config.apifyToken),
    openrouter: Boolean(config.openrouterKey),
    companiesHouse: Boolean(config.companiesHouseKey),
    sources: stored?.sources ?? {
      apify: config.apifyToken ? "environment" as const : "none" as const,
      openrouter: config.openrouterKey ? "environment" as const : "none" as const,
      companiesHouse: config.companiesHouseKey ? "environment" as const : "none" as const,
    },
  };
}
