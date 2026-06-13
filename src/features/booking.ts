// booking feature: client books an appointment (docs/details.md §4).
// Inline state machine: service → optional barber → date → slot → confirm.
// Confirm is transactional/race-safe and emits a booking notification (§11).
// Availability is derived (a slot is free iff untaken and not in the past) —
// no real-time availability feed (general.md Non-Goal).

import { inlineButton, inlineKeyboard, type InlineButton } from "@agntdev/bot-toolkit";
import { dateLabel, shopToday, slotIsPast, slotLabel } from "../config.js";
import type { BotApp, Ctx, Feature } from "../bot.js";
import { navRow } from "../menu.js";
import { emitNotification } from "../notifications.js";
import type { TimeSlot, User } from "../store.js";

const HORIZON = 14;

function nextDates(today: string, n: number): string[] {
  const start = new Date(`${today}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
  return out;
}

/** Untaken, not-past predefined slots for a service on a date (optionally a barber). */
function availableSlots(app: BotApp, serviceId: number, date: string, barberId?: number): TimeSlot[] {
  return app.store
    .slotsFor(serviceId, date, barberId)
    .filter((s) => !app.store.slotTaken(s.id) && !slotIsPast(s.date, s.startTime, app.cfg.shopTz));
}

function datesWithAvailability(app: BotApp, serviceId: number, barberId?: number): string[] {
  return nextDates(shopToday(app.cfg.shopTz), HORIZON).filter(
    (d) => availableSlots(app, serviceId, d, barberId).length > 0,
  );
}

// ── step renderers ──

async function renderServices(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  user.state = "menu";
  ctx.session.book = {};
  const services = app.store.activeServices();
  if (services.length === 0) {
    await app.showMenu(ctx, user, "No services available yet.");
    return;
  }
  const rows: InlineButton[][] = services.map((s) => [
    inlineButton(`${s.name} · ${s.durationMin}m`, `bk:svc:${s.id}`),
  ]);
  rows.push(navRow("menu:home"));
  await ctx.reply("Book — choose a service:", { reply_markup: inlineKeyboard(rows) });
}

async function renderBarbers(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  const serviceId = ctx.session.book?.serviceId;
  if (serviceId == null) return renderServices(app, ctx, user);
  if (datesWithAvailability(app, serviceId).length === 0) {
    await app.showMenu(ctx, user, "No free slots for this service yet.");
    return;
  }
  const rows: InlineButton[][] = app.store
    .activeBarbers()
    .filter((b) => datesWithAvailability(app, serviceId, b.id).length > 0)
    .map((b) => [inlineButton(`${b.name} · ${b.specialty}`, `bk:barber:${b.id}`)]);
  rows.push([inlineButton("Any barber ⏭ Skip", "bk:barber:skip")]);
  rows.push(navRow("bk:back:svc"));
  await ctx.reply("Choose a barber (or skip):", { reply_markup: inlineKeyboard(rows) });
}

async function renderDates(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  const book = ctx.session.book;
  if (!book || book.serviceId == null) return renderServices(app, ctx, user);
  const barberId = typeof book.barberId === "number" ? book.barberId : undefined;
  const dates = datesWithAvailability(app, book.serviceId, barberId);
  if (dates.length === 0) {
    await app.showMenu(ctx, user, "No free dates — try another barber.");
    return;
  }
  const rows: InlineButton[][] = [];
  for (let i = 0; i < dates.length; i += 2) {
    rows.push(dates.slice(i, i + 2).map((d) => inlineButton(dateLabel(d), `bk:date:${d}`)));
  }
  rows.push(navRow("bk:back:barber"));
  await ctx.reply("Choose a date:", { reply_markup: inlineKeyboard(rows) });
}

async function renderSlots(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  const book = ctx.session.book;
  if (!book || book.serviceId == null || !book.date) return renderDates(app, ctx, user);
  const barberId = typeof book.barberId === "number" ? book.barberId : undefined;
  const slots = availableSlots(app, book.serviceId, book.date, barberId);
  if (slots.length === 0) {
    await app.showMenu(ctx, user, "That date just filled up — please pick another.");
    return;
  }
  const anyBarber = book.barberId === "any";
  const rows: InlineButton[][] = slots.map((s) => {
    const label = anyBarber
      ? `${s.startTime} · ${app.store.getBarber(s.barberId)?.name ?? "barber"}`
      : s.startTime;
    return [inlineButton(label, `bk:slot:${s.id}`)];
  });
  rows.push(navRow("bk:back:date"));
  await ctx.reply("Choose a time:", { reply_markup: inlineKeyboard(rows) });
}

async function renderConfirm(app: BotApp, ctx: Ctx, user: User, slotId: number): Promise<void> {
  const slot = app.store.getSlot(slotId);
  if (!slot || app.store.slotTaken(slot.id) || slotIsPast(slot.date, slot.startTime, app.cfg.shopTz)) {
    await ctx.reply("That slot was just taken 😔");
    return renderSlots(app, ctx, user);
  }
  const service = app.store.getService(slot.serviceId)?.name ?? "service";
  const barber = app.store.getBarber(slot.barberId)?.name ?? "barber";
  await ctx.reply(`Confirm: ${service} · with ${barber} · ${slotLabel(slot.date, slot.startTime)}`, {
    reply_markup: inlineKeyboard([
      [inlineButton("✅ Confirm", `bk:ok:${slot.id}`)],
      navRow("bk:back:slot"),
    ]),
  });
}

async function doConfirm(app: BotApp, ctx: Ctx, user: User, slotId: number): Promise<void> {
  const slot = app.store.getSlot(slotId);
  if (!slot || app.store.slotTaken(slot.id) || slotIsPast(slot.date, slot.startTime, app.cfg.shopTz)) {
    await ctx.reply("That slot was just taken 😔");
    return renderSlots(app, ctx, user);
  }
  const appt = app.store.addAppointment(user.tgId, slot.serviceId, slot.barberId, slot.id);
  await emitNotification(app, "booking", appt);
  const service = app.store.getService(slot.serviceId)?.name ?? "service";
  const barber = app.store.getBarber(slot.barberId)?.name ?? "barber";
  ctx.session.book = {};
  user.state = "menu";
  await ctx.reply(`Booked: ${service} with ${barber}, ${slotLabel(slot.date, slot.startTime)}.`, {
    reply_markup: inlineKeyboard([[inlineButton("🏠 Menu", "menu:home")]]),
  });
}

async function bkCallback(app: BotApp, ctx: Ctx, data: string, user: User): Promise<void> {
  await ctx.answerCallbackQuery();
  const parts = data.split(":");
  const action = parts[1];
  const book = (ctx.session.book ??= {});

  switch (action) {
    case "svc":
      book.serviceId = Number(parts[2]);
      book.barberId = undefined;
      book.date = undefined;
      return renderBarbers(app, ctx, user);
    case "barber":
      book.barberId = parts[2] === "skip" ? "any" : Number(parts[2]);
      book.date = undefined;
      return renderDates(app, ctx, user);
    case "date":
      book.date = parts[2];
      return renderSlots(app, ctx, user);
    case "slot":
      return renderConfirm(app, ctx, user, Number(parts[2]));
    case "ok":
      return doConfirm(app, ctx, user, Number(parts[2]));
    case "back":
      if (parts[2] === "svc") return renderServices(app, ctx, user);
      if (parts[2] === "barber") return renderBarbers(app, ctx, user);
      if (parts[2] === "date") return renderDates(app, ctx, user);
      if (parts[2] === "slot") return renderSlots(app, ctx, user);
      return app.showMenu(ctx, user);
    default:
      return app.showMenu(ctx, user);
  }
}

export const bookingFeature: Feature = (app) => {
  app.bot.command("book", async (ctx) => {
    const user = app.store.upsertUser(ctx.from!.id);
    await renderServices(app, ctx, user);
  });
  app.onMenu("book", (ctx, user) => renderServices(app, ctx, user));
  app.onCallback("bk", (ctx, data, user) => bkCallback(app, ctx, data, user));
};
