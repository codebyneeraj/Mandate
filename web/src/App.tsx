import { useEffect, useRef, useState } from "react";
import { api, type OrderView } from "./api";

export function App() {
  return (
    <main>
      <h1>Mandate</h1>
      <p className="tagline">An agent can only spend what you signed for.</p>
      {window.location.pathname === "/return" ? <ReturnPage /> : <HomePage />}
    </main>
  );
}

function HomePage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelled = new URLSearchParams(window.location.search).has("cancelled");

  async function startOrder() {
    setBusy(true);
    setError(null);
    try {
      const order = await api.createTestOrder();
      window.location.href = order.approveUrl;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Sandbox smoke test</h2>
      <p>Creates a $4.99 phone-stand order, sends you to PayPal to approve it, then captures it on return.</p>
      {cancelled && <p className="notice">You cancelled the last order in PayPal.</p>}
      <button onClick={startOrder} disabled={busy}>
        {busy ? "Creating order…" : "Create sandbox order"}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function ReturnPage() {
  const orderId = new URLSearchParams(window.location.search).get("token");
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const captureStarted = useRef(false);

  useEffect(() => {
    if (!orderId || captureStarted.current) return;
    captureStarted.current = true;
    api.captureOrder(orderId).catch((e: Error) => setError(e.message));
  }, [orderId]);

  // Poll so webhook events show up in the timeline as PayPal delivers them.
  useEffect(() => {
    if (!orderId) return;
    const load = () => api.getOrder(orderId).then(setOrder, (e: Error) => setError(e.message));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [orderId]);

  if (!orderId) return <p className="error">PayPal did not return an order ID.</p>;

  return (
    <section>
      <h2>Order {orderId}</h2>
      {error && <p className="error">{error}</p>}
      {order && (
        <>
          <p>
            Our status: <strong>{order.status}</strong> · PayPal status: <strong>{order.paypalStatus}</strong>
          </p>
          <h3>Webhook timeline</h3>
          {order.events.length === 0 ? (
            <p className="muted">No webhook events yet. They only arrive at the public Render URL.</p>
          ) : (
            <ol>
              {order.events.map((e) => (
                <li key={e.id}>
                  {new Date(e.receivedAt).toLocaleTimeString()} · {e.eventType}{" "}
                  <span className={e.verified ? "ok" : "warn"}>{e.verified ? "verified" : "unverified"}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <p>
        <a href="/">Start another order</a>
      </p>
    </section>
  );
}
