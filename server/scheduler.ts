import cron from "node-cron";
import type { SignalDeskStore } from "./db.js";
import { collectSignals, type RuntimeConfig } from "./services/collection.js";

export function startScheduler(store: SignalDeskStore, config: RuntimeConfig) {
  const [hour, minute] = store.getSettings().refreshTime.split(":").map(Number);
  const task = cron.schedule(`${minute} ${hour} * * *`, () => { void collectSignals(store, config, "schedule"); }, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return task;
}
