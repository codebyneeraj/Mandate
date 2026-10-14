import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJson,
  isMandateExpired,
  signMandate,
  verifyMandateSignature,
  type MandateTerms,
} from "./mandate.js";

const secret = "test-secret";
const terms: MandateTerms = {
  goal: "A phone stand under $15",
  currency: "USD",
  budgetCents: 1500,
  maxItems: 1,
  allowedCategories: ["phone-accessories"],
  allowedMerchants: ["mandate-demo-store"],
  expiresAt: "2026-11-01T00:00:00.000Z",
};

test("a freshly signed mandate verifies", () => {
  assert.equal(verifyMandateSignature(signMandate(terms, secret), secret), true);
});

test("changing any term breaks the signature", () => {
  const signed = signMandate(terms, secret);
  const raisedBudget = { ...signed, mandate: { ...signed.mandate, budgetCents: 10_000 } };
  const extraMerchant = {
    ...signed,
    mandate: { ...signed.mandate, allowedMerchants: ["mandate-demo-store", "evil-store"] },
  };
  assert.equal(verifyMandateSignature(raisedBudget, secret), false);
  assert.equal(verifyMandateSignature(extraMerchant, secret), false);
});

test("a different secret or a malformed signature fails", () => {
  const signed = signMandate(terms, secret);
  assert.equal(verifyMandateSignature(signed, "other-secret"), false);
  assert.equal(verifyMandateSignature({ ...signed, signature: "abc" }, secret), false);
});

test("canonical JSON ignores key order", () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
});

test("expiry is checked against the given time", () => {
  const { mandate } = signMandate(terms, secret);
  assert.equal(isMandateExpired(mandate, new Date("2026-10-31T23:59:59Z")), false);
  assert.equal(isMandateExpired(mandate, new Date("2026-11-01T00:00:00Z")), true);
});
