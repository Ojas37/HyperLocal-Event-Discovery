import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { eventsTable } from "./events";

export const rsvpsTable = pgTable(
  "rsvps",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("confirmed"),
    registrationCode: text("registration_code").notNull().unique(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rsvps_event_user_uidx").on(table.eventId, table.userId),
    index("rsvps_event_status_idx").on(table.eventId, table.status),
    index("rsvps_user_idx").on(table.userId),
  ],
);

export const insertRsvpSchema = createInsertSchema(rsvpsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRsvp = z.infer<typeof insertRsvpSchema>;
export type Rsvp = typeof rsvpsTable.$inferSelect;
