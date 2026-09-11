import "dotenv/config";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { SignalDeskStore } from "./db.js";
import { LocalSecretStore } from "./secrets.js";
import { startScheduler } from "./scheduler.js";

const port = Number(process.env.SIGNAL_DESK_PORT ?? 8787);
const secretStore = new LocalSecretStore("data/secrets.json", {
  apifyToken: process.env.APIFY_API_TOKEN,
  openrouterKey: process.env.OPENROUTER_API_KEY,
  companiesHouseKey: process.env.COMPANIES_HOUSE_API_KEY,
});
const credentials = secretStore.values();
const config = {
  ...credentials,
  secretStore,
  openrouterModel: process.env.OPENROUTER_MODEL ?? "inception/mercury-2.5-preview",
  maxChargeUsd: Number(process.env.SIGNAL_DESK_MAX_CHARGE_USD ?? 2),
};
const store = new SignalDeskStore();
const app = createApp(store, config);
startScheduler(store, config);

const clientPath = resolve("dist/client");
app.use(express.static(clientPath));
app.get("/{*splat}", (_request, response) => response.sendFile(resolve(clientPath, "index.html")));
app.listen(port, "127.0.0.1", () => {
  console.log(`Signal Desk API running at http://127.0.0.1:${port}`);
});
