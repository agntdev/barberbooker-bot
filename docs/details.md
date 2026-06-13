# Barbershop Booking Assistant Bot — DETAILS Specification

Concrete per-command behaviour for every flow in `docs/design.md`. Copy shown
in quotes is the exact user-facing text (centralized in a strings module during
dev). All instants are stored UTC and rendered in `SHOP_TZ`.

## 1. Runtime, configuration, storage, conversation state

- **Runtime**: grammY on `@agntdev/bot-toolkit` (`makeBot()` factory). Production
  runs long polling; the tokenless test harness imports `makeBot()` and replays
  Updates with no network. Update types consumed: `message` (commands + text
  steps) and `callback_query` (inline taps).
- **Configuration**:

  | Env | Required | Purpose |
  |---|---|---|
  | `BOT_TOKEN` | yes (injected) | Telegram Bot API token |
  | `OWNER_TG_ID` | no | the barbershop owner's Telegram id; first `/start` from it → `owner`. Unset → notifications are logged, not sent (§11). |
  | `SHOP_TZ` | no (default `Europe/London`) | timezone all dates/times render in |

- **Storage** (abstraction; SQL in prod, in-memory adapter under the harness):

  | Table | Columns | Operations |
  |---|---|---|
  | `users` | `tg_id` PK, `name`, `role` (`client`/`owner`), `conversation_state` | `upsert`, `setName`, `setRole`, `setState` |
  | `services` | `id` PK, `name`, `description`, `duration_min`, `active` | `add`, `update`, `softDelete`, `listActive` |
  | `barbers` | `id` PK, `name`, `specialty`, `active` | `add`, `update`, `softDelete`, `listActive` |
  | `time_slots` | `id` PK, `barber_id`, `service_id`, `date`, `start_time` | `add`, `listFor(service[,barber],date)`, `available(slotId)` |
  | `appointments` | `id` PK, `client_tg_id`, `service_id`, `barber_id`, `time_slot_id` (unique), `status` (`confirmed`/`completed`/`cancelled`), `created_at`, `updated_at` | `add`, `ofClient`, `setStatus`, `move` |
  | `notifications` | `id` PK, `type` (`booking`/`cancel`/`reschedule`), `appointment_id`, `created_at` | `add` |

  A slot is **available** iff no `confirmed`/`completed` appointment references
  it and its `(date,start_time)` is not in the past. This is a derived read —
  no separate availability table (general.md Non-Goal: real-time availability
  tracking).
- **Conversation state** lives in `users.conversation_state` (cached in memory).
  `"menu"` is idle; text-step flows set their own namespaced state (e.g.
  `"svc:add:name"`). An unknown/stale state resets to `"menu"`.

## 2. /start — registration & main menu

Entry: `/start` or CB `menu:home`.
- **First contact** (no `name`): set state `reg:name`, ask `"Welcome! What's
  your name?"`. On the next text message while in `reg:name`: store the name
  (1–64 chars, else re-ask), set role = `owner` if `tg_id == OWNER_TG_ID` else
  `client`, set state `menu`, render the role menu.
- **Returning user**: render the role menu directly.

Role menus (inline, CB `menu:<key>`):
- **Client**: `📅 Book` (`book`) · `📋 My appointments` (`my`) · `❌ Cancel`
  (`cancel`) · `🔁 Reschedule` (`reschedule`)
- **Owner**: the client buttons plus `🧰 Services` (`services`) · `💈 Barbers`
  (`barbers`) · `🗓 Time slots` (`slots`)

## 3. /help

Role-specific command cheat-sheet (client commands for clients; client + owner
commands for the owner), followed by the main menu.

## 4. /book — client booking flow

Entry: `/book` or CB `menu:book`. Inline state machine; each step offers
`⬅️ Back` and `🏠 Menu`.

1. **Service** — one button per `services.listActive()`: `"{name} · {duration_min} min"`.
   CB `bk:svc:<id>`. None → `"No services available yet."` + menu.
2. **Barber** — active barbers that have ≥1 available slot for the chosen
   service on any upcoming date, plus `[Any barber ⏭ Skip]` (CB `bk:barber:skip`).
   CB `bk:barber:<id>`.
3. **Date** — calendar-style picker of upcoming dates that contain ≥1 available
   slot for the service (and barber, if chosen). Label `"Fri 19 Jun"`.
   CB `bk:date:<YYYY-MM-DD>`. None → `"No free dates — try another barber."`.
4. **Slot** — available predefined slots for that service/date, filtered to the
   chosen barber or all barbers if skipped (each button shows the time and the
   barber's name). CB `bk:slot:<slot_id>`.
5. **Confirm** — card `"{service} · with {barber} · {date} {time}"` +
   `[✅ Confirm]` (CB `bk:ok`).
6. **On confirm**, in ONE transaction:
   - re-validate the slot is still available; if not → `answerCallbackQuery`
     `"That slot was just taken 😔"` and re-render step 4 with fresh slots;
   - insert `appointments` (status `confirmed`, `created_at`/`updated_at` now);
   - emit a `booking` notification to the owner (§11);
   - reply receipt: `"Booked: {service} with {barber}, {date} at {time}."`
     (menu only, no Back).

## 5. /my — appointment management

Entry: `/my` or CB `menu:my`. Lists the client's appointments, newest relevant
first, each line `"Fri 19 Jun · 14:00 · Haircut · with Alex · confirmed"`.
Two filter rows (general.md: filter by date/status):
- status: `[Upcoming]` `[Past]` `[Cancelled]` (CB `my:filter:<upcoming|past|cancelled>`)
- date: `[Any date]` `[Today]` `[This week]` (CB `my:date:<any|today|week>`)

Definitions: **Upcoming** = `confirmed`, slot in the future (default view);
**Past** = `completed` (slot elapsed, not cancelled — §12 archival);
**Cancelled** = `cancelled`. Each upcoming row carries `[❌ Cancel]`
(CB `cancel:pick:<appt_id>`) and `[🔁 Reschedule]` (CB `resch:pick:<appt_id>`).
Empty result → `"No appointments here yet."` + menu.

## 6. /cancel — client cancels

Entry: `/cancel`, CB `menu:cancel`, or a `[❌ Cancel]` row button.
- List the client's upcoming (`confirmed`) appointments as buttons
  (CB `cancel:pick:<appt_id>`). None → `"You have no upcoming appointments."`.
- Tap → confirm dialog `[⚠️ Yes, cancel]` (CB `cancel:ok:<appt_id>`) `[⬅️ Back]`.
- On confirm (instant): `status → cancelled`, `updated_at` now; the 1:1 slot
  link is released so the slot is available again; emit a `cancel` notification
  (§11); reply `"Your appointment was cancelled."`.

## 7. /reschedule — client reschedules

Entry: `/reschedule`, CB `menu:reschedule`, or a `[🔁 Reschedule]` row button.
- List upcoming appointments (CB `resch:pick:<appt_id>`).
- Choose new **Date** (CB `resch:date:<YYYY-MM-DD>`) → new **Slot**
  (CB `resch:slot:<slot_id>`), using §4's available-slot logic scoped to the
  same service; the original slot is excluded from the list but stays held
  until the move succeeds.
- Confirm card `"{old date/time} → {new date/time}"` + `[✅ Confirm]`
  (CB `resch:ok`).
- On confirm, in ONE transaction: re-validate the new slot (race guard →
  message + re-render); release the old slot, set `time_slot_id` to the new
  slot, keep `status=confirmed`, `updated_at` now (same `appointment.id`); emit
  a `reschedule` notification (§11); reply the updated receipt.

## 8. /services — owner service management

Owner only (non-owner → §12 authz notice). Entry `/services` or CB `menu:services`.
- List active services, each row `[✏️ Edit]` (CB `svc:edit:<id>`) `[🗑 Delete]`
  (CB `svc:del:<id>`), plus `[➕ Add]` (CB `svc:add`).
- **Add** (text steps): `svc:add:name` → `svc:add:desc` → `svc:add:dur`
  (integer minutes > 0; else re-ask) → confirm → insert `active=true`.
- **Edit**: same steps pre-filled → update.
- **Delete**: confirm → soft-delete (`active=false`); existing appointments keep
  the FK so history is preserved.

## 9. /barbers — owner barber management

Owner only. Entry `/barbers` or CB `menu:barbers`.
- List active barbers, each row `[✏️ Edit]` (CB `barber:edit:<id>`)
  `[🗑 Delete]` (CB `barber:del:<id>`), plus `[➕ Add]` (CB `barber:add`).
- **Add** (text steps): `barber:add:name` → `barber:add:spec` → confirm →
  insert `active=true`.
- **Edit**/**Delete**: as in §8 (soft-delete, history preserved).

## 10. /slots — owner predefines time slots

Owner only. Entry `/slots` or CB `menu:slots`.
- Choose **Barber** (CB `slots:barber:<id>`) → **Service** (CB `slots:svc:<id>`)
  → **Date** (CB `slots:date:<YYYY-MM-DD>`).
- Then a text step `slots:times`: the owner enters one or more start times,
  comma-separated, e.g. `"10:00, 11:30, 14:00"` (each `HH:MM`; invalid or past
  times are rejected with a re-ask; duplicates of existing slots are skipped).
- Confirm → insert one `time_slots` row per accepted time for
  `(barber, service, date)`. Existing slots for that date are listed; a slot
  already consumed by a `confirmed` appointment is shown locked 🔒.

This is **manual predefinition** — the bot never auto-generates slots from
workload or duration (general.md Non-Goal).

## 11. Owner notifications (system, no command)

`NotificationService.emit(type, appointment)` is the single emit point, called
from §4 (booking), §6 (cancel), §7 (reschedule). It inserts a `notifications`
row (`type`, `appointment_id`, `created_at`) and, if `OWNER_TG_ID` is set, sends
the owner a message with the client name, service, barber, and date/time:
- `booking`: `"🆕 New booking: {service} with {barber} — {date} {time} — client {name}."`
- `cancel`: `"❌ Cancelled: {service} with {barber} — {date} {time} — client {name}."`
- `reschedule`: `"🔁 Rescheduled: {service} with {barber} — was {old}, now {new} — client {name}."`

If `OWNER_TG_ID` is unset the row is still written and the send is logged and
skipped (no crash).

## 12. Fallbacks, errors & archival

- **Unknown command / stray text** outside a flow → `"Sorry, I didn't get that.
  /help shows what I can do."` + main menu.
- **Owner-only command by a non-owner** → `"That's an owner-only action."` +
  client menu.
- **Stale/unknown callback** → `answerCallbackQuery` `"That expired — start
  again."` + main menu.
- **Handler error** → caught by the bot error boundary, logged; the user gets
  `"Something went wrong, please try again."` and is reset to `menu`. The update
  loop never crashes.
- **Archival** — appointments are never hard-deleted; a `confirmed` appointment
  whose slot time has passed reads as `completed`, `cancelled` rows are retained
  with timestamps (general.md Data Persistence).
- **Restart safety** — all state (bookings, slots, conversation state) is in
  storage, not in-memory timers.
