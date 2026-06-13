// NotificationService: owner alerts on booking / cancel / reschedule
// (docs/details.md §11). The single emit point — booking (§4) and the manage
// flows (§6, §7) call emitNotification. It writes a `notifications` row and, if
// OWNER_TG_ID is configured, sends the owner a message; otherwise it logs and
// skips (graceful degradation, no crash).

import type { BotApp } from "./bot.js";
import { slotLabel } from "./config.js";
import type { Appointment, NotificationType } from "./store.js";

/** Build the owner-facing message for an appointment event. Exported for tests
 *  and so the manage flow can reuse it. `oldSlotLabel` is required for the
 *  reschedule "was … now …" wording. */
export function renderOwnerMessage(
  app: BotApp,
  type: NotificationType,
  appt: Appointment,
  oldSlotLabel?: string,
): string {
  const store = app.store;
  const client = store.users.get(appt.clientTgId)?.name ?? `#${appt.clientTgId}`;
  const service = store.getService(appt.serviceId)?.name ?? "service";
  const barber = store.getBarber(appt.barberId)?.name ?? "barber";
  const slot = store.getSlot(appt.timeSlotId);
  const when = slot ? slotLabel(slot.date, slot.startTime) : "unknown time";

  switch (type) {
    case "booking":
      return `🆕 New booking: ${service} with ${barber} — ${when} — client ${client}.`;
    case "cancel":
      return `❌ Cancelled: ${service} with ${barber} — ${when} — client ${client}.`;
    case "reschedule":
      return `🔁 Rescheduled: ${service} with ${barber} — was ${oldSlotLabel ?? "?"}, now ${when} — client ${client}.`;
  }
}

/** Record a notification and deliver it to the owner (or log it if no owner is
 *  configured). Never throws — a delivery failure must not break the flow. */
export async function emitNotification(
  app: BotApp,
  type: NotificationType,
  appt: Appointment,
  oldSlotLabel?: string,
): Promise<void> {
  app.store.addNotification(type, appt.id);
  const text = renderOwnerMessage(app, type, appt, oldSlotLabel);

  if (app.cfg.ownerTgId === null) {
    console.log("[barberbooker] owner notification (OWNER_TG_ID unset):", text);
    return;
  }
  try {
    await app.bot.api.sendMessage(app.cfg.ownerTgId, text);
  } catch (err) {
    console.error("[barberbooker] owner notification failed:", err);
  }
}
