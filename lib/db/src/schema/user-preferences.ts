import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const userPreferencesTable = pgTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  interests: text("interests").array().notNull().default([]),
  homeCity: text("home_city"),
  preferredRadiusKm: integer("preferred_radius_km").notNull().default(25),
  showAttendanceBadges: boolean("show_attendance_badges").notNull().default(true),
  profileVisibility: text("profile_visibility").notNull().default("private"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
