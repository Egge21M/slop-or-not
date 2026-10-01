import { useCallback, useEffect, useRef, useState } from "react"
import type { InboxSnapshot, ResponseHistory } from "@slop-or-not/shared"
import { ApiError, fetchInbox, fetchHistory } from "./api"
export const credentialKey = "slop-or-not:credential"
export function useInbox(token: string | null, onUnavailable: () => void) {
  const [snapshot, setSnapshot] = useState<InboxSnapshot | null>(null)
  const [history, setHistory] = useState<ResponseHistory | null>(null)
  const [activeQuestionId, selectQuestion] = useState<string | null>(null)
  const [connection, setConnection] = useState("Connecting…")
  const [error, setError] = useState<string | null>(null)
  const currentToken = useRef(token)
  currentToken.current = token
  const unavailable = useRef(onUnavailable)
  unavailable.current = onUnavailable
  const reconcile = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return
      const [next, responses] = await Promise.all([
        fetchInbox(token, signal), fetchHistory(token, signal),
      ])
      if (signal?.aborted || currentToken.current !== token) return
      setSnapshot(next)
      setHistory(responses)
      selectQuestion((current) =>
        next.questions.some((question) => question.questionId === current)
          ? current
          : (next.questions[0]?.questionId ?? null)
      )
      setError(null)
    },
    [token]
  )
  useEffect(() => {
    setSnapshot(null)
    setHistory(null)
    selectQuestion(null)
    if (!token) return
    const controller = new AbortController()
    const signal = controller.signal
    let retry = 500
    async function connect() {
      while (!signal.aborted) {
        try {
          setConnection("Connecting…")
          await reconcile(signal)
          const response = await fetch("/api/events", {
            headers: { authorization: `Bearer ${token}` },
            signal,
          })
          if (!response.ok)
            throw new ApiError(response.status, "Live connection unavailable")
          if (!response.body) throw new Error("Live connection unavailable")
          setConnection("Live while open")
          retry = 500
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""
          try {
            while (!signal.aborted) {
              const chunk = await reader.read()
              if (chunk.done) break
              buffer += decoder.decode(chunk.value, { stream: true })
              let boundary: number
              while ((boundary = buffer.indexOf("\n\n")) !== -1) {
                const event = buffer.slice(0, boundary)
                buffer = buffer.slice(boundary + 2)
                if (event.includes("event: changed") || event.includes("event: unavailable"))
                  await reconcile(signal)
              }
            }
          } finally {
            await reader.cancel().catch(() => {})
            reader.releaseLock()
          }
        } catch (cause) {
          if (signal.aborted) break
          if (cause instanceof ApiError && cause.status === 401) {
            unavailable.current()
            break
          }
          setError("Connection lost. Your Inbox will refresh when connected.")
        }
        if (signal.aborted) break
        setConnection("Reconnecting…")
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer)
            signal.removeEventListener("abort", finish)
            resolve()
          }
          const timer = setTimeout(finish, retry)
          signal.addEventListener("abort", finish, { once: true })
        })
        retry = Math.min(retry * 2, 10000)
      }
    }
    void connect()
    return () => controller.abort()
  }, [token, reconcile])
  const activeQuestion =
    snapshot?.questions.find(
      (question) => question.questionId === activeQuestionId
    ) ?? null
  return {
    snapshot,
    history,
    activeQuestion,
    activeQuestionId,
    selectQuestion,
    connection,
    error,
    reconcile,
  }
}
