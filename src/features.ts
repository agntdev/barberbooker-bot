// Feature registry (docs/work_breakdown.json). Each dev task contributes an
// installer; ORDER MATTERS — command/menu features register first, and the
// router's generic callback/text fallbacks (wired inside buildBot, after the
// installers run) always come last.

import type { Feature } from "./bot.js";

export const defaultFeatures: Feature[] = [
  // catalog       → /services + /barbers (installed by its task)
  // notifications → owner NotificationService (installed by its task)
  // slots         → /slots predefinition (installed by its task)
  // booking       → /book flow (installed by its task)
  // manage        → /my, /cancel, /reschedule (installed by its task)
];
