# Barbershop Booking Assistant Bot — DESIGN Document

Architecture, command set, and conversation/UX flows for the BarberBooker
Telegram bot. Satisfies every Core Entity, External Dependency, and Feature in
`docs/general.md`, and respects all of its Non-Goals.

## 1. Architecture

### 1.1 Components

```
┌────────────────────────────────────────────────────────────┐
│                        Telegram Bot                          │
│  long-polling (getUpdates) → Update Router                   │
├──────────────┬───────────────────┬───────────────────────────┤
│ Command      │ Callback           │ Conversation State        │
│ Handlers     │ Handlers           │ Machine (per chat)        │
├──────────────┴───────────────────┴───────────────────────────┤
│                       Service Layer                          │
│  BookingService · CatalogService · SlotService ·             │
│  AppointmentService · NotificationService · UserService      │
├────────────────────────────────────────────────────────────┤
│                        Storage                               │
│  users · services · barbers · time_slots ·                   │
│  appointments · notifications                                │
└────────────────────────────────────────────────────────────┘
```

- **Update Router** — dispatches incoming updates: commands (`/…`) to command
  handlers, `callback_query` to callback handlers (routed by a `data` prefix),
  and plain text to the active conversation step of that chat.
- **Conversation State Machine** — a per-chat finite state. The authoritative
  state lives in storage (`users.conversation_state`) with an in-memory cache,
  so a restart never strands a user mid-flow; an unknown/stale state resets to
  the main menu.
- **Service Layer** — all business rules live here; handlers only parse input
  and render output. `NotificationService` is the single place that emits owner
  alerts (§4.8), so every booking/cancel/reschedule path notifies consistently.
- **Storage** — a persistence abstraction over the six tables below
  (`needs_database: true`). Production uses a durable SQL engine; the tokenless
  test harness uses an in-memory adapter exposing the same query methods. All
  instants are stored in UTC and rendered in the shop timezone (`SHOP_TZ` env,
  default `Europe/London`).

### 1.2 Data model (maps 1:1 to general.md Core Entities)

| Table | Columns (key ones) | general.md entity |
|---|---|---|
| `users` | `tg_id` PK, `name`, `role` (`client`/`owner`), `conversation_state` | **User** |
| `services` | `id` PK, `name`, `description`, `duration_min`, `active` | **Service** |
| `barbers` | `id` PK, `name`, `specialty`, `active` | **Barber** |
| `time_slots` | `id` PK, `barber_id` FK, `service_id` FK, `date`, `start_time` | **TimeSlot** |
| `appointments` | `id` PK, `client_tg_id` FK, `service_id` FK, `barber_id` FK, `time_slot_id` FK (unique), `status` (`confirmed`/`completed`/`cancelled`), `created_at`, `updated_at` | **Appointment** |
| `notifications` | `id` PK, `type` (`booking`/`cancel`/`reschedule`), `appointment_id` FK, `created_at` | **Notification** |

Relationships (exactly as general.md states):
`User → Appointment` 1:N · `Service → Appointment` 1:N ·
`Barber → Appointment` 1:N · `TimeSlot → Appointment` **1:1** ·
`Appointment → Notification` 1:N.

A `time_slots` row is **predefined** by the owner (§4.7): each row ties a
specific barber + service to a date and start time. A slot is **available**
iff no non-cancelled appointment references it (`TimeSlot → Appointment` is
1:1). Availability is therefore derived from the appointments table at query
time — the bot does *not* maintain a separate live-availability feed
(general.md Non-Goal: *real-time availability tracking*), and it never
generates slots dynamically from barber workload (Non-Goal: *dynamic time slot
generation*). The owner is responsible for defining non-overlapping slots; the
bot treats each predefined slot as one atomic bookable unit, so no run-time
duration/overlap arithmetic is needed.

### 1.3 Roles & identity

- **Client** — any Telegram user. Created on first `/start`.
- **Owner** — the single barbershop owner, identified by the `OWNER_TG_ID`
  env var. The owner receives every notification (§4.8) and manages the
  catalog of services, barbers, and predefined time slots (§4.5–4.7). The
  first `/start` from `OWNER_TG_ID` promotes that user to `owner`. If
  `OWNER_TG_ID` is unset, the bot still serves clients and logs notifications
  instead of sending them (graceful degradation, §5).

Barbers are **profiles** (selectable data), not interactive bot users — only
clients and the owner converse with the bot, matching general.md (which routes
all alerts to the owner, not to individual barbers).

## 2. Roles & entry

`/start` registers the user (asks for a display name on first contact), then
shows the role-specific main menu as an inline keyboard:

- **Client**: `📅 Book` · `📋 My appointments` · `❌ Cancel` · `🔁 Reschedule`
- **Owner**: everything a client sees, plus `🧰 Services` · `💈 Barbers` ·
  `🗓 Time slots`

Every multi-step flow shows `⬅️ Back` and `🏠 Menu` buttons at each step, so a
user can always retreat or bail out to the main menu.

## 3. Command set

| Command | Role | Purpose |
|---|---|---|
| `/start` | all | register + role-specific main menu |
| `/help` | all | command cheat-sheet for the user's role |
| `/book` | client | start the booking flow (§4.1) |
| `/my` | client | list/filter appointments by date & status (§4.2) |
| `/cancel` | client | cancel an upcoming appointment (§4.3) |
| `/reschedule` | client | move an upcoming appointment to a new slot (§4.4) |
| `/services` | owner | manage the service catalog: add / edit / delete (§4.5) |
| `/barbers` | owner | manage barber profiles: add / edit / delete (§4.6) |
| `/slots` | owner | predefine time slots for a barber/service/date (§4.7) |

Unknown commands and stray text outside a flow → a short hint + the main menu.

Callback-data convention: `<flow>:<step>:<id>` — e.g. `bk:svc:3`,
`bk:barber:skip`, `bk:slot:91`, `my:filter:cancelled`, `resch:slot:91`. The
prefix tells the router which handler owns the tap, so inline steps need no
per-chat text state.

## 4. Conversation / UX flows

### 4.1 Client books an appointment (`/book` or `📅 Book`)

Order follows general.md's feature list — service first, barber optional:

```
/book
 → [inline] choose SERVICE          (one button per active service;
                                      shows name · description · duration)
 → [inline] choose BARBER            (active barbers offering that service,
                                      plus a [Any barber ⏭ Skip] button)
 → [inline] choose DATE              (calendar-style date picker showing the
                                      next dates that have ≥1 available slot
                                      for the chosen service[/barber])
 → [inline] choose TIME SLOT         (available predefined slots for that
                                      service/date, filtered to the chosen
                                      barber, or all barbers if skipped)
 → confirmation card: service, barber (or "Any"), date, time
   [✅ Confirm] [⬅️ Back] [🏠 Menu]
 → on confirm (transactional):
     - re-check the slot is still available (the "two clients race" case →
       polite "that slot was just taken" + back to the slot list)
     - INSERT appointment (status=confirmed); the 1:1 link consumes the slot
     - NotificationService emits a `booking` notification to the owner (§4.8)
     - reply with a confirmation/receipt card (general.md: Appointment
       Confirmation → "Send confirmation message … Store appointment")
```

If the client skipped barber selection, the slot list still shows each slot's
barber so the confirmation card names the actual barber assigned.

### 4.2 Appointment management (`/my` or `📋 My appointments`)

Lists the client's appointments with full details
(`Fri 19 Jun · 14:00 · Haircut · with Alex · confirmed`). A filter row lets the
user narrow the list (general.md: *Allow filtering by date/status*):

```
[ Upcoming ] [ Past ] [ Cancelled ]      ← status filter (callback my:filter:*)
[ Any date ] [ Today ] [ This week ]     ← date filter  (callback my:date:*)
```

- **Upcoming** = `confirmed` appointments whose slot is in the future (default).
- **Past** = `completed` (slot time has elapsed and the appointment was not
  cancelled — see §5 archival).
- **Cancelled** = `cancelled` appointments.

Each upcoming row carries `[❌ Cancel]` and `[🔁 Reschedule]` shortcut buttons
into §4.3 / §4.4.

### 4.3 Direct cancellation (`/cancel`, or a row button in §4.2)

```
list the client's upcoming (confirmed) appointments as buttons
 → tap one → confirm dialog [⚠️ Yes, cancel] [⬅️ Back]
 → on confirm (instant, per general.md "Process cancellations instantly"):
     - status → cancelled; updated_at set
     - the 1:1 slot link is released → the slot becomes available again
     - NotificationService emits a `cancel` notification to the owner (§4.8)
     - reply "Your appointment was cancelled."
```

### 4.4 Direct rescheduling (`/reschedule`, or a row button in §4.2)

```
list the client's upcoming appointments as buttons
 → tap one → choose new DATE → choose new TIME SLOT
   (same available-slot logic as §4.1, scoped to the same service; the original
    slot is excluded but remains held until the move succeeds)
 → confirmation card (old → new) [✅ Confirm] [⬅️ Back] [🏠 Menu]
 → on confirm (transactional):
     - re-check the new slot is still available (race guard)
     - release the old slot, point the appointment's time_slot_id at the new
       slot, keep status=confirmed, set updated_at
     - NotificationService emits a `reschedule` notification to the owner (§4.8)
     - reply with the updated receipt card
```

The same `appointment` row is updated (its `id` is preserved), satisfying
general.md *"Update appointment records with new details."*

### 4.5 Owner manages services (`/services`)

```
/services → list of services with [✏️ Edit][🗑 Delete] per row + [➕ Add]
  ➕ Add  → text-step flow: name → description → duration (min) → confirm → INSERT
  ✏️ Edit → same flow pre-filled → UPDATE
  🗑 Delete → confirm → soft-delete (active=false; existing appointments keep
             their FK, so history is preserved — general.md Data Persistence)
```

### 4.6 Owner manages barbers (`/barbers`)

```
/barbers → list of barbers with [✏️ Edit][🗑 Delete] per row + [➕ Add]
  ➕ Add  → text-step flow: name → specialty → confirm → INSERT
  ✏️ Edit → UPDATE; 🗑 Delete → soft-delete (active=false, history preserved)
```

### 4.7 Owner predefines time slots (`/slots`)

```
/slots → choose BARBER → choose SERVICE → choose DATE
       → enter one or more start times (e.g. "10:00, 11:30, 14:00")
       → confirm → INSERT one time_slots row per (barber, service, date, time)
```

This is **manual, predefined** slot creation — the owner explicitly lists the
bookable times. The bot never auto-generates slots from workload or duration
(general.md Non-Goal). Existing slots for the date are shown so the owner can
see/avoid duplicates; a slot already consumed by a confirmed appointment is
shown locked.

### 4.8 Owner notifications (System — `NotificationService`)

On every successful booking, cancellation, and reschedule, the service inserts
a `notifications` row (`type`, `appointment_id`, `created_at`) and sends the
owner a Telegram message including the appointment details (client name,
service, barber, date/time):

- `booking`  → *"🆕 New booking: Haircut with Alex — Fri 19 Jun 14:00 — client Sam."*
- `cancel`   → *"❌ Cancelled: Haircut with Alex — Fri 19 Jun 14:00 — client Sam."*
- `reschedule` → *"🔁 Rescheduled: Haircut with Alex — was Fri 14:00, now Sat 16:00 — client Sam."*

This is the general.md **Owner Notifications** feature in full. If `OWNER_TG_ID`
is unset, the `notifications` row is still written and the send is logged and
skipped (no crash).

## 5. Edge cases & rules

- **Slot races** — booking and reschedule re-validate slot availability inside
  a transaction at confirm time (§4.1, §4.4); a lost race shows a polite
  message and returns to the slot list. This is an integrity check at write
  time, not the live availability tracking excluded by general.md.
- **Availability source of truth** — a slot is available iff no `confirmed`
  (or `completed`) appointment references it; cancelling frees the slot,
  rescheduling moves the 1:1 link.
- **Archival / completion** — appointments are never hard-deleted. A
  `confirmed` appointment whose slot time has passed is treated as `completed`;
  `cancelled` rows are retained with timestamps. This satisfies general.md
  *"Archive completed/cancelled appointments with timestamps."*
- **Timezone** — all storage in UTC; all dates/times rendered in `SHOP_TZ`.
- **Restart safety** — conversation state and all bookings/slots live in
  storage, not in-memory timers; an unknown conversation state degrades to the
  main menu.
- **Authorization** — owner-only commands (`/services`, `/barbers`, `/slots`)
  reject non-owners with a short notice and the client menu.

## 6. Non-Goals (inherited from general.md)

No real-time availability tracking (slots are predefined; availability is a
derived read), no payment/financial processing (confirmation is a plain step),
no loyalty/history analytics, no multi-location/franchise support, no
voice/video, and no dynamic slot generation from barber workload.
