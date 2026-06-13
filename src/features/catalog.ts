// catalog feature: owner service & barber management (docs/details.md §8, §9).
// Owner-only. Both are list → add/edit/soft-delete flows. Edit reuses the add
// text-steps (distinguished by svcDraft.editingId / barberDraft.editingId).
// Soft-delete sets active=false directly on the live store object, so history
// (appointment FKs) is preserved and store.ts needs no new methods.

import { inlineButton, inlineKeyboard, type InlineButton } from "@agntdev/bot-toolkit";
import type { BotApp, Ctx, Feature } from "../bot.js";
import { navRow } from "../menu.js";
import { OWNER_ONLY } from "../strings.js";
import type { User } from "../store.js";

async function denyIfNotOwner(app: BotApp, ctx: Ctx, user: User): Promise<boolean> {
  if (app.isOwner(user)) return false;
  await app.showMenu(ctx, user, OWNER_ONLY);
  return true;
}

// ── services (§8) ──

async function showServices(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  user.state = "menu";
  const rows: InlineButton[][] = app.store.activeServices().map((s) => [
    inlineButton(`✏️ ${s.name} · ${s.durationMin}m`, `svc:edit:${s.id}`),
    inlineButton("🗑", `svc:del:${s.id}`),
  ]);
  rows.push([inlineButton("➕ Add service", "svc:add")]);
  rows.push(navRow("menu:home"));
  await ctx.reply("Services:", { reply_markup: inlineKeyboard(rows) });
}

async function svcCallback(app: BotApp, ctx: Ctx, data: string, user: User): Promise<void> {
  await ctx.answerCallbackQuery();
  if (!app.isOwner(user)) {
    await app.showMenu(ctx, user, OWNER_ONLY);
    return;
  }
  const [, action, idStr, sub] = data.split(":");

  if (action === "add") {
    ctx.session.svcDraft = { editingId: null };
    user.state = "svc:add:name";
    await ctx.reply("Service name?");
    return;
  }
  if (action === "edit") {
    const svc = app.store.getService(Number(idStr));
    if (!svc) return showServices(app, ctx, user);
    ctx.session.svcDraft = {
      editingId: svc.id,
      name: svc.name,
      description: svc.description,
      durationMin: svc.durationMin,
    };
    user.state = "svc:add:name";
    await ctx.reply(`Service name? (current: ${svc.name})`);
    return;
  }
  if (action === "del") {
    const svc = app.store.getService(Number(idStr));
    if (!svc) return showServices(app, ctx, user);
    if (sub === "yes") {
      svc.active = false; // soft-delete; appointment FKs keep history
      await showServices(app, ctx, user);
      return;
    }
    if (sub === "no") {
      await showServices(app, ctx, user);
      return;
    }
    await ctx.reply(`Delete "${svc.name}"?`, {
      reply_markup: inlineKeyboard([
        [inlineButton("⚠️ Yes, delete", `svc:del:${svc.id}:yes`), inlineButton("⬅️ Back", `svc:del:${svc.id}:no`)],
      ]),
    });
  }
}

async function svcState(app: BotApp, ctx: Ctx, text: string, user: User): Promise<void> {
  const draft = ctx.session.svcDraft;
  if (!draft) {
    await app.showMenu(ctx, user);
    return;
  }
  switch (user.state) {
    case "svc:add:name":
      if (text.length < 1 || text.length > 64) {
        await ctx.reply("Please send a name (1–64 characters).");
        return;
      }
      draft.name = text;
      user.state = "svc:add:desc";
      await ctx.reply("Description?");
      return;
    case "svc:add:desc":
      draft.description = text;
      user.state = "svc:add:dur";
      await ctx.reply("Duration in minutes? (a whole number)");
      return;
    case "svc:add:dur": {
      const dur = Number(text);
      if (!Number.isInteger(dur) || dur <= 0) {
        await ctx.reply("Please send a whole number of minutes greater than 0.");
        return;
      }
      if (draft.editingId === null) {
        app.store.addService(draft.name!, draft.description ?? "", dur);
      } else {
        const svc = app.store.getService(draft.editingId);
        if (svc) {
          svc.name = draft.name!;
          svc.description = draft.description ?? "";
          svc.durationMin = dur;
        }
      }
      ctx.session.svcDraft = undefined;
      await showServices(app, ctx, user);
      return;
    }
    default:
      await app.showMenu(ctx, user);
  }
}

// ── barbers (§9) ──

async function showBarbers(app: BotApp, ctx: Ctx, user: User): Promise<void> {
  user.state = "menu";
  const rows: InlineButton[][] = app.store.activeBarbers().map((b) => [
    inlineButton(`✏️ ${b.name} · ${b.specialty}`, `barber:edit:${b.id}`),
    inlineButton("🗑", `barber:del:${b.id}`),
  ]);
  rows.push([inlineButton("➕ Add barber", "barber:add")]);
  rows.push(navRow("menu:home"));
  await ctx.reply("Barbers:", { reply_markup: inlineKeyboard(rows) });
}

async function barberCallback(app: BotApp, ctx: Ctx, data: string, user: User): Promise<void> {
  await ctx.answerCallbackQuery();
  if (!app.isOwner(user)) {
    await app.showMenu(ctx, user, OWNER_ONLY);
    return;
  }
  const [, action, idStr, sub] = data.split(":");

  if (action === "add") {
    ctx.session.barberDraft = { editingId: null };
    user.state = "barber:add:name";
    await ctx.reply("Barber name?");
    return;
  }
  if (action === "edit") {
    const b = app.store.getBarber(Number(idStr));
    if (!b) return showBarbers(app, ctx, user);
    ctx.session.barberDraft = { editingId: b.id, name: b.name, specialty: b.specialty };
    user.state = "barber:add:name";
    await ctx.reply(`Barber name? (current: ${b.name})`);
    return;
  }
  if (action === "del") {
    const b = app.store.getBarber(Number(idStr));
    if (!b) return showBarbers(app, ctx, user);
    if (sub === "yes") {
      b.active = false;
      await showBarbers(app, ctx, user);
      return;
    }
    if (sub === "no") {
      await showBarbers(app, ctx, user);
      return;
    }
    await ctx.reply(`Delete "${b.name}"?`, {
      reply_markup: inlineKeyboard([
        [inlineButton("⚠️ Yes, delete", `barber:del:${b.id}:yes`), inlineButton("⬅️ Back", `barber:del:${b.id}:no`)],
      ]),
    });
  }
}

async function barberState(app: BotApp, ctx: Ctx, text: string, user: User): Promise<void> {
  const draft = ctx.session.barberDraft;
  if (!draft) {
    await app.showMenu(ctx, user);
    return;
  }
  switch (user.state) {
    case "barber:add:name":
      if (text.length < 1 || text.length > 64) {
        await ctx.reply("Please send a name (1–64 characters).");
        return;
      }
      draft.name = text;
      user.state = "barber:add:spec";
      await ctx.reply("Specialty? (e.g. fades, beard trims)");
      return;
    case "barber:add:spec":
      draft.specialty = text;
      if (draft.editingId === null) {
        app.store.addBarber(draft.name!, draft.specialty ?? "");
      } else {
        const b = app.store.getBarber(draft.editingId);
        if (b) {
          b.name = draft.name!;
          b.specialty = draft.specialty ?? "";
        }
      }
      ctx.session.barberDraft = undefined;
      await showBarbers(app, ctx, user);
      return;
    default:
      await app.showMenu(ctx, user);
  }
}

export const catalogFeature: Feature = (app) => {
  // /services
  app.bot.command("services", async (ctx) => {
    const user = app.store.upsertUser(ctx.from!.id);
    if (await denyIfNotOwner(app, ctx, user)) return;
    await showServices(app, ctx, user);
  });
  app.onMenu("services", async (ctx, user) => {
    if (await denyIfNotOwner(app, ctx, user)) return;
    await showServices(app, ctx, user);
  });
  app.onCallback("svc", (ctx, data, user) => svcCallback(app, ctx, data, user));
  app.onState("svc", (ctx, text, user) => svcState(app, ctx, text, user));

  // /barbers
  app.bot.command("barbers", async (ctx) => {
    const user = app.store.upsertUser(ctx.from!.id);
    if (await denyIfNotOwner(app, ctx, user)) return;
    await showBarbers(app, ctx, user);
  });
  app.onMenu("barbers", async (ctx, user) => {
    if (await denyIfNotOwner(app, ctx, user)) return;
    await showBarbers(app, ctx, user);
  });
  app.onCallback("barber", (ctx, data, user) => barberCallback(app, ctx, data, user));
  app.onState("barber", (ctx, text, user) => barberState(app, ctx, text, user));
};
