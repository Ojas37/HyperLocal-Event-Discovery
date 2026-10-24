import {
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { eventsTable } from "./events";

export const userRolesTable = pgTable(
  "user_roles",
  {
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    assignedBy: text("assigned_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role], name: "user_roles_pk" }),
    index("user_roles_role_idx").on(table.role),
  ],
);

export const eventStaffTable = pgTable(
  "event_staff",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("check_in"),
    assignedBy: text("assigned_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("event_staff_event_user_uidx").on(table.eventId, table.userId),
    index("event_staff_user_idx").on(table.userId),
  ],
);

export const accountSuspensionsTable = pgTable("account_suspensions", {
  userId: text("user_id").primaryKey(),
  reason: text("reason").notNull(),
  suspendedBy: text("suspended_by").notNull(),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});
