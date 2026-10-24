import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { eventsTable } from "./events";

export const savedEventsTable = pgTable(
  "saved_events",
  {
    userId: text("user_id").notNull(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.eventId] })],
);

export const insertSavedEventSchema = createInsertSchema(savedEventsTable);
export type InsertSavedEvent = z.infer<typeof insertSavedEventSchema>;
export type SavedEvent = typeof savedEventsTable.$inferSelect;
