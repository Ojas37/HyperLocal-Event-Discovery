import { and, eq, inArray } from "drizzle-orm";
import { db, notificationsTable, rsvpsTable } from "@workspace/db";

export async function notifyActiveEventAttendees(
  eventId: number,
  kind: string,
  title: string,
  body: string,
) {
  const rows = await db
    .select({ userId: rsvpsTable.userId })
    .from(rsvpsTable)
    .where(
      and(
        eq(rsvpsTable.eventId, eventId),
        inArray(rsvpsTable.status, ["confirmed", "waitlisted"]),
      ),
    );
  const recipients = [...new Set(rows.map((row) => row.userId))];
  if (!recipients.length) return;
  await db.insert(notificationsTable).values(
    recipients.map((userId) => ({ userId, eventId, kind, title, body })),
  );
}
