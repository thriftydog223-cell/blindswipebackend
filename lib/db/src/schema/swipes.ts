import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const swipesTable = pgTable(
  "swipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    swiperId: uuid("swiper_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    swipedId: uuid("swiped_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("swipes_swiper_swiped_idx").on(t.swiperId, t.swipedId)]
);

export type Swipe = typeof swipesTable.$inferSelect;
export type NewSwipe = typeof swipesTable.$inferInsert;
