// Storage layer (docs/details.md §1, docs/design.md §1.2). Six tables mapping
// 1:1 to the general.md Core Entities. The engine is in-memory (the toolkit's
// blessed default; the swap point for SQL is this one class — handlers only
// see the query methods). A fresh Store is created per bot, so the tokenless
// harness gets full isolation between specs.

export type Role = "client" | "owner";

export type ConversationState =
  | "menu"
  | "reg:name"
  | string; // feature flows register their own namespaces (e.g. "svc:add:name")

export interface User {
  tgId: number;
  name: string | null;
  role: Role;
  state: ConversationState;
}

export interface Service {
  id: number;
  name: string;
  description: string;
  durationMin: number;
  active: boolean;
}

export interface Barber {
  id: number;
  name: string;
  specialty: string;
  active: boolean;
}

/** A predefined bookable unit: a specific barber+service at a date/start time.
 *  date = "YYYY-MM-DD", startTime = "HH:MM", both shop-local wall-clock. */
export interface TimeSlot {
  id: number;
  barberId: number;
  serviceId: number;
  date: string;
  startTime: string;
}

export type AppointmentStatus = "confirmed" | "completed" | "cancelled";

export interface Appointment {
  id: number;
  clientTgId: number;
  serviceId: number;
  barberId: number;
  timeSlotId: number;
  status: AppointmentStatus;
  createdAt: string; // ISO-8601 UTC
  updatedAt: string; // ISO-8601 UTC
}

export type NotificationType = "booking" | "cancel" | "reschedule";

export interface Notification {
  id: number;
  type: NotificationType;
  appointmentId: number;
  createdAt: string; // ISO-8601 UTC
}

export class Store {
  private seq = 0;
  readonly users = new Map<number, User>();
  readonly services = new Map<number, Service>();
  readonly barbers = new Map<number, Barber>();
  readonly timeSlots = new Map<number, TimeSlot>();
  readonly appointments = new Map<number, Appointment>();
  readonly notifications = new Map<number, Notification>();

  nextId(): number {
    return ++this.seq;
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── users ──
  upsertUser(tgId: number): User {
    let u = this.users.get(tgId);
    if (!u) {
      u = { tgId, name: null, role: "client", state: "menu" };
      this.users.set(tgId, u);
    }
    return u;
  }

  // ── services ──
  addService(name: string, description: string, durationMin: number): Service {
    const s: Service = { id: this.nextId(), name, description, durationMin, active: true };
    this.services.set(s.id, s);
    return s;
  }
  activeServices(): Service[] {
    return [...this.services.values()].filter((s) => s.active).sort((a, b) => a.id - b.id);
  }
  getService(id: number): Service | undefined {
    return this.services.get(id);
  }

  // ── barbers ──
  addBarber(name: string, specialty: string): Barber {
    const b: Barber = { id: this.nextId(), name, specialty, active: true };
    this.barbers.set(b.id, b);
    return b;
  }
  activeBarbers(): Barber[] {
    return [...this.barbers.values()].filter((b) => b.active).sort((a, b) => a.id - b.id);
  }
  getBarber(id: number): Barber | undefined {
    return this.barbers.get(id);
  }

  // ── time slots ──
  addSlot(barberId: number, serviceId: number, date: string, startTime: string): TimeSlot {
    const t: TimeSlot = { id: this.nextId(), barberId, serviceId, date, startTime };
    this.timeSlots.set(t.id, t);
    return t;
  }
  getSlot(id: number): TimeSlot | undefined {
    return this.timeSlots.get(id);
  }
  /** Predefined slots for a service on a date, optionally pinned to one barber,
   *  ordered by start time. Availability/past filtering is the caller's job. */
  slotsFor(serviceId: number, date: string, barberId?: number): TimeSlot[] {
    return [...this.timeSlots.values()]
      .filter(
        (t) =>
          t.serviceId === serviceId &&
          t.date === date &&
          (barberId === undefined || t.barberId === barberId),
      )
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  /** True iff a non-cancelled appointment already references this slot. */
  slotTaken(slotId: number): boolean {
    for (const a of this.appointments.values()) {
      if (a.timeSlotId === slotId && a.status !== "cancelled") return true;
    }
    return false;
  }

  // ── appointments ──
  addAppointment(clientTgId: number, serviceId: number, barberId: number, timeSlotId: number): Appointment {
    const ts = this.now();
    const a: Appointment = {
      id: this.nextId(),
      clientTgId,
      serviceId,
      barberId,
      timeSlotId,
      status: "confirmed",
      createdAt: ts,
      updatedAt: ts,
    };
    this.appointments.set(a.id, a);
    return a;
  }
  getAppointment(id: number): Appointment | undefined {
    return this.appointments.get(id);
  }
  appointmentsOfClient(clientTgId: number): Appointment[] {
    return [...this.appointments.values()]
      .filter((a) => a.clientTgId === clientTgId)
      .sort((a, b) => a.id - b.id);
  }
  setAppointmentStatus(id: number, status: AppointmentStatus): void {
    const a = this.appointments.get(id);
    if (a) {
      a.status = status;
      a.updatedAt = this.now();
    }
  }
  /** Move an appointment to a new slot (reschedule), preserving its id. */
  moveAppointment(id: number, newSlotId: number, newBarberId: number): void {
    const a = this.appointments.get(id);
    if (a) {
      a.timeSlotId = newSlotId;
      a.barberId = newBarberId;
      a.updatedAt = this.now();
    }
  }

  // ── notifications ──
  addNotification(type: NotificationType, appointmentId: number): Notification {
    const n: Notification = {
      id: this.nextId(),
      type,
      appointmentId,
      createdAt: this.now(),
    };
    this.notifications.set(n.id, n);
    return n;
  }
}
