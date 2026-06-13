// Role main menus + /help text (docs/details.md §2, §3). All user-facing copy
// here; flows reuse navRow for the Back/Menu controls each step shows.

import { inlineButton, inlineKeyboard, type InlineKeyboardMarkup } from "@agntdev/bot-toolkit";
import type { Role } from "./store.js";

export function mainMenu(role: Role): InlineKeyboardMarkup {
  const rows = [
    [inlineButton("📅 Book", "menu:book")],
    [inlineButton("📋 My appointments", "menu:my")],
    [inlineButton("❌ Cancel", "menu:cancel"), inlineButton("🔁 Reschedule", "menu:reschedule")],
  ];
  if (role === "owner") {
    rows.push([
      inlineButton("🧰 Services", "menu:services"),
      inlineButton("💈 Barbers", "menu:barbers"),
    ]);
    rows.push([inlineButton("🗓 Time slots", "menu:slots")]);
  }
  return inlineKeyboard(rows);
}

/** `⬅️ Back` + `🏠 Menu` row appended to every in-flow step (details.md §2). */
export function navRow(backData: string): InlineKeyboardMarkup["inline_keyboard"][number] {
  return [inlineButton("⬅️ Back", backData), inlineButton("🏠 Menu", "menu:home")];
}

const clientHelp = [
  "/book — book an appointment",
  "/my — view & filter your appointments",
  "/cancel — cancel an upcoming appointment",
  "/reschedule — move an appointment to a new slot",
  "/help — this cheat-sheet",
];

const ownerHelp = [
  "/services — manage the service catalog",
  "/barbers — manage barber profiles",
  "/slots — predefine bookable time slots",
];

export function helpText(role: Role): string {
  const lines = ["Commands:", ...clientHelp];
  if (role === "owner") lines.push("", "Owner:", ...ownerHelp);
  return lines.join("\n");
}
