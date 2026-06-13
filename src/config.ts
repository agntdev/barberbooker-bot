// Runtime configuration + display helpers (docs/details.md §1). Read lazily by
// main.ts so the harness can construct the bot with explicit options and no
// env dependence.

export interface BotConfig {
  /** Barbershop owner's Telegram id (OWNER_TG_ID env). First /start from it →
   *  role `owner`. null → notifications are logged, not sent (details.md §11). */
  ownerTgId: number | null;
  /** IANA timezone all dates/times render in (SHOP_TZ env). */
  shopTz: string;
}

export function configFromEnv(): BotConfig {
  const owner = Number(process.env.OWNER_TG_ID ?? "");
  return {
    ownerTgId: Number.isFinite(owner) && owner > 0 ? owner : null,
    shopTz: process.env.SHOP_TZ || "Europe/London",
  };
}

/** "Fri, 19 Jun · 14:00" — a predefined slot's shop-local date + start time.
 *  Slot date/time are wall-clock in the shop calendar (the owner predefines
 *  them), so the weekday/month derive from the date string directly. */
export function slotLabel(date: string, startTime: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(d);
  return `${day} · ${startTime}`;
}

/** "Fri, 19 Jun" — date-only label for the date-picker step. */
export function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

/** Today's date (YYYY-MM-DD) in the shop timezone. */
export function shopToday(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(now);
}

/** True if (date, startTime) in shop tz is strictly before now. Used by the
 *  slot/booking flows to hide past predefined slots. */
export function slotIsPast(date: string, startTime: string, tz: string, now: Date = new Date()): boolean {
  const today = shopToday(tz, now);
  if (date < today) return true;
  if (date > today) return false;
  const nowHm = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  }).format(now);
  return startTime <= nowHm;
}
