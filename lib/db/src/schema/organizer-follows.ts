import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organizersTable } from "./organizers";

export const organizerFollowsTable = pgTable(
  "organizer_follows",
  {
    userId: text("user_id").notNull(),
    organizerId: integer("organizer_id")
      .notNull()
      .references(() => organizersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.organizerId], name: "organizer_follows_pk" }),
    index("organizer_follows_organizer_idx").on(table.organizerId),
  ],
);
