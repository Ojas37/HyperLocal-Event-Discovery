import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizersTable } from "./organizers";

export const communitiesTable = pgTable(
  "communities",
  {
    id: serial("id").primaryKey(),
    organizerId: integer("organizer_id")
      .notNull()
      .references(() => organizersTable.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    topics: text("topics").array().notNull().default([]),
    city: text("city"),
    isPublic: boolean("is_public").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("communities_city_idx").on(table.city)],
);

export const communityMembersTable = pgTable(
  "community_members",
  {
    communityId: integer("community_id")
      .notNull()
      .references(() => communitiesTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.communityId, table.userId], name: "community_members_pk" }),
    index("community_members_user_idx").on(table.userId),
  ],
);
