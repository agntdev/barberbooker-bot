// slots feature: owner predefines bookable time slots (docs/details.md §10).
// Owner-only. Flow: barber → service → date → enter start times (text) →
// confirm → insert one time_slots row per accepted time. Manual predefinition
// only — no dynamic generation from workload (general.md Non-Goal).

import { inlineButton, inlineKeyboard, type InlineButton } from "@agntdev/bot-toolkit";
import { dateLabel, shopToday, slotIsPast, slotLabel } from "../config.js";
import type { BotApp, Ctx, Feature } from "../bot.js";
import { navRow } from "../menu.js";
import type { User } from "../store.js";

const DATE_HORIZON = 14;

/** today + next N-1 dates (YYYY-MM-DD), shop-local. */
function nextDates(today: string, n: number): string[] {
  const start = new Date(`${today}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** "9:0" / "09:00" / "14:30" → "HH:MM" (24h), or null if invalid. */
function normalizeTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

async function denyIfNotOwner(app: BotApp, ctx: Ctx, user: User): Promise<boolean> {
  if (app.isOwner(user)) return false;
  await app.showMenu(ctx, user, "That's an owner-only action.");
  return true;
}

async function startSlots(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  user.state = "menu";
  ctx.session.slots = {};
  const barbers = app.store.activeBarbers();
  if (barbers.length === 0) {
    await app.showMenu(ctx, user, "Add a barber first (/barbers).");
    return;
  }
  const rows: InlineButton[][] = barbers.map((b) => [inlineButton(b.name, `slots:barber:${b.id}`)]);
  rows.push(navRow("menu:home"));
  await ctx.reply("Predefine slots — choose a barber:", { reply_markup: inlineKeyboard(rows) });
}

async function slotsCallback(app: BotApp, ctx: Ctx, data: string, user: User): Promise<void> {
  await ctx.answerCallbackQuery();
  if (!app.isOwner(user)) {
    await app.showMenu(ctx, user, "That's an owner-only action.");
    return;
  }
  const parts = data.split(":");
  const action = parts[1];
  const draft = (ctx.session.slots ??= {});

  if (action === "barber") {
    draft.barberId = Number(parts[2]);
    const services = app.store.activeServices();
    if (services.length === 0) {
      await app.showMenu(ctx, user, "Add a service first (/services).");
      return;
    }
    const rows: InlineButton[][] = services.map((s) => [inlineButton(s.name, `slots:svc:${s.id}`)]);
    rows.push(navRow("menu:home"));
    await ctx.reply("Choose a service:", { reply_markup: inlineKeyboard(rows) });
    return;
  }

  if (action === "svc") {
    draft.serviceId = Number(parts[2]);
    const dates = nextDates(shopToday(app.cfg.shopTz), DATE_HORIZON);
    const rows: InlineButton[][] = [];
    for (let i = 0; i < dates.length; i += 2) {
      rows.push(
        dates.slice(i, i + 2).map((d) => inlineButton(dateLabel(d), `slots:date:${d}`)),
      );
    }
    rows.push(navRow("menu:home"));
    await ctx.reply("Choose a date:", { reply_markup: inlineKeyboard(rows) });
    return;
  }

  if (action === "date") {
    draft.date = parts[2];
    user.state = "slots:times";
    const existing = app.store
      .slotsFor(draft.serviceId!, draft.date!, draft.barberId!)
      .map((s) => s.startTime);
    const note = existing.length ? `\nAlready defined: ${existing.join(", ")}` : "";
    await ctx.reply(
      `Enter start times for ${dateLabel(draft.date!)}, comma-separated (e.g. "10:00, 11:30, 14:00").${note}`,
    );
    return;
  }

  if (action === "save") {
    const times = draft.times ?? [];
    if (draft.barberId == null || draft.serviceId == null || !draft.date || times.length === 0) {
      await app.showMenu(ctx, user, "Nothing to add.");
      return;
    }
    for (const t of times) {
      app.store.addSlot(draft.barberId, draft.serviceId, draft.date, t);
    }
    ctx.session.slots = {};
    await app.showMenu(ctx, user, `Added ${times.length} slot(s): ${times.join(", ")}.`);
  }
}

async function slotsState(app: BotApp, ctx: Ctx, text: string, user: User): Promise<void> {
  const draft = ctx.session.slots;
  if (!draft || draft.serviceId == null || draft.barberId == null || !draft.date) {
    await app.showMenu(ctx, user);
    return;
  }
  const existing = new Set(
    app.store.slotsFor(draft.serviceId, draft.date, draft.barberId).map((s) => s.startTime),
  );

  const accepted: string[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(",")) {
    const piece = raw.trim();
    if (!piece) continue;
    const norm = normalizeTime(piece);
    if (!norm) {
      skipped.push(`${piece} (invalid)`);
    } else if (existing.has(norm) || accepted.includes(norm)) {
      skipped.push(`${norm} (duplicate)`);
    } else if (slotIsPast(draft.date, norm, app.cfg.shopTz)) {
      skipped.push(`${norm} (past)`);
    } else {
      accepted.push(norm);
    }
  }

  if (accepted.length === 0) {
    await ctx.reply(
      `No valid new times. ${skipped.length ? `Skipped: ${skipped.join(", ")}. ` : ""}Try again, e.g. "10:00, 11:30".`,
    );
    return;
  }

  draft.times = accepted;
  const skipNote = skipped.length ? `\nSkipping: ${skipped.join(", ")}.` : "";
  await ctx.reply(
    `Add these slots on ${dateLabel(draft.date)}?\n${accepted.join(", ")}${skipNote}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Confirm", "slots:save"), inlineButton("⬅️ Back", "menu:home")],
      ]),
    },
  );
}

export const slotsFeature: Feature = (app) => {
  app.bot.command("slots", async (ctx) => {
    const user = app.store.upsertUser(ctx.from!.id);
    if (await denyIfNotOwner(app, ctx, user)) return;
    await startSlots(app, ctx, user);
  });
  app.onMenu("slots", async (ctx, user) => {
    if (await denyIfNotOwner(app, ctx, user)) return;
    await startSlots(app, ctx, user);
  });
  app.onCallback("slots", (ctx, data, user) => slotsCallback(app, ctx, data, user));
  app.onState("slots", (ctx, text, user) => slotsState(app, ctx, text, user));
};
