# Mandate

Signed spending limits for AI shopping agents. The buyer signs a mandate (budget, categories, merchants, item limit, expiry), and every cart the agent builds is checked against it before PayPal creates the order.

> Status: Week 1 foundation. Signed mandates and a sandbox order flow (create, approve, capture, webhook) work. The shopper agent and guard come next. See [plan.md](plan.md).

## Stack

- `server/`: Node + Express + TypeScript, PayPal Orders v2 (sandbox), SQLite via `node:sqlite`
- `web/`: React + Vite
- LLM: any OpenAI-compatible endpoint (Groq or Gemini free tier), configured in `.env`

## Run locally

Requires Node 22.13 or later.

1. In the [PayPal developer dashboard](https://developer.paypal.com/dashboard/applications/sandbox), create a sandbox REST app and copy its client ID and secret.
2. Copy `.env.example` to `.env` and fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `MANDATE_SIGNING_SECRET`.
3. Install and start:

   ```sh
   npm install
   npm run dev
   ```

4. Open http://localhost:5173, select **Create sandbox order**, and log in with your sandbox **buyer** account to approve.

Run the tests with `npm test`.

## Deploy to Render

1. Push the repo to GitHub, then in Render choose **New > Blueprint** and select the repo. It reads `render.yaml`.
2. Enter `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` when prompted.
3. In the PayPal sandbox app, add a webhook pointing at `https://<your-service>.onrender.com/api/paypal/webhook` and subscribe to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED` and `PAYMENT.CAPTURE.REFUNDED`.
4. Copy the webhook ID into Render as `PAYPAL_WEBHOOK_ID` and redeploy.

Webhook events are verified with PayPal's verify-signature API. Unverified events (including ones from the webhook simulator) are stored but never change an order's status.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/mandates` | Sign and store a mandate |
| GET | `/api/mandates/:id` | Fetch a mandate with signature and expiry checks |
| POST | `/api/orders/test` | Create the fixed sandbox test order |
| POST | `/api/orders/:id/capture` | Capture an approved order (idempotent) |
| GET | `/api/orders/:id` | Order status plus webhook timeline |
| POST | `/api/paypal/webhook` | PayPal webhook receiver |

## License

MIT
