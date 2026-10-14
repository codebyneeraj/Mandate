import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import * as store from "./db.js";
import { MandateTermsSchema, isMandateExpired, signMandate, verifyMandateSignature } from "./mandate.js";
import {
  PayPalError,
  captureOrder,
  createOrder,
  getOrder,
  orderIdFromEvent,
  verifyWebhookSignature,
  type CartLine,
  type WebhookEvent,
} from "./paypal.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/mandates", (req, res) => {
  const parsed = MandateTermsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid mandate", issues: parsed.error.issues });
    return;
  }
  if (Date.parse(parsed.data.expiresAt) <= Date.now()) {
    res.status(400).json({ error: "expiresAt must be in the future" });
    return;
  }
  const signed = signMandate(parsed.data, config.mandateSecret);
  store.saveMandate(signed);
  res.status(201).json(signed);
});

app.get("/api/mandates/:id", (req, res) => {
  const signed = store.getMandate(req.params.id);
  if (!signed) {
    res.status(404).json({ error: "Mandate not found" });
    return;
  }
  res.json({
    ...signed,
    signatureValid: verifyMandateSignature(signed, config.mandateSecret),
    expired: isMandateExpired(signed.mandate),
  });
});

// Week 1 smoke test: one fixed cart straight to PayPal, before the agent and guard exist.
const TEST_CART: CartLine[] = [
  { sku: "TEST-PHONE-STAND", name: "Phone stand", category: "phone-accessories", unitPriceCents: 499, quantity: 1 },
];

app.post("/api/orders/test", async (_req, res) => {
  const requestId = randomUUID();
  const order = await createOrder({
    requestId,
    lines: TEST_CART,
    returnUrl: `${config.publicUrl}/return`,
    cancelUrl: `${config.publicUrl}/?cancelled=1`,
  });
  store.saveOrder({ paypalOrderId: order.id, requestId, mandateId: null, cart: TEST_CART, status: order.status });
  res.status(201).json(order);
});

app.post("/api/orders/:id/capture", async (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  // A fixed request ID means a repeat capture (page refresh, React strict mode) replays the first result.
  const captured = await captureOrder(order.paypalOrderId, `capture-${order.paypalOrderId}`);
  store.updateOrderStatus(order.paypalOrderId, captured.status);
  res.json({ id: captured.id, status: captured.status });
});

app.get("/api/orders/:id", async (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const live = await getOrder(order.paypalOrderId);
  res.json({ ...order, paypalStatus: live.status, events: store.listWebhookEvents(order.paypalOrderId) });
});

const STATUS_FROM_EVENT: Record<string, string> = {
  "CHECKOUT.ORDER.APPROVED": "APPROVED",
  "CHECKOUT.ORDER.COMPLETED": "COMPLETED",
  "PAYMENT.CAPTURE.COMPLETED": "COMPLETED",
  "PAYMENT.CAPTURE.DENIED": "CAPTURE_DENIED",
  "PAYMENT.CAPTURE.REFUNDED": "REFUNDED",
};

app.post("/api/paypal/webhook", async (req, res) => {
  const event = req.body as WebhookEvent;
  if (!event?.id || !event.event_type) {
    res.status(400).json({ error: "Not a PayPal webhook event" });
    return;
  }
  const verified = await verifyWebhookSignature(req.headers, event);
  const orderId = orderIdFromEvent(event);
  const isNew = store.saveWebhookEvent({ id: event.id, eventType: event.event_type, orderId, verified, payload: event });

  // Unverified events stay in the audit trail but never change an order's status.
  const next = STATUS_FROM_EVENT[event.event_type];
  const order = orderId ? store.getOrder(orderId) : null;
  // Webhooks can arrive out of order, so a late APPROVED must not overwrite COMPLETED.
  const lateApproval = next === "APPROVED" && order && !["CREATED", "PAYER_ACTION_REQUIRED"].includes(order.status);
  if (isNew && verified && order && next && !lateApproval) store.updateOrderStatus(order.paypalOrderId, next);

  res.sendStatus(200);
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// In production the server also hosts the built React app.
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("/{*path}", (_req, res) => {
    res.sendFile("index.html", { root: webDist });
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof PayPalError) {
    console.error(err.message, err.details);
    res.status(502).json({ error: err.message, debugId: err.debugId });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal error" });
});

app.listen(config.port, () => {
  console.log(`Mandate server on http://localhost:${config.port} (public URL ${config.publicUrl})`);
});
