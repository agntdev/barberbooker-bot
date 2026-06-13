// Bot assembly: the update-router skeleton every feature plugs into
// (docs/details.md §1, §2, §3, §12; docs/work_breakdown.json `core`).
//
// Features (catalog, notifications, slots, booking, manage) are INSTALLERS:
// each gets the BotApp and registers commands on `app.bot`, plus callback
// namespaces / menu actions / text-step states via the hooks below. Core wires
// /start, /help, the callback router and the text fallbacks AROUND them, so
// registration order is always correct: commands first, generic
// callback/text fallbacks last.

import { createBot, type BotContext } from "@agntdev/bot-toolkit";
import type { Bot } from "grammy";
import type { BotConfig } from "./config.js";
import { helpText, mainMenu } from "./menu.js";
import { Store, type User } from "./store.js";

/** Per-chat session scratch for multi-step flows. The authoritative state is
 *  `users.conversation_state` in the store (details.md §1); the session only
 *  carries in-flight draft data. Shapes for every flow are declared here so
 *  feature PRs never edit this file (avoids merge races on the router). */
export interface Session {
  book?: { serviceId?: number; barberId?: number | "any"; date?: string };
  resch?: { apptId?: number; date?: string };
  slots?: { barberId?: number; serviceId?: number; date?: string; times?: string[] };
  svcDraft?: { editingId: number | null; name?: string; description?: string; durationMin?: number };
  barberDraft?: { editingId: number | null; name?: string; specialty?: string };
}

export type Ctx = BotContext<Session>;

export type CallbackHandler = (ctx: Ctx, data: string, user: User) => Promise<void>;
export type StateHandler = (ctx: Ctx, text: string, user: User) => Promise<void>;
export type MenuAction = (ctx: Ctx, user: User) => Promise<void>;

export interface BotApp {
  bot: Bot<Ctx>;
  store: Store;
  cfg: BotConfig;
  /** Register a callback namespace: data `"<ns>:..."` → handler. */
  onCallback(ns: string, fn: CallbackHandler): void;
  /** Register a main-menu action: callback `"menu:<key>"` → handler. */
  onMenu(key: string, fn: MenuAction): void;
  /** Register a text-step state namespace: state `"<ns>:..."` → handler. */
  onState(ns: string, fn: StateHandler): void;
  /** Send the role main menu and reset the user to state "menu". */
  showMenu(ctx: Ctx, user: User, text?: string): Promise<void>;
  /** True iff this user is the configured barbershop owner. */
  isOwner(user: User): boolean;
}

export type Feature = (app: BotApp) => void;

export function buildBot(token: string, store: Store, cfg: BotConfig, features: Feature[]): Bot<Ctx> {
  const bot = createBot<Session>(token, { initial: () => ({}) });

  const callbacks = new Map<string, CallbackHandler>();
  const menuActions = new Map<string, MenuAction>();
  const states = new Map<string, StateHandler>();

  const app: BotApp = {
    bot,
    store,
    cfg,
    onCallback: (ns, fn) => callbacks.set(ns, fn),
    onMenu: (key, fn) => menuActions.set(key, fn),
    onState: (ns, fn) => states.set(ns, fn),
    isOwner: (user) => cfg.ownerTgId !== null && user.tgId === cfg.ownerTgId,
    showMenu: async (ctx, user, text) => {
      user.state = "menu";
      await ctx.reply(text ?? "Main menu:", { reply_markup: mainMenu(user.role) });
    },
  };

  // Error boundary (details.md §12): a handler failure logs, resets the user
  // to the menu state, and apologises — the update loop never crashes.
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error("[barberbooker] handler error:", err);
      const tgId = ctx.from?.id;
      if (tgId) store.upsertUser(tgId).state = "menu";
      try {
        await ctx.reply("Something went wrong, please try again.");
      } catch {
        /* replying itself failed — nothing left to do */
      }
    }
  });

  // ── /start: registration + role menu (details.md §2) ──
  bot.command("start", async (ctx) => {
    const user = store.upsertUser(ctx.from!.id);
    if (app.isOwner(user)) user.role = "owner";
    if (!user.name) {
      user.state = "reg:name";
      await ctx.reply("Welcome! What's your name?");
      return;
    }
    user.state = "menu";
    await ctx.reply(`Hi, ${user.name}!`, { reply_markup: mainMenu(user.role) });
  });

  // ── /help (details.md §3) ──
  bot.command("help", async (ctx) => {
    const user = store.upsertUser(ctx.from!.id);
    await ctx.reply(helpText(user.role), { reply_markup: mainMenu(user.role) });
  });

  // ── feature installers (commands, menu actions, callbacks, states) ──
  for (const install of features) install(app);

  // ── callback router (after features so their namespaces are known) ──
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const user = store.upsertUser(ctx.from.id);
    const ns = data.split(":", 1)[0]!;

    if (ns === "menu") {
      const key = data.slice("menu:".length);
      if (key === "home") {
        await ctx.answerCallbackQuery();
        await app.showMenu(ctx, user);
        return;
      }
      const action = menuActions.get(key);
      if (action) {
        await ctx.answerCallbackQuery();
        await action(ctx, user);
        return;
      }
    } else {
      const handler = callbacks.get(ns);
      if (handler) {
        await handler(ctx, data, user);
        return;
      }
    }

    // Stale/unknown button (details.md §12).
    await ctx.answerCallbackQuery({ text: "That expired — start again." });
    await app.showMenu(ctx, user);
  });

  // ── text router: registration step, feature states, fallback (§2, §12) ──
  bot.on("message:text", async (ctx) => {
    const user = store.upsertUser(ctx.from!.id);
    const text = ctx.message.text.trim();

    if (user.state === "reg:name") {
      if (text.length < 1 || text.length > 64) {
        await ctx.reply("Please send a name (1–64 characters).");
        return;
      }
      user.name = text;
      user.state = "menu";
      await ctx.reply(`Nice to meet you, ${user.name}!`, { reply_markup: mainMenu(user.role) });
      return;
    }

    const ns = user.state.split(":", 1)[0]!;
    const handler = states.get(ns);
    if (handler) {
      await handler(ctx, text, user);
      return;
    }

    // Unknown command / stray text (details.md §12).
    await ctx.reply("Sorry, I didn't get that. /help shows what I can do.", {
      reply_markup: mainMenu(user.role),
    });
  });

  return bot;
}
