import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The .env file lives at the repo root, two levels up from both src/ and dist/.
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:5173",
  databasePath: process.env.DATABASE_PATH ?? "mandate.db",
  mandateSecret: required("MANDATE_SIGNING_SECRET"),
  paypal: {
    baseUrl: process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com",
    clientId: required("PAYPAL_CLIENT_ID"),
    clientSecret: required("PAYPAL_CLIENT_SECRET"),
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
  },
};
