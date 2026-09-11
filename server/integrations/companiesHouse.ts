import type { CompanyMatch } from "../../shared/types.js";
import { isAtLeastTwoYears } from "../services/scoring.js";

type CompanySearchItem = { company_name: string; company_number: string; company_status: string; date_of_creation?: string; address_snippet?: string };

const normalizeName = (name: string) => name.toLowerCase().replace(/\b(limited|ltd|llp|studio|agency)\b/g, "").replace(/[^a-z0-9]/g, "");
export function nameSimilarity(left: string, right: string) {
  const a = normalizeName(left); const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.84;
  const leftPairs = new Set(Array.from({ length: Math.max(0, a.length - 1) }, (_, i) => a.slice(i, i + 2)));
  const rightPairs = new Set(Array.from({ length: Math.max(0, b.length - 1) }, (_, i) => b.slice(i, i + 2)));
  let common = 0; for (const pair of leftPairs) if (rightPairs.has(pair)) common += 1;
  return (2 * common) / Math.max(1, leftPairs.size + rightPairs.size);
}

export class CompaniesHouseClient {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}
  async match(companyName: string, authorName: string, authorHeadline: string): Promise<CompanyMatch> {
    const auth = Buffer.from(`${this.apiKey}:`).toString("base64");
    const response = await this.fetcher(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=5`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Companies House request failed (${response.status})`);
    const payload = await response.json() as { items?: CompanySearchItem[] };
    const candidates = (payload.items ?? []).map((item) => ({ item, similarity: nameSimilarity(companyName, item.company_name) })).sort((a, b) => b.similarity - a.similarity);
    const best = candidates[0];
    if (!best || best.similarity < 0.66) return { companyName, ukCompany: false, founderLed: /founder|owner/i.test(authorHeadline) ? "likely" : "unknown", ageConfidence: "unknown", matchConfidence: best?.similarity ?? 0 };
    const ageVerified = Boolean(best.item.date_of_creation && isAtLeastTwoYears(best.item.date_of_creation));
    let founderLed: CompanyMatch["founderLed"] = /founder|owner/i.test(authorHeadline) ? "likely" : "unknown";
    try {
      const officersResponse = await this.fetcher(`https://api.company-information.service.gov.uk/company/${best.item.company_number}/officers?items_per_page=100`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15_000) });
      if (officersResponse.ok) {
        const officers = await officersResponse.json() as { items?: { name: string; resigned_on?: string }[] };
        const authorParts = authorName.toLowerCase().split(/\s+/).filter((part) => part.length > 2);
        const officerMatch = (officers.items ?? []).some((officer) => !officer.resigned_on && authorParts.every((part) => officer.name.toLowerCase().includes(part)));
        if (officerMatch && /founder|owner/i.test(authorHeadline)) founderLed = "verified";
      }
    } catch { /* Officer data is supporting evidence only. */ }
    return { companyName: best.item.company_name, companyNumber: best.item.company_number, status: best.item.company_status, dateOfCreation: best.item.date_of_creation, ageYears: best.item.date_of_creation ? Math.floor((Date.now() - new Date(best.item.date_of_creation).getTime()) / 31_556_952_000) : undefined, ukCompany: best.item.company_status === "active", founderLed, ageConfidence: ageVerified ? "verified" : "unknown", matchConfidence: best.similarity };
  }
}
