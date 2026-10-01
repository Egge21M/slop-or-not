import type { QuestionView } from "@slop-or-not/shared";
import { DomainError, type Store } from "./store";

// Only delivery resources live here. Every observation reads durable application
// state; no SQLite transaction remains open while awaiting the human.
export function waitForResponse(
  store: Store,
  inboxId: string,
  questionId: string,
  waitMs: number,
  signal: AbortSignal,
): Promise<QuestionView> {
  const initial = store.get(inboxId, questionId);
  if (signal.aborted) return Promise.reject(signal.reason);
  if (initial.state !== "pending" || waitMs === 0) return Promise.resolve(initial);
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    let unsubscribeClose = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (question?: QuestionView, error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      unsubscribeClose();
      signal.removeEventListener("abort", abort);
      if (question) resolve(question);
      else reject(error);
    };
    const abort = () => finish(undefined, signal.reason);
    const observe = (deadline = false) => {
      try {
        const question = store.get(inboxId, questionId);
        if (deadline || question.state !== "pending") finish(question);
      } catch (error) { finish(undefined, error); }
    };
    try {
      unsubscribe = store.subscribe(inboxId, () => observe());
      unsubscribeClose = store.onClose(() =>
        finish(undefined, new DomainError(503, "Server unavailable; reconnect with the original Question ID")));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => observe(true), waitMs);
      // Close the gap between the initial lookup and listener registration.
      if (signal.aborted) abort();
      else observe();
    } catch (error) { finish(undefined, error); }
  });
}
