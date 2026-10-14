import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { config } from "./config.js";

export interface CartLine {
  sku: string;
  name: string;
  category: string;
  unitPriceCents: number;
  quantity: number;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalOrder {
  id: string;
  status: string;
  links?: PayPalLink[];
}

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource?: {
    id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
}

export class PayPalError extends Error {
  readonly debugId: string | undefined;

  constructor(step: string, readonly status: number, readonly details: string) {
    super(`PayPal ${step} failed (${status})`);
    try {
      this.debugId = (JSON.parse(details) as { debug_id?: string }).debug_id;
    } catch {
      this.debugId = undefined;
    }
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { baseUrl, clientId, clientSecret } = config.paypal;
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new PayPalError("token request", res.status, await res.text());

  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Sandbox tokens last 3 to 8 hours; refresh five minutes early.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return cachedToken.value;
}

async function paypalRequest<T>(
  step: string,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; requestId?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Every POST carries a PayPal-Request-Id so a retry never creates a second order or capture.
  if (method === "POST") headers["PayPal-Request-Id"] = options.requestId ?? randomUUID();
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);

  for (let attempt = 0; ; attempt++) {
    headers.Authorization = `Bearer ${await getAccessToken()}`;
    const res = await fetch(`${config.paypal.baseUrl}${path}`, { method, headers, body });
    if (res.status === 401 && attempt === 0) {
      cachedToken = null;
      continue;
    }
    if (!res.ok) throw new PayPalError(step, res.status, await res.text());
    return (await res.json()) as T;
  }
}

function money(cents: number) {
  return { currency_code: "USD", value: (cents / 100).toFixed(2) };
}

export async function createOrder(input: {
  requestId: string;
  lines: CartLine[];
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; status: string; approveUrl: string }> {
  const totalCents = input.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const order = await paypalRequest<PayPalOrder>("create order", "POST", "/v2/checkout/orders", {
    requestId: input.requestId,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { ...money(totalCents), breakdown: { item_total: money(totalCents) } },
          items: input.lines.map((line) => ({
            name: line.name.slice(0, 127),
            sku: line.sku,
            quantity: String(line.quantity),
            unit_amount: money(line.unitPriceCents),
            category: "PHYSICAL_GOODS",
          })),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Mandate demo store",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
  });

  const approveUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!approveUrl) throw new PayPalError("create order", 200, JSON.stringify(order));
  return { id: order.id, status: order.status, approveUrl };
}

export function captureOrder(orderId: string, requestId: string): Promise<PayPalOrder> {
  return paypalRequest("capture order", "POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    requestId,
  });
}

export function getOrder(orderId: string): Promise<PayPalOrder> {
  return paypalRequest("get order", "GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

export async function verifyWebhookSignature(headers: IncomingHttpHeaders, event: WebhookEvent): Promise<boolean> {
  const header = (name: string) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const fields = {
    auth_algo: header("paypal-auth-algo"),
    cert_url: header("paypal-cert-url"),
    transmission_id: header("paypal-transmission-id"),
    transmission_sig: header("paypal-transmission-sig"),
    transmission_time: header("paypal-transmission-time"),
  };
  if (!config.paypal.webhookId || Object.values(fields).some((v) => !v)) return false;

  const result = await paypalRequest<{ verification_status: string }>(
    "verify webhook",
    "POST",
    "/v1/notifications/verify-webhook-signature",
    { body: { ...fields, webhook_id: config.paypal.webhookId, webhook_event: event } },
  );
  return result.verification_status === "SUCCESS";
}

export function orderIdFromEvent(event: WebhookEvent): string | null {
  if (event.resource_type === "checkout-order") return event.resource?.id ?? null;
  return event.resource?.supplementary_data?.related_ids?.order_id ?? null;
}
