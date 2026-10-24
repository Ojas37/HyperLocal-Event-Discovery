import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { eventsTable } from "./events";

export const eventReviewsTable = pgTable(
  "event_reviews",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    rating: integer("rating").notNull(),
    content: text("content").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("event_reviews_event_user_uidx").on(table.eventId, table.userId),
    index("event_reviews_event_idx").on(table.eventId),
  ],
);

export const attendanceBadgesTable = pgTable(
  "attendance_badges",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attendance_badges_event_user_uidx").on(table.eventId, table.userId),
    index("attendance_badges_user_idx").on(table.userId),
  ],
);
