import {
  binaryResponseSchema,
  customResponseSchema,
  type InboxSnapshot,
  type QuestionOutcome,
  type ResponseHistory,
  type ProvisionalBinary,
} from "@slop-or-not/shared"
const undoDeadlines = new WeakMap<ProvisionalBinary, number>()
// Browser-only monotonic estimates; SQLite decides whether Undo still wins.
export const getUndoDeadline = (choice: ProvisionalBinary) =>
  undoDeadlines.get(choice) ?? 0
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
export async function api<T>(
  path: string,
  token?: string,
  init: RequestInit = {}
): Promise<T> {
  const startedAt = performance.now()
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new ApiError(response.status, error.error ?? "Request failed")
  }
  const body = await response.json()
  const serverTime = Number(response.headers.get("x-slop-server-time"))
  if (response.headers.has("x-slop-server-time") && Number.isFinite(serverTime)) {
    // Charge the whole request duration against the server's remaining window.
    // Wall-clock skew and a delayed response cannot extend the stored deadline.
    const questions = Array.isArray(body.questions) ? body.questions : [body]
    for (const question of questions) {
      if (question.provisional) {
        undoDeadlines.set(
          question.provisional,
          startedAt + Math.max(0, question.provisional.deadline - serverTime)
        )
      }
    }
  }
  return body as T
}
export const createInbox = () =>
  api<{ inboxId: string; token: string }>("/api/inboxes", undefined, {
    method: "POST",
  })
export const fetchInbox = (token: string, signal?: AbortSignal) =>
  api<InboxSnapshot>("/api/inbox", token, { signal })
export const deleteInbox = (token: string) =>
  api<{ deleted: true }>("/api/inbox", token, { method: "DELETE" })
export const sendBinary = (
  token: string,
  questionId: string,
  value: "yes" | "no",
  choiceId: string
) =>
  api<QuestionOutcome>(`/api/questions/${questionId}/response`, token, {
    method: "POST",
    body: JSON.stringify(binaryResponseSchema.parse({ value, choiceId })),
  })
export const undoBinary = (token: string, questionId: string, choiceId: string) =>
  api<QuestionOutcome>(`/api/questions/${questionId}/undo`, token, {
    method: "POST", body: JSON.stringify({ choiceId }),
  })
export const sendCustom = (token: string, questionId: string, text: string) =>
  api<QuestionOutcome>(`/api/questions/${questionId}/custom-response`, token, {
    method: "POST",
    body: JSON.stringify(customResponseSchema.parse({ text })),
  })

export const fetchHistory = (token: string, signal?: AbortSignal) =>
  api<ResponseHistory>("/api/history", token, { signal })
