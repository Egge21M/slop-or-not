import {
  integer,
  sqliteTable,
  text,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const inboxes = sqliteTable("inboxes", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
});
export const questions = sqliteTable(
  "questions",
  {
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    wording: text("wording").notNull(),
    project: text("project").notNull(),
    agentSession: text("agent_session").notNull(),
    supportingMarkdown: text("supporting_markdown"),
    createdAt: integer("created_at").notNull(),
    prio: integer("prio", { mode: "boolean" }).notNull().default(false),
    state: text("state", { enum: ["pending", "answered"] })
      .notNull()
      .default("pending"),
    response: text("response", { mode: "json" }).$type<
      import("@slop-or-not/shared").BinaryResponse
    >(),
    finishedAt: integer("finished_at"),
  },
  (table) => [primaryKey({ columns: [table.inboxId, table.questionId] })],
);
