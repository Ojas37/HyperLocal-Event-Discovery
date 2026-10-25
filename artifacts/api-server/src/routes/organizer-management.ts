import { and, asc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AssignEventStaffBody,
  AssignEventStaffParams,
  AssignEventStaffResponse,
  CancelOrganizerEventParams,
  CancelOrganizerEventResponse,
  CheckInAttendeeBody,
  CheckInAttendeeParams,
  CheckInAttendeeResponse,
  ExportOrganizerRegistrationsParams,
  GetOrganizerAttendeesParams,
  GetOrganizerAttendeesResponse,
  GetOrganizerEventParams,
  GetOrganizerEventResponse,
  ListEventStaffParams,
  ListEventStaffResponse,
  RemoveEventStaffParams,
  RequestOrganizerVerificationResponse,
  UpdateOrganizerEventBody,
  UpdateOrganizerEventParams,
  UpdateOrganizerEventResponse,
} from "@workspace/api-zod";
import {
  attendanceBadgesTable,
  db,
  eventStaffTable,
  eventsTable,
  notificationsTable,
  organizersTable,
  rsvpsTable,
} from "@workspace/db";
import { currentUserId, findEventOwner, ownsEvent, canManageEvent } from "../lib/authz";
import { notifyActiveEventAttendees } from "../lib/notifications";
import { listJoinedEvents, toEventDtos } from "./events";

const router: IRouter = Router();

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

router.patch("/organizer/events/:eventId", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = UpdateOrganizerEventParams.safeParse(req.params);
  const body = UpdateOrganizerEventBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "The event details are invalid." });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to edit this event." });
    return;
  }
  const owner = await findEventOwner(params.data.eventId);
  if (!owner) {
    res.status(404).json({ error: "Event not found." });
    return;
  }
  if (owner.ownerId !== userId) {
    res.status(403).json({ error: "Only this event's organizer can edit it." });
    return;
  }
  const input = body.data;
  if (input.endAt <= input.startAt) {
    res.status(400).json({ error: "The end time must be after the start time." });
    return;
  }
  if (
    !Number.isFinite(input.latitude ?? 0) ||
    !Number.isFinite(input.longitude ?? 0) ||
    (input.latitude !== null && (input.latitude < -90 || input.latitude > 90)) ||
    (input.longitude !== null && (input.longitude < -180 || input.longitude > 180))
  ) {
    res.status(400).json({ error: "Enter valid map coordinates or leave both blank." });
    return;
  }
  if ((input.latitude === null) !== (input.longitude === null)) {
    res.status(400).json({ error: "Latitude and longitude must both be set or both be blank." });
    return;
  }
  const [updated] = await db
    .update(eventsTable)
    .set({
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category.trim(),
      tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
      bannerUrl: input.bannerUrl.trim(),
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      venue: input.venue.trim(),
      city: input.city.trim(),
      latitude: input.latitude,
      longitude: input.longitude,
      mode: input.mode,
      price: input.price,
      currency: input.currency.toUpperCase(),
      capacity: input.capacity,
      registrationDeadline: input.registrationDeadline,
      externalUrl: input.externalUrl,
      updatedAt: new Date(),
    })
    .where(eq(eventsTable.id, params.data.eventId))
    .returning();
  if (owner.status === "published") {
    await notifyActiveEventAttendees(
      updated.id,
      "event_updated",
      "Event details changed",
      `${updated.title} has new event details. Check the listing before you go.`,
    );
  }
  const [row] = await listJoinedEvents(eq(eventsTable.id, updated.id));
  const [eventDto] = await toEventDtos([row], userId);
  res.json(UpdateOrganizerEventResponse.parse(eventDto));
});

router.get("/organizer/events/:eventId", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = GetOrganizerEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to edit this event." });
    return;
  }
  if (!(await ownsEvent(params.data.eventId, userId))) {
    const event = await findEventOwner(params.data.eventId);
    res.status(event ? 403 : 404).json({ error: event ? "Event owner access is required." : "Event not found." });
    return;
  }
  const [row] = await listJoinedEvents(eq(eventsTable.id, params.data.eventId));
  const [event] = await toEventDtos([row], userId);
  res.json(GetOrganizerEventResponse.parse(event));
});

router.post("/organizer/events/:eventId/cancel", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = CancelOrganizerEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to cancel this event." });
    return;
  }
  const owner = await findEventOwner(params.data.eventId);
  if (!owner) {
    res.status(404).json({ error: "Event not found." });
    return;
  }
  if (owner.ownerId !== userId) {
    res.status(403).json({ error: "Only this event's organizer can cancel it." });
    return;
  }
  const [cancelled] = await db
    .update(eventsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(eventsTable.id, owner.id))
    .returning();
  await notifyActiveEventAttendees(
    cancelled.id,
    "event_cancelled",
    "Event cancelled",
    `${cancelled.title} has been cancelled by the organizer.`,
  );
  const [row] = await listJoinedEvents(eq(eventsTable.id, cancelled.id));
  const [eventDto] = await toEventDtos([row], userId);
  res.json(CancelOrganizerEventResponse.parse(eventDto));
});

router.get("/organizer/events/:eventId/attendees", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = GetOrganizerAttendeesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to view the attendee roster." });
    return;
  }
  const event = await findEventOwner(params.data.eventId);
  if (!event) {
    res.status(404).json({ error: "Event not found." });
    return;
  }
  if (!(await canManageEvent(params.data.eventId, userId))) {
    res.status(403).json({ error: "Event owner or assigned check-in staff access is required." });
    return;
  }
  const rows = await db
    .select()
    .from(rsvpsTable)
    .where(eq(rsvpsTable.eventId, params.data.eventId))
    .orderBy(asc(rsvpsTable.createdAt), asc(rsvpsTable.id));
  const registeredCount = rows.filter((row) => row.status === "confirmed").length;
  const checkedInCount = rows.filter(
    (row) => row.status === "confirmed" && row.checkedInAt !== null,
  ).length;
  res.json(
    GetOrganizerAttendeesResponse.parse({
      eventId: params.data.eventId,
      attendees: rows.map((row) => ({
        id: row.id,
        attendeeRef: `Attendee ${String(row.id).padStart(4, "0")}`,
        status: row.status,
        registrationCode: row.status === "confirmed" ? row.registrationCode : "",
        checkedInAt: row.checkedInAt,
        registeredAt: row.createdAt,
      })),
      registeredCount,
      checkedInCount,
      attendanceRate: registeredCount ? (checkedInCount / registeredCount) * 100 : 0,
    }),
  );
});

router.post("/organizer/events/:eventId/check-ins", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = CheckInAttendeeParams.safeParse(req.params);
  const body = CheckInAttendeeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter a valid event and registration code." });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to check in attendees." });
    return;
  }
  if (!(await canManageEvent(params.data.eventId, userId))) {
    res.status(403).json({ error: "Event owner or assigned check-in staff access is required." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [event] = await tx
      .select({ id: eventsTable.id, status: eventsTable.status })
      .from(eventsTable)
      .where(eq(eventsTable.id, params.data.eventId))
      .limit(1)
      .for("update");
    if (!event) return { kind: "event_missing" as const };
    if (event.status !== "published") return { kind: "event_inactive" as const };
    const [rsvp] = await tx
      .select()
      .from(rsvpsTable)
      .where(
        and(
          eq(rsvpsTable.eventId, params.data.eventId),
          eq(rsvpsTable.registrationCode, body.data.registrationCode),
        ),
      )
      .limit(1)
      .for("update");
    if (!rsvp) return { kind: "ticket_missing" as const };
    if (rsvp.status !== "confirmed") return { kind: "ticket_ineligible" as const };
    if (rsvp.checkedInAt) return { kind: "already" as const, rsvp };
    const now = new Date();
    const [checked] = await tx
      .update(rsvpsTable)
      .set({ checkedInAt: now })
      .where(and(eq(rsvpsTable.id, rsvp.id), isNull(rsvpsTable.checkedInAt)))
      .returning();
    if (!checked) return { kind: "already" as const, rsvp };
    await tx
      .insert(attendanceBadgesTable)
      .values({ userId: checked.userId, eventId: checked.eventId })
      .onConflictDoNothing();
    await tx.insert(notificationsTable).values({
      userId: checked.userId,
      eventId: checked.eventId,
      kind: "attendance_verified",
      title: "Attendance confirmed",
      body: "Your attendance has been verified and your badge is ready.",
    });
    return { kind: "checked" as const, rsvp: checked };
  });
  if (result.kind === "event_missing") {
    res.status(404).json({ error: "Event not found." });
    return;
  }
  if (result.kind === "ticket_missing") {
    res.status(404).json({ error: "That ticket does not belong to this event." });
    return;
  }
  if (result.kind === "event_inactive" || result.kind === "ticket_ineligible") {
    res.status(400).json({ error: "Only a confirmed registration for an active event can be checked in." });
    return;
  }
  const response = {
    rsvpId: result.rsvp.id,
    eventId: result.rsvp.eventId,
    attendeeRef: `Attendee ${String(result.rsvp.id).padStart(4, "0")}`,
    checkedInAt: result.rsvp.checkedInAt ?? new Date(),
    alreadyCheckedIn: result.kind === "already",
  };
  res.json(CheckInAttendeeResponse.parse(response));
});

router.get("/organizer/events/:eventId/staff", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = ListEventStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to manage event staff." });
    return;
  }
  if (!(await ownsEvent(params.data.eventId, userId))) {
    res.status(403).json({ error: "Only the event organizer can manage staff." });
    return;
  }
  const rows = await db
    .select()
    .from(eventStaffTable)
    .where(eq(eventStaffTable.eventId, params.data.eventId))
    .orderBy(asc(eventStaffTable.createdAt));
  res.json(
    ListEventStaffResponse.parse(
      rows.map((row) => ({ userId: row.userId, role: "check_in", assignedAt: row.createdAt })),
    ),
  );
});

router.post("/organizer/events/:eventId/staff", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = AssignEventStaffParams.safeParse(req.params);
  const body = AssignEventStaffBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter a valid event and Clerk user ID." });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to assign check-in staff." });
    return;
  }
  if (!(await ownsEvent(params.data.eventId, userId))) {
    res.status(403).json({ error: "Only the event organizer can assign staff." });
    return;
  }
  try {
    const [row] = await db
      .insert(eventStaffTable)
      .values({ eventId: params.data.eventId, userId: body.data.userId.trim(), assignedBy: userId })
      .returning();
    res.status(201).json(
      AssignEventStaffResponse.parse({
        userId: row.userId,
        role: "check_in",
        assignedAt: row.createdAt,
      }),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "That user is already assigned to this event." });
      return;
    }
    throw error;
  }
});

router.delete("/organizer/events/:eventId/staff/:userId", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = RemoveEventStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to remove event staff." });
    return;
  }
  if (!(await ownsEvent(params.data.eventId, userId))) {
    res.status(403).json({ error: "Only the event organizer can remove staff." });
    return;
  }
  await db
    .delete(eventStaffTable)
    .where(
      and(
        eq(eventStaffTable.eventId, params.data.eventId),
        eq(eventStaffTable.userId, params.data.userId),
      ),
    );
  res.status(204).send();
});

router.get("/organizer/events/:eventId/registrations.csv", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = ExportOrganizerRegistrationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to export registrations." });
    return;
  }
  if (!(await ownsEvent(params.data.eventId, userId))) {
    res.status(403).json({ error: "Only the event organizer can export registrations." });
    return;
  }
  const rows = await db
    .select()
    .from(rsvpsTable)
    .where(eq(rsvpsTable.eventId, params.data.eventId))
    .orderBy(asc(rsvpsTable.createdAt));
  const csv = [
    ["Attendee reference", "Status", "Registered at", "Checked in at"].map(csvCell).join(","),
    ...rows.map((row) =>
      [
        `Attendee ${String(row.id).padStart(4, "0")}`,
        row.status,
        row.createdAt.toISOString(),
        row.checkedInAt?.toISOString() ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
  res
    .status(200)
    .type("text/csv")
    .set("Content-Disposition", `attachment; filename="event-${params.data.eventId}-registrations.csv"`)
    .send(csv);
});

router.post("/organizer/verification", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to request organizer verification." });
    return;
  }
  const [organizer] = await db
    .select()
    .from(organizersTable)
    .where(eq(organizersTable.ownerId, userId))
    .limit(1);
  if (!organizer) {
    res.status(404).json({ error: "Organizer profile not found." });
    return;
  }
  const [updated] = await db
    .update(organizersTable)
    .set({
      verificationStatus: organizer.verificationStatus === "approved" ? "approved" : "pending",
      verificationRequestedAt: organizer.verificationStatus === "approved" ? organizer.verificationRequestedAt : new Date(),
    })
    .where(eq(organizersTable.id, organizer.id))
    .returning();
  res.json(RequestOrganizerVerificationResponse.parse({
    id: updated.id,
    name: updated.name,
    type: updated.type,
    description: updated.description,
    verified: updated.verified,
    verificationStatus: updated.verificationStatus,
  }));
});

export default router;
