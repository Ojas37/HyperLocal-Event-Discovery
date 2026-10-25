import { and, count, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AssignAdminRoleBody,
  AssignAdminRoleParams,
  AdminVerificationInput,
  GetAdminDashboardResponse,
  ListAdminVerificationsResponse,
  ListAdminReportsResponse,
  ResolveAdminReportBody,
  ResolveAdminReportParams,
  ResolveAdminReportResponse,
  ReviewOrganizerVerificationBody,
  ReviewOrganizerVerificationParams,
  ReviewOrganizerVerificationResponse,
  SuspendAdminUserBody,
  SuspendAdminUserParams,
  UnsuspendAdminUserParams,
} from "@workspace/api-zod";
import {
  accountSuspensionsTable,
  db,
  eventReportsTable,
  eventsTable,
  organizersTable,
  rsvpsTable,
  userRolesTable,
} from "@workspace/db";
import { currentUserId, isAdmin, isModerator } from "../lib/authz";
import { notifyActiveEventAttendees } from "../lib/notifications";

const router: IRouter = Router();

router.get("/admin/dashboard", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to access moderation." });
    return;
  }
  if (!(await isModerator(userId))) {
    res.status(403).json({ error: "Administrator or moderator access is required." });
    return;
  }
  const [openReports, pendingVerifications, suspendedUsers] = await Promise.all([
    db
      .select({ total: count() })
      .from(eventReportsTable)
      .where(eq(eventReportsTable.status, "open")),
    db
      .select({ total: count() })
      .from(organizersTable)
      .where(eq(organizersTable.verificationStatus, "pending")),
    db.select({ total: count() }).from(accountSuspensionsTable),
  ]);
  res.json(
    GetAdminDashboardResponse.parse({
      openReports: openReports[0]?.total ?? 0,
      pendingVerifications: pendingVerifications[0]?.total ?? 0,
      suspendedUsers: suspendedUsers[0]?.total ?? 0,
    }),
  );
});

router.get("/admin/reports", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to access moderation reports." });
    return;
  }
  if (!(await isModerator(userId))) {
    res.status(403).json({ error: "Administrator or moderator access is required." });
    return;
  }
  const rows = await db
    .select({
      report: eventReportsTable,
      eventTitle: eventsTable.title,
    })
    .from(eventReportsTable)
    .innerJoin(eventsTable, eq(eventReportsTable.eventId, eventsTable.id))
    .orderBy(eventReportsTable.createdAt);
  res.json(
    ListAdminReportsResponse.parse(
      rows.map(({ report, eventTitle }) => ({
        id: report.id,
        eventId: report.eventId,
        eventTitle,
        reporterId: report.reporterId,
        reason: report.reason,
        details: report.details,
        status: report.status,
        reviewedBy: report.reviewedBy,
        createdAt: report.createdAt,
      })),
    ),
  );
});

router.get("/admin/verifications", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to review organizer verification." });
    return;
  }
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }
  const rows = await db
    .select({
      id: organizersTable.id,
      name: organizersTable.name,
      type: organizersTable.type,
      description: organizersTable.description,
      requestedAt: organizersTable.verificationRequestedAt,
    })
    .from(organizersTable)
    .where(eq(organizersTable.verificationStatus, "pending"))
    .orderBy(organizersTable.verificationRequestedAt);
  res.json(ListAdminVerificationsResponse.parse(rows));
});

router.patch("/admin/reports/:reportId", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const params = ResolveAdminReportParams.safeParse(req.params);
  const body = ResolveAdminReportBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose a valid report action." });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Sign in to resolve reports." });
    return;
  }
  const admin = await isAdmin(userId);
  if (!(admin || (await isModerator(userId)))) {
    res.status(403).json({ error: "Administrator or moderator access is required." });
    return;
  }
  if (body.data.cancelEvent && !admin) {
    res.status(403).json({ error: "Only an administrator can cancel an event." });
    return;
  }
  const [report] = await db
    .select({
      id: eventReportsTable.id,
      eventId: eventReportsTable.eventId,
      reporterId: eventReportsTable.reporterId,
      reason: eventReportsTable.reason,
      details: eventReportsTable.details,
      createdAt: eventReportsTable.createdAt,
    })
    .from(eventReportsTable)
    .where(eq(eventReportsTable.id, params.data.reportId))
    .limit(1);
  if (!report) {
    res.status(404).json({ error: "Report not found." });
    return;
  }
  const [event] = await db
    .select({ title: eventsTable.title })
    .from(eventsTable)
    .where(eq(eventsTable.id, report.eventId))
    .limit(1);
  const [updated] = await db
    .update(eventReportsTable)
    .set({
      status: body.data.status,
      reviewedBy: userId,
      reviewedAt: new Date(),
    })
    .where(eq(eventReportsTable.id, report.id))
    .returning();
  if (body.data.cancelEvent) {
    const [cancelled] = await db
      .update(eventsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(eventsTable.id, report.eventId))
      .returning({ title: eventsTable.title });
    await notifyActiveEventAttendees(
      report.eventId,
      "event_cancelled",
      "Event removed",
      `${cancelled?.title ?? event?.title ?? "This event"} was cancelled after a moderation review.`,
    );
  }
  res.json(
    ResolveAdminReportResponse.parse({
      id: updated.id,
      eventId: updated.eventId,
      eventTitle: event?.title ?? "",
      reporterId: updated.reporterId,
      reason: updated.reason,
      details: updated.details,
      status: updated.status,
      reviewedBy: updated.reviewedBy,
      createdAt: updated.createdAt,
    }),
  );
});

router.post(
  "/admin/organizers/:organizerId/verification",
  async (req, res): Promise<void> => {
    const userId = currentUserId(req);
    const params = ReviewOrganizerVerificationParams.safeParse(req.params);
    const body = ReviewOrganizerVerificationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Choose an approval or rejection status." });
      return;
    }
    if (!userId) {
      res.status(401).json({ error: "Sign in to review organizer verification." });
      return;
    }
    if (!(await isAdmin(userId))) {
      res.status(403).json({ error: "Administrator access is required." });
      return;
    }
    const [organizer] = await db
      .update(organizersTable)
      .set({
        verificationStatus: body.data.status,
        verified: body.data.status === "approved",
        verificationReviewedAt: new Date(),
      })
      .where(eq(organizersTable.id, params.data.organizerId))
      .returning();
    if (!organizer) {
      res.status(404).json({ error: "Organizer not found." });
      return;
    }
    res.json(
      ReviewOrganizerVerificationResponse.parse({
        id: organizer.id,
        name: organizer.name,
        type: organizer.type,
        description: organizer.description,
        verified: organizer.verified,
        verificationStatus: organizer.verificationStatus,
      }),
    );
  },
);

router.post("/admin/users/:userId/suspension", async (req, res): Promise<void> => {
  const requesterId = currentUserId(req);
  const params = SuspendAdminUserParams.safeParse(req.params);
  const body = SuspendAdminUserBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Provide a valid user ID and suspension reason." });
    return;
  }
  if (!requesterId) {
    res.status(401).json({ error: "Sign in to suspend accounts." });
    return;
  }
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }
  if (params.data.userId === requesterId) {
    res.status(400).json({ error: "You cannot suspend your own account." });
    return;
  }
  await db
    .insert(accountSuspensionsTable)
    .values({
      userId: params.data.userId,
      reason: body.data.reason.trim(),
      suspendedBy: requesterId,
      suspendedAt: new Date(),
      expiresAt: null,
    })
    .onConflictDoUpdate({
      target: accountSuspensionsTable.userId,
      set: {
        reason: body.data.reason.trim(),
        suspendedBy: requesterId,
        suspendedAt: new Date(),
        expiresAt: null,
      },
    });
  res.status(204).send();
});

router.delete("/admin/users/:userId/suspension", async (req, res): Promise<void> => {
  const requesterId = currentUserId(req);
  const params = UnsuspendAdminUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!requesterId) {
    res.status(401).json({ error: "Sign in to restore accounts." });
    return;
  }
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }
  await db
    .delete(accountSuspensionsTable)
    .where(eq(accountSuspensionsTable.userId, params.data.userId));
  res.status(204).send();
});

router.put("/admin/users/:userId/role", async (req, res): Promise<void> => {
  const requesterId = currentUserId(req);
  const params = AssignAdminRoleParams.safeParse(req.params);
  const body = AssignAdminRoleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose whether to grant or remove the moderator role." });
    return;
  }
  if (!requesterId) {
    res.status(401).json({ error: "Sign in to manage roles." });
    return;
  }
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }
  if (params.data.userId === requesterId) {
    res.status(400).json({ error: "Use another administrator to change your own role." });
    return;
  }
  if (body.data.enabled) {
    await db
      .insert(userRolesTable)
      .values({
        userId: params.data.userId,
        role: body.data.role,
        assignedBy: requesterId,
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(userRolesTable)
      .where(
        and(
          eq(userRolesTable.userId, params.data.userId),
          eq(userRolesTable.role, body.data.role),
        ),
      );
  }
  res.status(204).send();
});

export default router;
