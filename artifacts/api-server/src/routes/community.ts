import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, ilike, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateCommunityBody,
  CreateCommunityResponse,
  CreateEventReviewBody,
  CreateEventReviewParams,
  CreateEventReviewResponse,
  FollowOrganizerParams,
  GetCommunityParams,
  GetCommunityResponse,
  GetMyAttendanceBadgesResponse,
  GetMyNotificationsResponse,
  GetMyPreferencesResponse,
  GetMyRecommendationsResponse,
  JoinCommunityParams,
  ListCommunitiesQueryParams,
  ListCommunitiesResponse,
  ListEventReviewsParams,
  ListEventReviewsResponse,
  MarkNotificationReadParams,
  ReportEventBody,
  ReportEventParams,
  ReportEventResponse,
  UpdateMyPreferencesBody,
  UpdateMyPreferencesResponse,
} from "@workspace/api-zod";
import {
  attendanceBadgesTable,
  communitiesTable,
  communityMembersTable,
  db,
  eventReportsTable,
  eventReviewsTable,
  eventsTable,
  organizerFollowsTable,
  organizersTable,
  notificationsTable,
  rsvpsTable,
  savedEventsTable,
  userPreferencesTable,
} from "@workspace/db";
import { currentUserId } from "../lib/authz";
import { listJoinedEvents, toEventDtos } from "./events";

const router: IRouter = Router();

function isUniqueViolation(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "23505";
}

function organizerSummary(organizer: { id: number; name: string; verified: boolean }) {
  return { id: organizer.id, name: organizer.name, verified: organizer.verified };
}

async function communityDto(community: typeof communitiesTable.$inferSelect, userId?: string) {
  const [members] = await db
    .select({ total: count() })
    .from(communityMembersTable)
    .where(eq(communityMembersTable.communityId, community.id));
  const [organizer] = await db
    .select({
      id: organizersTable.id,
      name: organizersTable.name,
      verified: organizersTable.verified,
    })
    .from(organizersTable)
    .where(eq(organizersTable.id, community.organizerId));
  const [membership] = userId
    ? await db
        .select({ communityId: communityMembersTable.communityId })
        .from(communityMembersTable)
        .where(
          and(
            eq(communityMembersTable.communityId, community.id),
            eq(communityMembersTable.userId, userId),
          ),
        )
        .limit(1)
    : [];
  return {
    id: community.id,
    slug: community.slug,
    name: community.name,
    description: community.description,
    topics: community.topics,
    city: community.city,
    organizer: organizerSummary(organizer),
    memberCount: members.total,
    isMember: Boolean(membership),
  };
}

router.post("/organizers/:organizerId/follow", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = FollowOrganizerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to follow organizers." });
    return;
  }
  const [organizer] = await db
    .select({ id: organizersTable.id })
    .from(organizersTable)
    .where(eq(organizersTable.id, params.data.organizerId))
    .limit(1);
  if (!organizer) {
    res.status(404).json({ error: "Organizer not found." });
    return;
  }
  await db
    .insert(organizerFollowsTable)
    .values({ userId, organizerId: organizer.id })
    .onConflictDoNothing();
  res.status(204).send();
});

router.delete("/organizers/:organizerId/follow", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = FollowOrganizerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to manage organizer follows." });
    return;
  }
  await db
    .delete(organizerFollowsTable)
    .where(
      and(
        eq(organizerFollowsTable.userId, userId),
        eq(organizerFollowsTable.organizerId, params.data.organizerId),
      ),
    );
  res.status(204).send();
});

router.post("/events/:eventId/reports", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = ReportEventParams.safeParse(req.params);
  const body = ReportEventBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter a valid report reason and details." });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to report an event." });
    return;
  }
  const [event] = await db
    .select({ id: eventsTable.id, title: eventsTable.title })
    .from(eventsTable)
    .where(eq(eventsTable.id, params.data.eventId))
    .limit(1);
  if (!event) {
    res.status(404).json({ error: "Event not found." });
    return;
  }
  try {
    const [report] = await db
      .insert(eventReportsTable)
      .values({
        eventId: event.id,
        reporterId: userId,
        reason: body.data.reason,
        details: body.data.details?.trim() ?? "",
      })
      .returning();
    res.status(201).json(
      ReportEventResponse.parse({
        id: report.id,
        eventId: report.eventId,
        eventTitle: event.title,
        reporterId: report.reporterId,
        reason: report.reason,
        details: report.details,
        status: report.status,
        reviewedBy: report.reviewedBy,
        createdAt: report.createdAt,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "You have already reported this event." });
      return;
    }
    throw error;
  }
});

router.get("/events/:eventId/reviews", async (req, res): Promise<void> => {
  const params = ListEventReviewsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(eventReviewsTable)
    .where(eq(eventReviewsTable.eventId, params.data.eventId))
    .orderBy(desc(eventReviewsTable.createdAt))
    .limit(100);
  res.json(
    ListEventReviewsResponse.parse(
      rows.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        reviewerLabel: "Attendee",
        rating: row.rating,
        content: row.content,
        createdAt: row.createdAt,
      })),
    ),
  );
});

router.post("/events/:eventId/reviews", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = CreateEventReviewParams.safeParse(req.params);
  const body = CreateEventReviewBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter a rating from 1 to 5 and optional feedback." });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to leave event feedback." });
    return;
  }
  const [rsvp] = await db
    .select({ status: rsvpsTable.status, checkedInAt: rsvpsTable.checkedInAt })
    .from(rsvpsTable)
    .where(
      and(
        eq(rsvpsTable.eventId, params.data.eventId),
        eq(rsvpsTable.userId, userId),
        eq(rsvpsTable.status, "confirmed"),
      ),
    )
    .limit(1);
  if (!rsvp?.checkedInAt) {
    res.status(403).json({ error: "Verified attendance is required before reviewing this event." });
    return;
  }
  try {
    const [review] = await db
      .insert(eventReviewsTable)
      .values({
        eventId: params.data.eventId,
        userId,
        rating: body.data.rating,
        content: body.data.content?.trim() ?? "",
      })
      .returning();
    res.status(201).json(
      CreateEventReviewResponse.parse({
        id: review.id,
        eventId: review.eventId,
        reviewerLabel: "Attendee",
        rating: review.rating,
        content: review.content,
        createdAt: review.createdAt,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "You have already reviewed this event." });
      return;
    }
    throw error;
  }
});

router.get("/communities", async (req, res): Promise<void> => {
  const query = ListCommunitiesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const userId = currentUserId(req);
  const filters = [eq(communitiesTable.isPublic, true)];
  if (query.data.city?.trim()) {
    filters.push(ilike(communitiesTable.city, `%${query.data.city.trim().slice(0, 100)}%`));
  }
  const rows = await db
    .select()
    .from(communitiesTable)
    .where(and(...filters))
    .orderBy(asc(communitiesTable.name))
    .limit(100);
  const result = await Promise.all(rows.map((community) => communityDto(community, userId)));
  res.json(ListCommunitiesResponse.parse(result));
});

router.post("/communities", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const body = CreateCommunityBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to create a community." });
    return;
  }
  const [organizer] = await db
    .select()
    .from(organizersTable)
    .where(eq(organizersTable.ownerId, userId))
    .limit(1);
  if (!organizer) {
    res.status(403).json({ error: "Create an organizer profile before creating a community." });
    return;
  }
  const slugBase =
    body.data.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 65) || "community";
  const [community] = await db
    .insert(communitiesTable)
    .values({
      organizerId: organizer.id,
      slug: `${slugBase}-${randomBytes(3).toString("hex")}`,
      name: body.data.name.trim(),
      description: body.data.description.trim(),
      topics: body.data.topics.map((topic) => topic.trim()).filter(Boolean),
      city: body.data.city?.trim() || null,
    })
    .returning();
  const dto = await communityDto(community, userId);
  res.status(201).json(CreateCommunityResponse.parse(dto));
});

router.get("/communities/:slug", async (req, res): Promise<void> => {
  const params = GetCommunityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [community] = await db
    .select()
    .from(communitiesTable)
    .where(and(eq(communitiesTable.slug, params.data.slug), eq(communitiesTable.isPublic, true)))
    .limit(1);
  if (!community) {
    res.status(404).json({ error: "Community not found." });
    return;
  }
  const userId = currentUserId(req);
  const [communityInfo, eventRows] = await Promise.all([
    communityDto(community, userId),
    listJoinedEvents(
      and(
        eq(eventsTable.organizerId, community.organizerId),
        eq(eventsTable.status, "published"),
        gt(eventsTable.endAt, new Date()),
      )!,
    ),
  ]);
  const events = await toEventDtos(eventRows.slice(0, 16), userId);
  res.json(GetCommunityResponse.parse({ community: communityInfo, events }));
});

router.post("/communities/:communityId/join", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = JoinCommunityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to join a community." });
    return;
  }
  const [community] = await db
    .select({ id: communitiesTable.id })
    .from(communitiesTable)
    .where(and(eq(communitiesTable.id, params.data.communityId), eq(communitiesTable.isPublic, true)))
    .limit(1);
  if (!community) {
    res.status(404).json({ error: "Community not found." });
    return;
  }
  await db
    .insert(communityMembersTable)
    .values({ communityId: community.id, userId })
    .onConflictDoNothing();
  res.status(204).send();
});

router.delete("/communities/:communityId/join", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = JoinCommunityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to leave a community." });
    return;
  }
  await db
    .delete(communityMembersTable)
    .where(
      and(
        eq(communityMembersTable.communityId, params.data.communityId),
        eq(communityMembersTable.userId, userId),
      ),
    );
  res.status(204).send();
});

router.get("/me/preferences", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to view your preferences." });
    return;
  }
  const [row] = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, userId))
    .limit(1);
  res.json(
    GetMyPreferencesResponse.parse(
      row
        ? {
            interests: row.interests,
            homeCity: row.homeCity,
            preferredRadiusKm: row.preferredRadiusKm,
            showAttendanceBadges: row.showAttendanceBadges,
            profileVisibility: row.profileVisibility,
          }
        : {
            interests: [],
            homeCity: null,
            preferredRadiusKm: 25,
            showAttendanceBadges: true,
            profileVisibility: "private",
          },
    ),
  );
});

router.put("/me/preferences", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const body = UpdateMyPreferencesBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to save your preferences." });
    return;
  }
  const input = body.data;
  const [row] = await db
    .insert(userPreferencesTable)
    .values({
      userId,
      interests: input.interests.map((item) => item.trim()),
      homeCity: input.homeCity?.trim() || null,
      preferredRadiusKm: input.preferredRadiusKm,
      showAttendanceBadges: input.showAttendanceBadges,
      profileVisibility: input.profileVisibility,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userPreferencesTable.userId,
      set: {
        interests: input.interests.map((item) => item.trim()),
        homeCity: input.homeCity?.trim() || null,
        preferredRadiusKm: input.preferredRadiusKm,
        showAttendanceBadges: input.showAttendanceBadges,
        profileVisibility: input.profileVisibility,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json(
    UpdateMyPreferencesResponse.parse({
      interests: row.interests,
      homeCity: row.homeCity,
      preferredRadiusKm: row.preferredRadiusKm,
      showAttendanceBadges: row.showAttendanceBadges,
      profileVisibility: row.profileVisibility,
    }),
  );
});

router.get("/me/recommendations", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to view your recommendations." });
    return;
  }
  const [preferences, saved, followed] = await Promise.all([
    db
      .select()
      .from(userPreferencesTable)
      .where(eq(userPreferencesTable.userId, userId))
      .limit(1),
    db
      .select({ category: eventsTable.category })
      .from(savedEventsTable)
      .innerJoin(eventsTable, eq(savedEventsTable.eventId, eventsTable.id))
      .where(eq(savedEventsTable.userId, userId)),
    db
      .select({ organizerId: organizerFollowsTable.organizerId })
      .from(organizerFollowsTable)
      .where(eq(organizerFollowsTable.userId, userId)),
  ]);
  const interests = [...(preferences[0]?.interests ?? []), ...saved.map((item) => item.category)]
    .map((item) => item.toLowerCase());
  const followedIds = new Set(followed.map((item) => item.organizerId));
  const rows = await listJoinedEvents(
    and(eq(eventsTable.status, "published"), gt(eventsTable.endAt, new Date()))!,
  );
  const events = await toEventDtos(rows, userId);
  const city = preferences[0]?.homeCity?.toLowerCase();
  const ranked = events
    .map((event) => {
      const text = `${event.category} ${event.tags.join(" ")}`.toLowerCase();
      const interestScore = interests.reduce(
        (score, interest) => score + (text.includes(interest) ? 2 : 0),
        0,
      );
      const cityScore = city && event.city.toLowerCase().includes(city) ? 2 : 0;
      const followScore = followedIds.has(event.organizer.id) ? 4 : 0;
      const savedScore = event.isSaved ? -10 : 0;
      return { event, score: interestScore + cityScore + followScore + savedScore };
    })
    .sort((a, b) => b.score - a.score || a.event.startAt.getTime() - b.event.startAt.getTime())
    .slice(0, 12)
    .map(({ event }) => event);
  res.json(GetMyRecommendationsResponse.parse(ranked));
});

router.get("/me/notifications", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to view notifications." });
    return;
  }
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(
    GetMyNotificationsResponse.parse(
      rows.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        kind: row.kind,
        title: row.title,
        body: row.body,
        readAt: row.readAt,
        createdAt: row.createdAt,
      })),
    ),
  );
});

router.post("/me/notifications/:notificationId/read", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to update notifications." });
    return;
  }
  await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.id, params.data.notificationId),
        eq(notificationsTable.userId, userId),
      ),
    );
  res.status(204).send();
});

router.get("/me/badges", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to view attendance badges." });
    return;
  }
  const rows = await db
    .select({
      eventId: attendanceBadgesTable.eventId,
      eventTitle: eventsTable.title,
      issuedAt: attendanceBadgesTable.issuedAt,
    })
    .from(attendanceBadgesTable)
    .innerJoin(eventsTable, eq(attendanceBadgesTable.eventId, eventsTable.id))
    .where(eq(attendanceBadgesTable.userId, userId))
    .orderBy(desc(attendanceBadgesTable.issuedAt));
  res.json(GetMyAttendanceBadgesResponse.parse(rows));
});

export default router;
