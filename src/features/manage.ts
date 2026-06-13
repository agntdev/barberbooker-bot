// manage feature: appointment management (docs/details.md §5, §6, §7).
// /my (list + date/status filters), /cancel, /reschedule. Cancel and
// reschedule emit owner notifications (§11). "Completed" is derived: a
// confirmed appointment whose slot time has passed (§12 archival) — status is
// never mutated to completed, the bucket is computed at read time.

import { inlineButton, inlineKeyboard, type InlineButton } from "@agntdev/bot-toolkit";
import { dateLabel, shopToday, slotIsPast, slotLabel } from "../config.js";
import type { BotApp, Ctx, Feature } from "../bot.js";
import { navRow } from "../menu.js";
import { emitNotification } from "../notifications.js";
import type { Appointment, TimeSlot, User } from "../store.js";

const HORIZON = 14;

function nextDates(today: string, n: number): string[] {
  const start = new Date(`${today}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
  return out;
}

function availableSlots(app: BotApp, serviceId: number, date: string): TimeSlot[] {
  return app.store
    .slotsFor(serviceId, date)
    .filter((s) => !app.store.slotTaken(s.id) && !slotIsPast(s.date, s.startTime, app.cfg.shopTz));
}

type Bucket = "upcoming" | "past" | "cancelled";

function bucketOf(app: BotApp, a: Appointment): Bucket {
  if (a.status === "cancelled") return "cancelled";
  const slot = app.store.getSlot(a.timeSlotId);
  if (slot && slotIsPast(slot.date, slot.startTime, app.cfg.shopTz)) return "past";
  return "upcoming";
}

function statusLabel(b: Bucket): string {
  return b === "cancelled" ? "cancelled" : b === "past" ? "completed" : "confirmed";
}

function apptLine(app: BotApp, a: Appointment): string {
  const slot = app.store.getSlot(a.timeSlotId);
  const when = slot ? slotLabel(slot.date, slot.startTime) : "unknown";
  const service = app.store.getService(a.serviceId)?.name ?? "service";
  const barber = app.store.getBarber(a.barberId)?.name ?? "barber";
  return `${when} · ${service} · with ${barber} · ${statusLabel(bucketOf(app, a))}`;
}

function isUpcoming(app: BotApp, a: Appointment): boolean {
  return bucketOf(app, a) === "upcoming";
}

function matchesDate(app: BotApp, a: Appointment, dateFilter: string): boolean {
  if (dateFilter === "any") return true;
  const slot = app.store.getSlot(a.timeSlotId);
  if (!slot) return false;
  const today = shopToday(app.cfg.shopTz);
  if (dateFilter === "today") return slot.date === today;
  if (dateFilter === "week") {
    const end = new Date(`${today}T00:00:00Z`).getTime() + 6 * 86400000;
    return slot.date >= today && new Date(`${slot.date}T00:00:00Z`).getTime() <= end;
  }
  return true;
}

// ── /my (§5) ──

async function renderMy(app: BotApp, ctx: Ctx, user: User, status: Bucket, dateFilter: string): Promise<void> {
  user.state = "menu";
  const appts = app.store
    .appointmentsOfClient(user.tgId)
    .filter((a) => bucketOf(app, a) === status && matchesDate(app, a, dateFilter));

  const header =
    `Your appointments — ${status}` + (dateFilter !== "any" ? ` · ${dateFilter}` : "");
  const body = appts.length
    ? appts.map((a) => "• " + apptLine(app, a)).join("\n")
    : "No appointments here yet.";

  const rows: InlineButton[][] = [
    (["upcoming", "past", "cancelled"] as Bucket[]).map((s) =>
      inlineButton(s === status ? `· ${s} ·` : s, `my:show:${s}:${dateFilter}`),
    ),
    [
      inlineButton(dateFilter === "any" ? "· any ·" : "any", `my:show:${status}:any`),
      inlineButton(dateFilter === "today" ? "· today ·" : "today", `my:show:${status}:today`),
      inlineButton(dateFilter === "week" ? "· week ·" : "week", `my:show:${status}:week`),
    ],
  ];
  if (status === "upcoming") {
    for (const a of appts) {
      const slot = app.store.getSlot(a.timeSlotId);
      const tag = slot ? `${dateLabel(slot.date)} ${slot.startTime}` : `#${a.id}`;
      rows.push([
        inlineButton(`❌ Cancel ${tag}`, `cancel:pick:${a.id}`),
        inlineButton(`🔁 ${tag}`, `resch:pick:${a.id}`),
      ]);
    }
  }
  rows.push([inlineButton("🏠 Menu", "menu:home")]);
  await ctx.reply(`${header}\n${body}`, { reply_markup: inlineKeyboard(rows) });
}

async function myCallback(app: BotApp, ctx: Ctx, data: string, user: User): Promise<void> {
  await ctx.answerCallbackQuery();
  const [, action, status, dateFilter] = data.split(":");
  if (action === "show") {
    await renderMy(app, ctx, user, (status as Bucket) ?? "upcoming", dateFilter ?? "any");
  }
}

// ── /cancel (§6) ──

async function renderCancelList(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  user.state = "menu";
  const appts = app.store.appointmentsOfClient(user.tgId).filter((a) => isUpcoming(app, a));
  if (appts.length === 0) {
    await app.showMenu(ctx, user, "You have no upcoming appointments.");
    return;
  }
  const rows: InlineButton[][] = appts.map((a) => [inlineButton(apptLine(app, a), `cancel:pick:${a.id}`)]);
  rows.push(navRow("menu:home"));
  await ctx.reply("Cancel which appointment?", { reply_markup: inlineKeyboard(rows) });
}

async function cancelCallback(app: BotApp, ctx: Ctx, data: string, user: User): Promise<void> {
  await ctx.answerCallbackQuery();
  const [, action, idStr] = data.split(":");
  const appt = app.store.getAppointment(Number(idStr));
  if (!appt || appt.clientTgId !== user.tgId) {
    await app.showMenu(ctx, user, "That appointment is no longer available.");
    return;
  }
  if (action === "pick") {
    await ctx.reply(`Cancel this appointment?\n${apptLine(app, appt)}`, {
      reply_markup: inlineKeyboard([
        [inlineButton("⚠️ Yes, cancel", `cancel:ok:${appt.id}`), inlineButton("⬅️ Back", "menu:home")],
      ]),
    });
    return;
  }
  if (action === "ok") {
    if (appt.status !== "confirmed") {
      await app.showMenu(ctx, user, "That appointment can't be cancelled.");
      return;
    }
    app.store.setAppointmentStatus(appt.id, "cancelled"); // slot frees automatically
    await emitNotification(app, "cancel", appt);
    await app.showMenu(ctx, user, "Your appointment was cancelled.");
  }
}

// ── /reschedule (§7) ──

async function renderReschList(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  user.state = "menu";
  ctx.session.resch = {};
  const appts = app.store.appointmentsOfClient(user.tgId).filter((a) => isUpcoming(app, a));
  if (appts.length === 0) {
    await app.showMenu(ctx, user, "You have no upcoming appointments.");
    return;
  }
  const rows: InlineButton[][] = appts.map((a) => [inlineButton(apptLine(app, a), `resch:pick:${a.id}`)]);
  rows.push(navRow("menu:home"));
  await ctx.reply("Reschedule which appointment?", { reply_markup: inlineKeyboard(rows) });
}

async function renderReschDates(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  const apptId = ctx.session.resch?.apptId;
  const appt = apptId != null ? app.store.getAppointment(apptId) : undefined;
  if (!appt) return renderReschList(app, ctx, user);
  const dates = nextDates(shopToday(app.cfg.shopTz), HORIZON).filter(
    (d) => availableSlots(app, appt.serviceId, d).length > 0,
  );
  if (dates.length === 0) {
    await app.showMenu(ctx, user, "No free dates to move to right now.");
    return;
  }
  const rows: InlineButton[][] = [];
  for (let i = 0; i < dates.length; i += 2) {
    rows.push(dates.slice(i, i + 2).map((d) => inlineButton(dateLabel(d), `resch:date:${d}`)));
  }
  rows.push(navRow("menu:home"));
  await ctx.reply("New date:", { reply_markup: inlineKeyboard(rows) });
}

async function renderReschSlots(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  const draft = ctx.session.resch;
  const appt = draft?.apptId != null ? app.store.getAppointment(draft.apptId) : undefined;
  if (!appt || !draft?.date) return renderReschDates(app, ctx, user);
  const slots = availableSlots(app, appt.serviceId, draft.date).filter((s) => s.id !== appt.timeSlotId);
  if (slots.length === 0) {
    await app.showMenu(ctx, user, "That date just filled up — pick another.");
    return;
  }
  const rows: InlineButton[][] = slots.map((s) => [
    inlineButton(`${s.startTime} · ${app.store.getBarber(s.barberId)?.name ?? "barber"}`, `resch:slot:${s.id}`),
  ]);
  rows.push(navRow("menu:home"));
  await ctx.reply("New time:", { reply_markup: inlineKeyboard(rows) });
}

async function doReschedule(app: BotApp, ctx: Ctx, user: User, newSlotId: number): Promise<void> {
  const draft = ctx.session.resch;
  const appt = draft?.apptId != null ? app.store.getAppointment(draft.apptId) : undefined;
  if (!appt || appt.clientTgId !== user.tgId || appt.status !== "confirmed") {
    await app.showMenu(ctx, user, "That appointment is no longer available.");
    return;
  }
  const newSlot = app.store.getSlot(newSlotId);
  if (
    !newSlot ||
    newSlot.serviceId !== appt.serviceId ||
    app.store.slotTaken(newSlot.id) ||
    slotIsPast(newSlot.date, newSlot.startTime, app.cfg.shopTz)
  ) {
    await ctx.reply("That slot was just taken 😔");
    return renderReschSlots(app, ctx, user);
  }
  const oldSlot = app.store.getSlot(appt.timeSlotId);
  const oldLabel = oldSlot ? slotLabel(oldSlot.date, oldSlot.startTime) : "?";
  app.store.moveAppointment(appt.id, newSlot.id, newSlot.barberId); // old slot frees automatically
  await emitNotification(app, "reschedule", appt, oldLabel);
  ctx.session.resch = {};
  user.state = "menu";
  await ctx.reply(`Rescheduled to ${slotLabel(newSlot.date, newSlot.startTime)}.`, {
    reply_markup: inlineKeyboard([[inlineButton("🏠 Menu", "menu:home")]]),
  });
}

async function reschCallback(app: BotApp, ctx: Ctx, data: string, user: User): Promise<void> {
  await ctx.answerCallbackQuery();
  const parts = data.split(":");
  const action = parts[1];
  const draft = (ctx.session.resch ??= {});
  if (action === "pick") {
    draft.apptId = Number(parts[2]);
    draft.date = undefined;
    return renderReschDates(app, ctx, user);
  }
  if (action === "date") {
    draft.date = parts[2];
    return renderReschSlots(app, ctx, user);
  }
  if (action === "slot") {
    return doReschedule(app, ctx, user, Number(parts[2]));
  }
  return app.showMenu(ctx, user);
}

export const manageFeature: Feature = (app) => {
  // /my
  app.bot.command("my", async (ctx) => {
    const user = app.store.upsertUser(ctx.from!.id);
    await renderMy(app, ctx, user, "upcoming", "any");
  });
  app.onMenu("my", (ctx, user) => renderMy(app, ctx, user, "upcoming", "any"));
  app.onCallback("my", (ctx, data, user) => myCallback(app, ctx, data, user));

  // /cancel
  app.bot.command("cancel", async (ctx) => {
    const user = app.store.upsertUser(ctx.from!.id);
    await renderCancelList(app, ctx, user);
  });
  app.onMenu("cancel", (ctx, user) => renderCancelList(app, ctx, user));
  app.onCallback("cancel", (ctx, data, user) => cancelCallback(app, ctx, data, user));

  // /reschedule
  app.bot.command("reschedule", async (ctx) => {
    const user = app.store.upsertUser(ctx.from!.id);
    await renderReschList(app, ctx, user);
  });
  app.onMenu("reschedule", (ctx, user) => renderReschList(app, ctx, user));
  app.onCallback("resch", (ctx, data, user) => reschCallback(app, ctx, data, user));
};
