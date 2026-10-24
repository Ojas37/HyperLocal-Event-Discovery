import { randomBytes } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  CreateOrganizerBody,
  CreateOrganizerResponse,
  CreateOrganizerEventBody,
  CreateOrganizerEventResponse,
  GetMyOrganizerResponse,
  GetOrganizerDashboardResponse,
  PublishOrganizerEventParams,
  PublishOrganizerEventResponse,
} from "@workspace/api-zod";
import {
  db,
  eventsTable,
  organizersTable,
  rsvpsTable,
} from "@workspace/db";
import { listJoinedEvents, toEventDtos } from "./events";

const router: IRouter = Router();

function userIdFor(req: Parameters<typeof getAuth>[0]) {
  return getAuth(req).userId ?? undefined;
}

function organizerDto(organizer: typeof organizersTable.$inferSelect) {
  return {
    id: organizer.id,
    name: organizer.name,
    type: organizer.type,
    description: organizer.description,
    verified: organizer.verified,
  };
}

async function findOrganizer(ownerId: string) {
  const [organizer] = await db
    .select()
    .from(organizersTable)
    .where(eq(organizersTable.ownerId, ownerId));
  return organizer;
}

router.get("/organizer/me", async (req, res): Promise<void> => {
  const ownerId = userIdFor(req);
  if (!ownerId) {
    res.status(401).json({ error: "Sign in to view your organizer profile." });
    return;
  }
  const organizer = await findOrganizer(ownerId);
  res.json(GetMyOrganizerResponse.parse(organizer ? organizerDto(organizer) : null));
});

router.post("/organizer/me", async (req, res): Promise<void> => {
  const ownerId = userIdFor(req);
  if (!ownerId) {
    res.status(401).json({ error: "Sign in to create an organizer profile." });
    return;
  }
  const body = CreateOrganizerBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const existing = await findOrganizer(ownerId);
  if (existing) {
    res.status(409).json({ error: "You already have an organizer profile." });
    return;
  }
  const [organizer] = await db
    .insert(organizersTable)
    .values({
      ownerId,
      name: body.data.name.trim(),
      type: body.data.type,
      description: body.data.description?.trim() ?? "",
    })
    .returning();
  res.status(201).json(CreateOrganizerResponse.parse(organizerDto(organizer)));
});

router.get("/organizer/dashboard", async (req, res): Promise<void> => {
  const ownerId = userIdFor(req);
  if (!ownerId) {
    res.status(401).json({ error: "Sign in to view your organizer dashboard." });
    return;
  }
  const organizer = await findOrganizer(ownerId);
  if (!organizer) {
    res.status(403).json({ error: "Create an organizer profile to access this dashboard." });
    return;
  }

  const [eventRows, countRows] = await Promise.all([
    listJoinedEvents(eq(eventsTable.organizerId, organizer.id), "newest"),
    db
      .select({ status: rsvpsTable.status, total: count() })
      .from(rsvpsTable)
      .innerJoin(eventsTable, eq(rsvpsTable.eventId, eventsTable.id))
      .where(eq(eventsTable.organizerId, organizer.id))
      .groupBy(rsvpsTable.status),
  ]);
  const events = await toEventDtos(eventRows, ownerId);
  const totalFor = (status: string) =>
    countRows.find((row) => row.status === status)?.total ?? 0;
  const response = {
    organizer: organizerDto(organizer),
    events,
    publishedCount: eventRows.filter(({ event }) => event.status === "published").length,
    draftCount: eventRows.filter(({ event }) => event.status === "draft").length,
    confirmedRsvps: totalFor("confirmed"),
    waitlistedRsvps: totalFor("waitlisted"),
  };
  res.json(GetOrganizerDashboardResponse.parse(response));
});

router.post("/organizer/events", async (req, res): Promise<void> => {
  const ownerId = userIdFor(req);
  if (!ownerId) {
    res.status(401).json({ error: "Sign in to create an event." });
    return;
  }
  const organizer = await findOrganizer(ownerId);
  if (!organizer) {
    res.status(403).json({ error: "Create an organizer profile before listing an event." });
    return;
  }
  const body = CreateOrganizerEventBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const input = body.data;
  if (input.endAt <= input.startAt) {
    res.status(400).json({ error: "The end time must be after the start time." });
    return;
  }
  if (!input.venue.trim() || !input.city.trim()) {
    res.status(400).json({ error: "Add a venue and city before saving this event." });
    return;
  }

  const slugBase = input.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);
  const [event] = await db
    .insert(eventsTable)
    .values({
      organizerId: organizer.id,
      title: input.title.trim(),
      slug: `${slugBase || "event"}-${randomBytes(3).toString("hex")}`,
      description: input.description.trim(),
      category: input.category.trim(),
      tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
      bannerUrl: input.bannerUrl.trim(),
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      venue: input.venue.trim(),
      city: input.city.trim(),
      mode: input.mode,
      price: input.price,
      currency: input.currency.toUpperCase(),
      capacity: input.capacity,
      registrationDeadline: input.registrationDeadline,
      externalUrl: input.externalUrl,
      status: "draft",
    })
    .returning();
  const [row] = await listJoinedEvents(eq(eventsTable.id, event.id));
  const [eventDto] = await toEventDtos([row], ownerId);
  res.status(201).json(CreateOrganizerEventResponse.parse(eventDto));
});

router.post("/organizer/events/:eventId/publish", async (req, res): Promise<void> => {
  const ownerId = userIdFor(req);
  if (!ownerId) {
    res.status(401).json({ error: "Sign in to publish an event." });
    return;
  }
  const params = PublishOrganizerEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const organizer = await findOrganizer(ownerId);
  if (!organizer) {
    res.status(403).json({ error: "An organizer profile is required to publish events." });
    return;
  }
  const [event] = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.id, params.data.eventId),
        eq(eventsTable.organizerId, organizer.id),
      ),
    );
  if (!event) {
    res.status(404).json({ error: "Event not found." });
    return;
  }
  if (
    !event.title.trim() ||
    !event.description.trim() ||
    !event.venue.trim() ||
    !event.city.trim() ||
    event.startAt <= new Date() ||
    event.endAt <= event.startAt
  ) {
    res.status(400).json({
      error: "Add a title, description, future date, and usable venue before publishing.",
    });
    return;
  }
  const [published] = await db
    .update(eventsTable)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(eventsTable.id, event.id))
    .returning();
  const [row] = await listJoinedEvents(eq(eventsTable.id, published.id));
  const [eventDto] = await toEventDtos([row], ownerId);
  res.json(PublishOrganizerEventResponse.parse(eventDto));
});

export default router;
