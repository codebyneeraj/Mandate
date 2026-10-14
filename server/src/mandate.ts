import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// What the buyer signs: the only spending the agent is allowed to do.
export const MandateTermsSchema = z.object({
  goal: z.string().trim().min(3).max(500),
  currency: z.literal("USD"),
  budgetCents: z.number().int().positive(),
  // Total units across all cart lines, not distinct products.
  maxItems: z.number().int().positive(),
  allowedCategories: z.array(z.string().trim().min(1)).min(1),
  allowedMerchants: z.array(z.string().trim().min(1)).min(1),
  expiresAt: z.string().datetime(),
});

export type MandateTerms = z.infer<typeof MandateTermsSchema>;

export interface Mandate extends MandateTerms {
  id: string;
  version: 1;
  createdAt: string;
}

export interface SignedMandate {
  mandate: Mandate;
  signature: string;
}

// Stable JSON with sorted keys, so the same record always hashes and signs the same way.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hmac(mandate: Mandate, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(mandate)).digest("hex");
}

export function signMandate(terms: MandateTerms, secret: string, now = new Date()): SignedMandate {
  const mandate: Mandate = { ...terms, id: randomUUID(), version: 1, createdAt: now.toISOString() };
  return { mandate, signature: hmac(mandate, secret) };
}

export function verifyMandateSignature(signed: SignedMandate, secret: string): boolean {
  const expected = Buffer.from(hmac(signed.mandate, secret), "hex");
  const actual = Buffer.from(signed.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isMandateExpired(mandate: Mandate, now = new Date()): boolean {
  return Date.parse(mandate.expiresAt) <= now.getTime();
}
