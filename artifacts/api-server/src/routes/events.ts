import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
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
  organizerFollowsTable,
  notificationsTable,
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

  const [countRows, rsvpRows, savedRows, followingRows] = await Promise.all([
    db
      .select({ eventId: rsvpsTable.eventId, total: count() })
      .from(rsvpsTable)
      .where(and(inArray(rsvpsTable.eventId, ids), eq(rsvpsTable.status, "confirmed")))
      .groupBy(rsvpsTable.eventId),
    userId
      ? db
          .select({
            eventId: rsvpsTable.eventId,
            status: rsvpsTable.status,
            registrationCode: rsvpsTable.registrationCode,
            checkedInAt: rsvpsTable.checkedInAt,
          })
          .from(rsvpsTable)
          .where(and(eq(rsvpsTable.userId, userId), inArray(rsvpsTable.eventId, ids)))
      : Promise.resolve([]),
    userId
      ? db
          .select({ eventId: savedEventsTable.eventId })
          .from(savedEventsTable)
          .where(and(eq(savedEventsTable.userId, userId), inArray(savedEventsTable.eventId, ids)))
      : Promise.resolve([]),
    userId
      ? db
          .select({ organizerId: organizerFollowsTable.organizerId })
          .from(organizerFollowsTable)
          .where(
            and(
              eq(organizerFollowsTable.userId, userId),
              inArray(organizerFollowsTable.organizerId, rows.map(({ organizer }) => organizer.id)),
            ),
          )
      : Promise.resolve([]),
  ]);

  const countsByEvent = new Map(countRows.map((row) => [row.eventId, row.total]));
  const rsvpByEvent = new Map(rsvpRows.map((row) => [row.eventId, row]));
  const savedIds = new Set(savedRows.map((row) => row.eventId));
  const followingIds = new Set(followingRows.map((row) => row.organizerId));

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
    latitude: event.latitude,
    longitude: event.longitude,
    mode: event.mode,
    price: event.price,
    currency: event.currency,
    capacity: event.capacity,
    registrationDeadline: event.registrationDeadline,
    externalUrl: event.externalUrl,
    status: event.status,
    isDemo: event.isDemo,
    attendeeCount: countsByEvent.get(event.id) ?? 0,
    rsvpStatus: rsvpByEvent.get(event.id)?.status ?? null,
    rsvpRegistrationCode:
      event.status === "published" && rsvpByEvent.get(event.id)?.status === "confirmed"
        ? rsvpByEvent.get(event.id)?.registrationCode ?? null
        : null,
    rsvpCheckedInAt: rsvpByEvent.get(event.id)?.checkedInAt ?? null,
    organizerFollowing: followingIds.has(organizer.id),
    distanceKm: null as number | null,
    isSaved: savedIds.has(event.id),
    organizer,
  }));
}

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(bLat - aLat);
  const deltaLng = toRadians(bLng - aLng);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) *
      Math.cos(toRadians(bLat)) *
      Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
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

  const { q, category, city, mode, price, sort, limit, dateFrom, dateTo, latitude, longitude, radiusKm } =
    parsed.data;
  const hasLatitude = latitude !== undefined;
  const hasLongitude = longitude !== undefined;
  if (hasLatitude !== hasLongitude || (radiusKm !== undefined && !hasLatitude)) {
    res.status(400).json({ error: "Provide both coordinates to use a radius filter." });
    return;
  }
  const filters: SQL<unknown>[] = [
    eq(eventsTable.status, "published"),
    gt(eventsTable.endAt, new Date()),
  ];
  if (category) filters.push(eq(eventsTable.category, category));
  if (city) filters.push(ilike(eventsTable.city, `%${city.trim().slice(0, 100)}%`));
  if (mode) filters.push(eq(eventsTable.mode, mode));
  if (price === "free") filters.push(eq(eventsTable.price, 0));
  if (price === "paid") filters.push(gt(eventsTable.price, 0));
  if (dateFrom) filters.push(gte(eventsTable.startAt, dateFrom));
  if (dateTo) filters.push(lte(eventsTable.startAt, dateTo));
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
  let events = await toEventDtos(rows, getUserId(req));
  if (hasLatitude && hasLongitude) {
    events = events
      .filter(
        (event) =>
          event.latitude !== null &&
          event.longitude !== null &&
          event.latitude >= -90 &&
          event.latitude <= 90 &&
          event.longitude >= -180 &&
          event.longitude <= 180,
      )
      .map((event) => ({
        ...event,
        distanceKm: distanceKm(latitude!, longitude!, event.latitude!, event.longitude!),
      }));
    if (radiusKm !== undefined) events = events.filter((event) => (event.distanceKm ?? Infinity) <= radiusKm);
    events.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }
  if (sort === "popular") events = events.sort((a, b) => b.attendeeCount - a.attendeeCount);
  res.json(ListEventsResponse.parse(events.slice(0, limit)));
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
    and(eq(eventsTable.id, params.data.eventId), inArray(eventsTable.status, ["published", "cancelled"]))!,
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
    if (
      !event ||
      event.status !== "published" ||
      event.endAt <= new Date() ||
      (event.registrationDeadline && event.registrationDeadline <= new Date())
    ) {
      return { kind: "unavailable" as const };
    }

    const [existing] = await tx
      .select()
      .from(rsvpsTable)
      .where(and(eq(rsvpsTable.eventId, event.id), eq(rsvpsTable.userId, userId)));
    if (existing && existing.status !== "cancelled") return { kind: "duplicate" as const };

    const [attendeeCount] = await tx
      .select({ total: count() })
      .from(rsvpsTable)
      .where(and(eq(rsvpsTable.eventId, event.id), eq(rsvpsTable.status, "confirmed")));
    const full = event.capacity !== null && attendeeCount.total >= event.capacity;
    const nextStatus = full ? "waitlisted" : "confirmed";
    const registrationCode = randomBytes(24).toString("base64url");
    const [rsvp] = existing
      ? await tx
          .update(rsvpsTable)
          .set({
            status: nextStatus,
            registrationCode,
            checkedInAt: null,
            cancelledAt: null,
            createdAt: new Date(),
          })
          .where(eq(rsvpsTable.id, existing.id))
          .returning()
      : await tx
          .insert(rsvpsTable)
          .values({
            eventId: event.id,
            userId,
            status: nextStatus,
            registrationCode,
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
      registrationCode: result.rsvp.status === "confirmed" ? result.rsvp.registrationCode : null,
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
    if (rsvp.checkedInAt) return { kind: "checked-in" as const };

    await tx
      .update(rsvpsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(rsvpsTable.id, rsvp.id));
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
        await tx.insert(notificationsTable).values({
          userId: next.userId,
          eventId: event.id,
          kind: "waitlist_promotion",
          title: "A spot opened up",
          body: `Your RSVP for ${event.title} is now confirmed.`,
        });
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
  if (result.kind === "checked-in") {
    res.status(409).json({ error: "An attendee who has checked in cannot cancel their registration." });
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
  const registeredIds = registrations
    .filter((rsvp) => rsvp.status === "confirmed" || rsvp.status === "waitlisted")
    .map((rsvp) => rsvp.eventId);
  const cancelledIds = registrations
    .filter((rsvp) => rsvp.status === "cancelled")
    .map((rsvp) => rsvp.eventId);
  const savedIds = saved.map((item) => item.eventId);
  const ids = [...new Set([...registeredIds, ...cancelledIds, ...savedIds])];
  const rows =
    ids.length === 0
      ? []
      : await listJoinedEvents(inArray(eventsTable.id, ids));
  const all = await toEventDtos(rows, userId);
  const eventById = new Map(all.map((event) => [event.id, event]));
  const registered = registeredIds
    .map((id) => eventById.get(id))
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
  const cancelled = cancelledIds
    .map((id) => eventById.get(id))
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
  const savedEvents = savedIds
    .map((id) => eventById.get(id))
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
  res.json(GetMyEventsResponse.parse({ registered, cancelled, saved: savedEvents }));
});

export default router;
