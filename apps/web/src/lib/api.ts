import {
  binaryResponseSchema,
  customResponseSchema,
  type InboxSnapshot,
  type QuestionView,
} from "@slop-or-not/shared"
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
  return response.json() as Promise<T>
}
export const createInbox = () =>
  api<{ inboxId: string; token: string }>("/api/inboxes", undefined, {
    method: "POST",
  })
export const fetchInbox = (token: string, signal?: AbortSignal) =>
  api<InboxSnapshot>("/api/inbox", token, { signal })
export const sendBinary = (
  token: string,
  questionId: string,
  value: "yes" | "no",
  choiceId: string
) =>
  api<QuestionView>(`/api/questions/${questionId}/response`, token, {
    method: "POST",
    body: JSON.stringify(binaryResponseSchema.parse({ value, choiceId })),
  })
export const undoBinary = (token: string, questionId: string, choiceId: string) =>
  api<QuestionView>(`/api/questions/${questionId}/undo`, token, {
    method: "POST", body: JSON.stringify({ choiceId }),
  })
export const sendCustom = (token: string, questionId: string, text: string) =>
  api<QuestionView>(`/api/questions/${questionId}/custom-response`, token, {
    method: "POST",
    body: JSON.stringify(customResponseSchema.parse({ text })),
  })
