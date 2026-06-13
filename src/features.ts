// Feature registry (docs/work_breakdown.json). Each dev task contributes an
// installer; ORDER MATTERS — command/menu features register first, and the
// router's generic callback/text fallbacks (wired inside buildBot, after the
// installers run) always come last.

import type { Feature } from "./bot.js";
import { catalogFeature } from "./features/catalog.js";
import { slotsFeature } from "./features/slots.js";
import { bookingFeature } from "./features/booking.js";
import { manageFeature } from "./features/manage.js";

export const defaultFeatures: Feature[] = [
  catalogFeature, // /services + /barbers (owner CRUD)
  slotsFeature, // /slots (owner predefines time slots)
  bookingFeature, // /book (client booking flow)
  manageFeature, // /my, /cancel, /reschedule
  // notifications → owner NotificationService (installed by its task)
  // slots         → /slots predefinition (installed by its task)
  // booking       → /book flow (installed by its task)
  // manage        → /my, /cancel, /reschedule (installed by its task)
];
