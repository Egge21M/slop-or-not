import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { and, asc, desc, eq, isNotNull, lte } from "drizzle-orm";
import { binaryChoices, inboxes, questions, questionMarkers } from "./schema";
import type {
  QuestionView,
  QuestionOutcome,
  SubmitQuestion,
  BinaryResponse,
  InboxSnapshot,
  ResponseHistory,
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
  const closeListeners = new Set<() => void>();
  let closed = false;
  const hasInbox = (id: string) =>
    !closed && !!db.select().from(inboxes).where(eq(inboxes.id, id)).get();
  const requireInbox = (id: string) => {
    if (!hasInbox(id)) throw new DomainError(401, "Inbox unavailable");
  };
  const scope = (inboxId: string, questionId: string) =>
    and(eq(questions.inboxId, inboxId), eq(questions.questionId, questionId));
  const markerScope = (inboxId: string, questionId: string) =>
    and(eq(questionMarkers.inboxId, inboxId), eq(questionMarkers.questionId, questionId));
  const expired = (inboxId: string, questionId: string): QuestionOutcome => {
    if (!db.select().from(questionMarkers).where(markerScope(inboxId, questionId)).get())
      throw new DomainError(404, "Question not found");
    return { questionId, state: "expired" };
  };
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
    provisional: row.provisional,
  });
  const get = (inboxId: string, questionId: string): QuestionOutcome => {
    requireInbox(inboxId);
    reconcileDeadlines();
    const row = db
      .select()
      .from(questions)
      .where(scope(inboxId, questionId))
      .get();
    if (!row) return expired(inboxId, questionId);
    return view(row);
  };
  const publish = (inboxId: string) => {
    for (const listener of listeners.get(inboxId) ?? [])
      listener({ type: "changed", inboxId });
  };
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const retentionMs = 7 * 24 * 60 * 60 * 1000;
  function scheduleDeadline() {
    clearTimeout(deadlineTimer);
    if (closed) return;
    const deadlines = db
      .select()
      .from(questions)
      .where(isNotNull(questions.provisional))
      .all()
      .map((row) => row.provisional!.deadline);
    for (const row of db.select({ finishedAt: questions.finishedAt }).from(questions)
      .where(isNotNull(questions.finishedAt)).all()) {
      deadlines.push(row.finishedAt! + retentionMs);
    }
    if (!deadlines.length) return;
    deadlineTimer = setTimeout(
      reconcileDeadlines,
      Math.max(1, Math.min(2_147_483_647, Math.min(...deadlines) - clock())),
    );
    deadlineTimer.unref();
  }
  function reconcileDeadlines() {
    if (closed) return;
    const now = clock();
    const changedInboxes = new Set<string>();
    db.transaction((tx) => {
      for (const row of tx
        .select()
        .from(questions)
        .where(isNotNull(questions.provisional))
        .all()) {
        const provisional = row.provisional!;
        if (row.state !== "pending" || provisional.deadline > now) continue;
        tx.update(questions)
          .set({
            state: "answered",
            provisional: null,
            finishedAt: now,
            response: {
              type: "binary",
              value: provisional.value,
              committedAt: now,
            },
          })
          .where(scope(row.inboxId, row.questionId))
          .run();
        changedInboxes.add(row.inboxId);
      }
      for (const row of tx.select().from(questions)
        .where(lte(questions.finishedAt, now - retentionMs)).all()) {
        tx.delete(binaryChoices).where(and(
          eq(binaryChoices.inboxId, row.inboxId),
          eq(binaryChoices.questionId, row.questionId),
        )).run();
        // Markers were backfilled by migration and are inserted with submissions.
        // Deleting the full row removes wording, metadata, Markdown and Response.
        tx.delete(questions).where(scope(row.inboxId, row.questionId)).run();
        changedInboxes.add(row.inboxId);
      }
    });
    scheduleDeadline();
    for (const inboxId of changedInboxes) publish(inboxId);
  }
  // Startup reconciles the persisted deadline before accepting any request.
  reconcileDeadlines();
  return {
    reconcileDeadlines,
    createInbox() {
      const id = crypto.randomUUID();
      db.insert(inboxes).values({ id, createdAt: clock() }).run();
      return id;
    },
    hasInbox,
    get,
    history(inboxId: string): ResponseHistory {
      requireInbox(inboxId);
      reconcileDeadlines();
      return {
        questions: db.select().from(questions)
          .where(and(eq(questions.inboxId, inboxId), eq(questions.state, "answered")))
          .orderBy(desc(questions.finishedAt), asc(questions.questionId))
          .all().map(view),
      };
    },
    snapshot(inboxId: string): InboxSnapshot {
      requireInbox(inboxId);
      reconcileDeadlines();
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
      reconcileDeadlines();
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
      const result = db.transaction((tx): QuestionOutcome => {
        const existing = tx
          .select()
          .from(questions)
          .where(scope(inboxId, input.questionId))
          .get();
        const marker = tx.select().from(questionMarkers)
          .where(markerScope(inboxId, input.questionId)).get();
        if (marker) {
          if (marker.fingerprint !== fingerprint)
            throw new DomainError(409, "Question content conflict");
          return existing ? view(existing) : { questionId: input.questionId, state: "expired" };
        }
        tx.insert(questionMarkers).values({ inboxId, questionId: input.questionId, fingerprint }).run();
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
      reconcileDeadlines();
      let changed = false;
      const result = db.transaction((tx) => {
        const row = tx
          .select()
          .from(questions)
          .where(scope(inboxId, questionId))
          .get();
        if (!row) return expired(inboxId, questionId);
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
      choiceId: string = crypto.randomUUID(),
    ) {
      requireInbox(inboxId);
      reconcileDeadlines();
      let changed = false;
      const result = db.transaction((tx) => {
        const row = tx
          .select()
          .from(questions)
          .where(scope(inboxId, questionId))
          .get();
        if (!row) return expired(inboxId, questionId);
        const receipt = tx
          .select()
          .from(binaryChoices)
          .where(
            and(
              eq(binaryChoices.inboxId, inboxId),
              eq(binaryChoices.questionId, questionId),
              eq(binaryChoices.choiceId, choiceId),
            ),
          )
          .get();
        if (receipt) return view(row);
        tx.insert(binaryChoices)
          .values({ inboxId, questionId, choiceId })
          .run();
        if (row.state !== "pending") return view(row);
        if (row.provisional) return view(row);
        const acknowledgedAt = clock();
        const updated = tx
          .update(questions)
          .set({
            provisional: {
              choiceId,
              value,
              acknowledgedAt,
              deadline: acknowledgedAt + 3000,
            },
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
      scheduleDeadline();
      return result;
    },
    undo(inboxId: string, questionId: string, choiceId: string) {
      requireInbox(inboxId);
      reconcileDeadlines();
      let changed = false;
      const result = db.transaction((tx) => {
        const row = tx
          .select()
          .from(questions)
          .where(scope(inboxId, questionId))
          .get();
        if (!row) return expired(inboxId, questionId);
        if (row.state !== "pending" || row.provisional?.choiceId !== choiceId)
          return view(row);
        const updated = tx
          .update(questions)
          .set({ provisional: null })
          .where(scope(inboxId, questionId))
          .returning()
          .get();
        changed = true;
        return view(updated);
      });
      scheduleDeadline();
      if (changed) publish(inboxId);
      return result;
    },
    respondCustom(inboxId: string, questionId: string, text: string) {
      requireInbox(inboxId);
      reconcileDeadlines();
      let changed = false;
      const result = db.transaction((tx) => {
        const row = tx
          .select()
          .from(questions)
          .where(scope(inboxId, questionId))
          .get();
        if (!row) return expired(inboxId, questionId);
        if (row.state !== "pending") return view(row);
        const committedAt = clock();
        const updated = tx
          .update(questions)
          .set({
            state: "answered",
            finishedAt: committedAt,
            response: { type: "custom", text, committedAt },
            provisional: null,
          })
          .where(
            and(scope(inboxId, questionId), eq(questions.state, "pending")),
          )
          .returning()
          .get();
        changed = true;
        return view(updated);
      });
      scheduleDeadline();
      if (changed) publish(inboxId);
      return result;
    },
    cancel(inboxId: string, questionId: string) {
      requireInbox(inboxId);
      reconcileDeadlines();
      let changed = false;
      const result = db.transaction((tx) => {
        const row = tx
          .select()
          .from(questions)
          .where(scope(inboxId, questionId))
          .get();
        if (!row) return expired(inboxId, questionId);
        if (row.state !== "pending") return view(row);
        const updated = tx
          .update(questions)
          .set({
            state: "cancelled",
            finishedAt: clock(),
            response: null,
            provisional: null,
          })
          .where(and(scope(inboxId, questionId), eq(questions.state, "pending")))
          .returning()
          .get();
        changed = true;
        return view(updated);
      });
      scheduleDeadline();
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
    onClose(listener: () => void) {
      if (closed) listener();
      else closeListeners.add(listener);
      return () => { closeListeners.delete(listener); };
    },
    close() {
      if (closed) return;
      closed = true;
      for (const listener of closeListeners) listener();
      closeListeners.clear();
      clearTimeout(deadlineTimer);
      listeners.clear();
      sqlite.close();
    },
  };
}
export type Store = ReturnType<typeof createStore>;
