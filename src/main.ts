// Runtime entry (toolkit Dockerfile CMD ["node","dist/main.js"]).
// BOT_TOKEN is injected at runtime by the deploy container — never baked.

import { buildBot } from "./bot.js";
import { configFromEnv } from "./config.js";
import { defaultFeatures } from "./features.js";
import { Store } from "./store.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("[barberbooker] BOT_TOKEN is required");
  process.exit(1);
}

const store = new Store();
const bot = buildBot(token, store, configFromEnv(), defaultFeatures);

// Graceful container shutdown (toolkit Dockerfile sends SIGTERM): finish the
// in-flight update, then stop polling.
process.once("SIGTERM", () => void bot.stop());
process.once("SIGINT", () => void bot.stop());

console.log("[barberbooker] starting long polling");
void bot.start();
