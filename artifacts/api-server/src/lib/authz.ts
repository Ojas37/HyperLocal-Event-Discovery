import { and, eq } from "drizzle-orm";
import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { db, eventStaffTable, eventsTable, organizersTable, userRolesTable } from "@workspace/db";

export function currentUserId(req: Request) {
  return getAuth(req).userId ?? undefined;
}

function configuredAdmins() {
  return new Set(
    (process.env.LOCALOOP_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((userId) => userId.trim())
      .filter(Boolean),
  );
}

export async function hasRole(userId: string, role: string) {
  if (role === "admin" && configuredAdmins().has(userId)) return true;
  const [assignment] = await db
    .select({ userId: userRolesTable.userId })
    .from(userRolesTable)
    .where(and(eq(userRolesTable.userId, userId), eq(userRolesTable.role, role)))
    .limit(1);
  return Boolean(assignment);
}

export async function isAdmin(userId: string) {
  return hasRole(userId, "admin");
}

export async function isModerator(userId: string) {
  return (await isAdmin(userId)) || (await hasRole(userId, "moderator"));
}

export async function ownsEvent(eventId: number, userId: string) {
  const [event] = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .innerJoin(organizersTable, eq(eventsTable.organizerId, organizersTable.id))
    .where(and(eq(eventsTable.id, eventId), eq(organizersTable.ownerId, userId)))
    .limit(1);
  return Boolean(event);
}

export async function canManageEvent(eventId: number, userId: string) {
  if (await ownsEvent(eventId, userId)) return true;
  const [assignment] = await db
    .select({ id: eventStaffTable.id })
    .from(eventStaffTable)
    .where(and(eq(eventStaffTable.eventId, eventId), eq(eventStaffTable.userId, userId)))
    .limit(1);
  return Boolean(assignment);
}

export async function findEventOwner(eventId: number) {
  const [event] = await db
    .select({
      id: eventsTable.id,
      organizerId: eventsTable.organizerId,
      ownerId: organizersTable.ownerId,
      title: eventsTable.title,
      status: eventsTable.status,
    })
    .from(eventsTable)
    .innerJoin(organizersTable, eq(eventsTable.organizerId, organizersTable.id))
    .where(eq(eventsTable.id, eventId))
    .limit(1);
  return event;
}
