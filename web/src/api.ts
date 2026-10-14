export interface CartLine {
  sku: string;
  name: string;
  category: string;
  unitPriceCents: number;
  quantity: number;
}

export interface OrderEvent {
  id: string;
  eventType: string;
  verified: boolean;
  receivedAt: string;
}

export interface OrderView {
  paypalOrderId: string;
  status: string;
  paypalStatus: string;
  cart: CartLine[];
  events: OrderEvent[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  createTestOrder: () =>
    request<{ id: string; status: string; approveUrl: string }>("/api/orders/test", { method: "POST" }),
  captureOrder: (id: string) =>
    request<{ id: string; status: string }>(`/api/orders/${encodeURIComponent(id)}/capture`, { method: "POST" }),
  getOrder: (id: string) => request<OrderView>(`/api/orders/${encodeURIComponent(id)}`),
};
