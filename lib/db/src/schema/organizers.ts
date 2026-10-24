import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const organizersTable = pgTable("organizers", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull().default("community"),
  description: text("description").notNull().default(""),
  verified: boolean("verified").notNull().default(false),
  verificationStatus: text("verification_status").notNull().default("not_requested"),
  verificationRequestedAt: timestamp("verification_requested_at", { withTimezone: true }),
  verificationReviewedAt: timestamp("verification_reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrganizerSchema = createInsertSchema(organizersTable).omit({
  id: true,
  verified: true,
  createdAt: true,
});
export type InsertOrganizer = z.infer<typeof insertOrganizerSchema>;
export type Organizer = typeof organizersTable.$inferSelect;
