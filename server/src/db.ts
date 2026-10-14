import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import type { SignedMandate } from "./mandate.js";
import type { CartLine } from "./paypal.js";

const db = new DatabaseSync(config.databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS mandates (
    id TEXT PRIMARY KEY,
    record TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    paypal_order_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    mandate_id TEXT,
    cart TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    order_id TEXT,
    verified INTEGER NOT NULL,
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS webhook_events_order ON webhook_events (order_id, received_at);
`);

export interface StoredOrder {
  paypalOrderId: string;
  requestId: string;
  mandateId: string | null;
  cart: CartLine[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredEvent {
  id: string;
  eventType: string;
  verified: boolean;
  receivedAt: string;
}

export function saveMandate(signed: SignedMandate): void {
  db.prepare("INSERT INTO mandates (id, record, signature, created_at) VALUES (?, ?, ?, ?)").run(
    signed.mandate.id,
    JSON.stringify(signed.mandate),
    signed.signature,
    signed.mandate.createdAt,
  );
}

export function getMandate(id: string): SignedMandate | null {
  const row = db.prepare("SELECT record, signature FROM mandates WHERE id = ?").get(id) as
    | { record: string; signature: string }
    | undefined;
  return row ? { mandate: JSON.parse(row.record), signature: row.signature } : null;
}

export function saveOrder(order: Omit<StoredOrder, "createdAt" | "updatedAt">): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO orders (paypal_order_id, request_id, mandate_id, cart, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(order.paypalOrderId, order.requestId, order.mandateId, JSON.stringify(order.cart), order.status, now, now);
}

export function getOrder(paypalOrderId: string): StoredOrder | null {
  const row = db.prepare("SELECT * FROM orders WHERE paypal_order_id = ?").get(paypalOrderId) as
    | Record<string, string | null>
    | undefined;
  if (!row) return null;
  return {
    paypalOrderId: row.paypal_order_id!,
    requestId: row.request_id!,
    mandateId: row.mandate_id,
    cart: JSON.parse(row.cart!),
    status: row.status!,
    createdAt: row.created_at!,
    updatedAt: row.updated_at!,
  };
}

export function updateOrderStatus(paypalOrderId: string, status: string): void {
  db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE paypal_order_id = ?").run(
    status,
    new Date().toISOString(),
    paypalOrderId,
  );
}

/** Returns false when PayPal redelivers an event we already stored. */
export function saveWebhookEvent(event: {
  id: string;
  eventType: string;
  orderId: string | null;
  verified: boolean;
  payload: unknown;
}): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO webhook_events (id, event_type, order_id, verified, payload, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.id,
      event.eventType,
      event.orderId,
      event.verified ? 1 : 0,
      JSON.stringify(event.payload),
      new Date().toISOString(),
    );
  return Number(result.changes) > 0;
}

export function listWebhookEvents(orderId: string): StoredEvent[] {
  const rows = db
    .prepare(
      "SELECT id, event_type, verified, received_at FROM webhook_events WHERE order_id = ? ORDER BY received_at",
    )
    .all(orderId) as { id: string; event_type: string; verified: number; received_at: string }[];
  return rows.map((r) => ({ id: r.id, eventType: r.event_type, verified: r.verified === 1, receivedAt: r.received_at }));
}
