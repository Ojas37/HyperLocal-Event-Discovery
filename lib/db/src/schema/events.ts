import { createInsertSchema } from "drizzle-zod";
import {
  doublePrecision,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { organizersTable } from "./organizers";

export const eventsTable = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    organizerId: integer("organizer_id")
      .notNull()
      .references(() => organizersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    tags: text("tags").array().notNull().default([]),
    bannerUrl: text("banner_url").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    venue: text("venue").notNull(),
    city: text("city").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    mode: text("mode").notNull().default("in-person"),
    price: doublePrecision("price").notNull().default(0),
    currency: text("currency").notNull().default("INR"),
    capacity: integer("capacity"),
    registrationDeadline: timestamp("registration_deadline", { withTimezone: true }),
    externalUrl: text("external_url"),
    status: text("status").notNull().default("draft"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("events_start_at_idx").on(table.startAt),
    index("events_category_start_idx").on(table.category, table.startAt),
    index("events_organizer_idx").on(table.organizerId),
    index("events_city_idx").on(table.city),
  ],
);

export const insertEventSchema = createInsertSchema(eventsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof eventsTable.$inferSelect;
