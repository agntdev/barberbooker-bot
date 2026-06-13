// Centralized user-facing copy (docs/details.md §1 i18n: shared strings live in
// one module so they can be translated as a unit). Per-flow prompts stay with
// their flow; the cross-cutting strings the router and several features share
// live here, imported by bot.ts and the feature modules.

export const GREETING_ASK_NAME = "Welcome! What's your name?";
export const NAME_INVALID = "Please send a name (1–64 characters).";
export const MENU_TITLE = "Main menu:";
export const OWNER_ONLY = "That's an owner-only action.";
export const SLOT_TAKEN = "That slot was just taken 😔";
export const GENERIC_ERROR = "Something went wrong, please try again.";
export const FALLBACK_HINT = "Sorry, I didn't get that. /help shows what I can do.";
