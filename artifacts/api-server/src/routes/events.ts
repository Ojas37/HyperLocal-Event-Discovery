import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, ilike, inArray, or, type SQL } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  CancelRsvpParams,
  CancelRsvpResponse,
  CreateRsvpParams,
  CreateRsvpResponse,
  GetEventParams,
  GetEventResponse,
  GetMyEventsResponse,
  ListEventsQueryParams,
  ListEventsResponse,
  SaveEventParams,
  SaveEventResponse,
  UnsaveEventParams,
  UnsaveEventResponse,
} from "@workspace/api-zod";
import {
  db,
  eventsTable,
  organizersTable,
  rsvpsTable,
  savedEventsTable,
} from "@workspace/db";

const router: IRouter = Router();

export type JoinedEvent = {
  event: typeof eventsTable.$inferSelect;
  organizer: {
    id: number;
    name: string;
    verified: boolean;
  };
};

export async function listJoinedEvents(where: SQL<unknown>, direction: "soonest" | "newest" = "soonest") {
  const query = db
    .select({
      event: eventsTable,
      organizer: {
        id: organizersTable.id,
        name: organizersTable.name,
        verified: organizersTable.verified,
      },
    })
    .from(eventsTable)
    .innerJoin(organizersTable, eq(eventsTable.organizerId, organizersTable.id))
    .where(where);

  return direction === "newest"
    ? query.orderBy(desc(eventsTable.createdAt))
    : query.orderBy(asc(eventsTable.startAt));
}

export async function toEventDtos(rows: JoinedEvent[], userId?: string) {
  const ids = rows.map(({ event }) => event.id);
  if (ids.length === 0) return [];

  const [countRows, rsvpRows, savedRows] = await Promise.all([
    db
      .select({ eventId: rsvpsTable.eventId, total: count() })
      .from(rsvpsTable)
      .where(and(inArray(rsvpsTable.eventId, ids), eq(rsvpsTable.status, "confirmed")))
      .groupBy(rsvpsTable.eventId),
    userId
      ? db
          .select({ eventId: rsvpsTable.eventId, status: rsvpsTable.status })
          .from(rsvpsTable)
          .where(and(eq(rsvpsTable.userId, userId), inArray(rsvpsTable.eventId, ids)))
      : Promise.resolve([]),
    userId
      ? db
          .select({ eventId: savedEventsTable.eventId })
          .from(savedEventsTable)
          .where(and(eq(savedEventsTable.userId, userId), inArray(savedEventsTable.eventId, ids)))
      : Promise.resolve([]),
  ]);

  const countsByEvent = new Map(countRows.map((row) => [row.eventId, row.total]));
  const rsvpByEvent = new Map(rsvpRows.map((row) => [row.eventId, row.status]));
  const savedIds = new Set(savedRows.map((row) => row.eventId));

  return rows.map(({ event, organizer }) => ({
    id: event.id,
    title: event.title,
    slug: event.slug,
    description: event.description,
    category: event.category,
    tags: event.tags,
    bannerUrl: event.bannerUrl,
    startAt: event.startAt,
    endAt: event.endAt,
    timezone: event.timezone,
    venue: event.venue,
    city: event.city,
    mode: event.mode,
    price: event.price,
    currency: event.currency,
    capacity: event.capacity,
    registrationDeadline: event.registrationDeadline,
    externalUrl: event.externalUrl,
    status: event.status,
    isDemo: event.isDemo,
    attendeeCount: countsByEvent.get(event.id) ?? 0,
    rsvpStatus: rsvpByEvent.get(event.id) ?? null,
    isSaved: savedIds.has(event.id),
    organizer,
  }));
}

function getUserId(req: Parameters<typeof getAuth>[0]): string | undefined {
  return getAuth(req).userId ?? undefined;
}

function parseEventId(params: unknown) {
  return GetEventParams.safeParse(params);
}

router.get("/events", async (req, res): Promise<void> => {
  const parsed = ListEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { q, category, city, mode, price, sort, limit } = parsed.data;
  const filters: SQL<unknown>[] = [
    eq(eventsTable.status, "published"),
    gt(eventsTable.endAt, new Date()),
  ];
  if (category) filters.push(eq(eventsTable.category, category));
  if (city) filters.push(ilike(eventsTable.city, `%${city.trim().slice(0, 100)}%`));
  if (mode) filters.push(eq(eventsTable.mode, mode));
  if (price === "free") filters.push(eq(eventsTable.price, 0));
  if (price === "paid") filters.push(gt(eventsTable.price, 0));
  if (q?.trim()) {
    const term = `%${q.trim().slice(0, 120)}%`;
    filters.push(
      or(
        ilike(eventsTable.title, term),
        ilike(eventsTable.description, term),
        ilike(eventsTable.city, term),
        ilike(eventsTable.venue, term),
        ilike(organizersTable.name, term),
        ilike(eventsTable.category, term),
      )!,
    );
  }

  const rows = await listJoinedEvents(and(...filters)!, sort === "newest" ? "newest" : "soonest");
  let events = await toEventDtos(rows.slice(0, limit), getUserId(req));
  if (sort === "popular") events = events.sort((a, b) => b.attendeeCount - a.attendeeCount);
  res.json(ListEventsResponse.parse(events));
});

router.get("/events/featured", async (req, res): Promise<void> => {
  const rows = await listJoinedEvents(
    and(eq(eventsTable.status, "published"), gt(eventsTable.endAt, new Date()))!,
  );
  const events = await toEventDtos(rows.slice(0, 8), getUserId(req));
  res.json(ListEventsResponse.parse(events));
});

router.get("/events/:eventId", async (req, res): Promise<void> => {
  const params = parseEventId(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await listJoinedEvents(
    and(eq(eventsTable.id, params.data.eventId), eq(eventsTable.status, "published"))!,
  );
  if (!row) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const [event] = await toEventDtos([row], getUserId(req));
  res.json(GetEventResponse.parse(event));
});

router.post("/events/:eventId/rsvp", async (req, res): Promise<void> => {
  const params = CreateRsvpParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to RSVP for an event." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, params.data.eventId))
      .for("update");
    if (!event || event.status !== "published" || event.endAt <= new Date()) {
      return { kind: "unavailable" as const };
    }

    const [existing] = await tx
      .select()
      .from(rsvpsTable)
      .where(and(eq(rsvpsTable.eventId, event.id), eq(rsvpsTable.userId, userId)));
    if (existing) return { kind: "duplicate" as const };

    const [attendeeCount] = await tx
      .select({ total: count() })
      .from(rsvpsTable)
      .where(and(eq(rsvpsTable.eventId, event.id), eq(rsvpsTable.status, "confirmed")));
    const full = event.capacity !== null && attendeeCount.total >= event.capacity;
    const [rsvp] = await tx
      .insert(rsvpsTable)
      .values({
        eventId: event.id,
        userId,
        status: full ? "waitlisted" : "confirmed",
        registrationCode: randomBytes(24).toString("base64url"),
      })
      .returning();
    return { kind: "created" as const, rsvp };
  });

  if (result.kind === "unavailable") {
    res.status(404).json({ error: "This event is no longer available for registration." });
    return;
  }
  if (result.kind === "duplicate") {
    res.status(409).json({ error: "You already have a registration for this event." });
    return;
  }
  res.status(201).json(
    CreateRsvpResponse.parse({
      id: result.rsvp.id,
      eventId: result.rsvp.eventId,
      status: result.rsvp.status,
      registrationCode: result.rsvp.registrationCode,
    }),
  );
});

router.delete("/events/:eventId/rsvp", async (req, res): Promise<void> => {
  const params = CancelRsvpParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to manage your registration." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, params.data.eventId))
      .for("update");
    if (!event) return { kind: "missing" as const };

    const [rsvp] = await tx
      .select()
      .from(rsvpsTable)
      .where(and(eq(rsvpsTable.eventId, event.id), eq(rsvpsTable.userId, userId)));
    if (!rsvp) return { kind: "missing-rsvp" as const };

    await tx.delete(rsvpsTable).where(eq(rsvpsTable.id, rsvp.id));
    if (rsvp.status === "confirmed") {
      const [next] = await tx
        .select()
        .from(rsvpsTable)
        .where(and(eq(rsvpsTable.eventId, event.id), eq(rsvpsTable.status, "waitlisted")))
        .orderBy(asc(rsvpsTable.createdAt), asc(rsvpsTable.id))
        .limit(1)
        .for("update");
      if (next) {
        await tx
          .update(rsvpsTable)
          .set({ status: "confirmed" })
          .where(eq(rsvpsTable.id, next.id));
      }
    }
    return { kind: "cancelled" as const };
  });

  if (result.kind === "missing") {
    res.status(404).json({ error: "Event not found." });
    return;
  }
  if (result.kind === "missing-rsvp") {
    res.status(404).json({ error: "No registration found for this event." });
    return;
  }
  res.status(204).send();
});

router.post("/events/:eventId/save", async (req, res): Promise<void> => {
  const params = SaveEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to save events." });
    return;
  }
  const [event] = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(eq(eventsTable.id, params.data.eventId));
  if (!event) {
    res.status(404).json({ error: "Event not found." });
    return;
  }
  await db
    .insert(savedEventsTable)
    .values({ userId, eventId: event.id })
    .onConflictDoNothing();
  SaveEventResponse.parse(undefined);
  res.status(204).send();
});

router.delete("/events/:eventId/save", async (req, res): Promise<void> => {
  const params = UnsaveEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to manage saved events." });
    return;
  }
  await db
    .delete(savedEventsTable)
    .where(and(eq(savedEventsTable.userId, userId), eq(savedEventsTable.eventId, params.data.eventId)));
  UnsaveEventResponse.parse(undefined);
  res.status(204).send();
});

router.get("/me/events", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to view your events." });
    return;
  }
  const [registrations, saved] = await Promise.all([
    db.select().from(rsvpsTable).where(eq(rsvpsTable.userId, userId)),
    db.select().from(savedEventsTable).where(eq(savedEventsTable.userId, userId)),
  ]);
  const registeredIds = registrations.map((rsvp) => rsvp.eventId);
  const savedIds = saved.map((item) => item.eventId);
  const ids = [...new Set([...registeredIds, ...savedIds])];
  const rows =
    ids.length === 0
      ? []
      : await listJoinedEvents(inArray(eventsTable.id, ids));
  const all = await toEventDtos(rows, userId);
  const eventById = new Map(all.map((event) => [event.id, event]));
  const registered = registeredIds
    .map((id) => eventById.get(id))
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
  const savedEvents = savedIds
    .map((id) => eventById.get(id))
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
  res.json(GetMyEventsResponse.parse({ registered, saved: savedEvents }));
});

export default router;
