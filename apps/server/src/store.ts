import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { and, asc, desc, eq } from "drizzle-orm";
import { inboxes, questions } from "./schema";
import type {
  QuestionView,
  SubmitQuestion,
  BinaryResponse,
  InboxSnapshot,
} from "@slop-or-not/shared";

export class DomainError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export type InboxEvent = { type: "changed"; inboxId: string };
export function createStore(options: {
  databasePath: string;
  clock?: () => number;
  migrationsPath?: string;
}) {
  const sqlite = new Database(options.databasePath, {
    create: true,
    strict: true,
  });
  sqlite.exec(
    "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
  );
  const db = drizzle(sqlite);
  try {
    migrate(db, {
      migrationsFolder:
        options.migrationsPath ??
        new URL("../migrations", import.meta.url).pathname,
    });
  } catch (error) {
    sqlite.close();
    throw error;
  }
  const clock = options.clock ?? Date.now;
  const listeners = new Map<string, Set<(event: InboxEvent) => void>>();
  const hasInbox = (id: string) =>
    !!db.select().from(inboxes).where(eq(inboxes.id, id)).get();
  const requireInbox = (id: string) => {
    if (!hasInbox(id)) throw new DomainError(401, "Inbox unavailable");
  };
  const scope = (inboxId: string, questionId: string) =>
    and(eq(questions.inboxId, inboxId), eq(questions.questionId, questionId));
  const view = (row: typeof questions.$inferSelect): QuestionView => ({
    questionId: row.questionId,
    wording: row.wording,
    project: row.project,
    agentSession: row.agentSession,
    ...(row.supportingMarkdown !== null
      ? { supportingMarkdown: row.supportingMarkdown }
      : {}),
    createdAt: row.createdAt,
    prio: row.prio,
    state: row.state,
    response: row.response,
  });
  const get = (inboxId: string, questionId: string) => {
    requireInbox(inboxId);
    const row = db
      .select()
      .from(questions)
      .where(scope(inboxId, questionId))
      .get();
    if (!row) throw new DomainError(404, "Question not found");
    return view(row);
  };
  const publish = (inboxId: string) => {
    for (const listener of listeners.get(inboxId) ?? [])
      listener({ type: "changed", inboxId });
  };
  return {
    createInbox() {
      const id = crypto.randomUUID();
      db.insert(inboxes).values({ id, createdAt: clock() }).run();
      return id;
    },
    hasInbox,
    get,
    snapshot(inboxId: string): InboxSnapshot {
      requireInbox(inboxId);
      return {
        inboxId,
        questions: db
          .select()
          .from(questions)
          .where(
            and(eq(questions.inboxId, inboxId), eq(questions.state, "pending")),
          )
          .orderBy(
            desc(questions.prio),
            asc(questions.createdAt),
            asc(questions.questionId),
          )
          .all()
          .map(view),
      };
    },
    submit(inboxId: string, input: SubmitQuestion) {
      requireInbox(inboxId);
      const fingerprint = new Bun.CryptoHasher("sha256")
        .update(
          JSON.stringify([
            input.wording,
            input.project,
            input.agentSession,
            input.supportingMarkdown ?? null,
          ]),
        )
        .digest("hex");
      let changed = false;
      const result = db.transaction((tx) => {
        const existing = tx
          .select()
          .from(questions)
          .where(scope(inboxId, input.questionId))
          .get();
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new DomainError(409, "Question content conflict");
          return view(existing);
        }
        const inserted = tx
          .insert(questions)
          .values({ ...input, inboxId, fingerprint, createdAt: clock() })
          .returning()
          .get();
        changed = true;
        return view(inserted);
      });
      if (changed) publish(inboxId);
      return result;
    },
    prioritize(inboxId: string, questionId: string) {
      requireInbox(inboxId);
      let changed = false;
      const result = db.transaction((tx) => {
        const row = tx
          .select()
          .from(questions)
          .where(scope(inboxId, questionId))
          .get();
        if (!row) throw new DomainError(404, "Question not found");
        if (row.state !== "pending" || row.prio) return view(row);
        const updated = tx
          .update(questions)
          .set({ prio: true })
          .where(
            and(scope(inboxId, questionId), eq(questions.state, "pending")),
          )
          .returning()
          .get();
        changed = true;
        return view(updated);
      });
      if (changed) publish(inboxId);
      return result;
    },
    respond(
      inboxId: string,
      questionId: string,
      value: BinaryResponse["value"],
    ) {
      requireInbox(inboxId);
      let changed = false;
      const result = db.transaction((tx) => {
        const row = tx
          .select()
          .from(questions)
          .where(scope(inboxId, questionId))
          .get();
        if (!row) throw new DomainError(404, "Question not found");
        if (row.state !== "pending") return view(row);
        const committedAt = clock();
        const updated = tx
          .update(questions)
          .set({
            state: "answered",
            finishedAt: committedAt,
            response: { type: "binary", value, committedAt },
          })
          .where(
            and(scope(inboxId, questionId), eq(questions.state, "pending")),
          )
          .returning()
          .get();
        changed = true;
        return view(updated);
      });
      if (changed) publish(inboxId);
      return result;
    },
    subscribe(inboxId: string, listener: (event: InboxEvent) => void) {
      requireInbox(inboxId);
      const set = listeners.get(inboxId) ?? new Set();
      listeners.set(inboxId, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(inboxId);
      };
    },
    close() {
      listeners.clear();
      sqlite.close();
    },
  };
}
export type Store = ReturnType<typeof createStore>;
