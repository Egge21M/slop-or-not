import { useEffect, useRef, useState } from "react"
import type { QuestionView } from "@slop-or-not/shared"
import { Button } from "./ui/button"
import { sendBinary, undoBinary, ApiError } from "../lib/api"
import { useQuestionSwipe } from "../lib/useQuestionSwipe"
export function QuestionCard({
  question,
  token,
  onChanged,
  onUnavailable,
}: {
  question: QuestionView
  token: string
  onChanged: () => Promise<void>
  onUnavailable: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authoritative, setAuthoritative] = useState(question)
  const [now, setNow] = useState(Date.now)
  const unsent = useRef<{ value: "yes" | "no"; choiceId: string } | null>(null)
  useEffect(() => { setAuthoritative(question) }, [question])
  useEffect(() => {
    if (!authoritative.provisional) return
    let refreshed = false
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= authoritative.provisional!.deadline && !refreshed) {
        refreshed = true
        void onChanged().catch(() => {})
      }
    }, 100)
    return () => clearInterval(timer)
  }, [authoritative.provisional, onChanged])
  const remaining = authoritative.provisional
    ? Math.max(0, authoritative.provisional.deadline - now) : 0
  async function answer(value: "yes" | "no") {
    if (busy || authoritative.provisional || authoritative.state !== "pending") return
    // Keep a failed request's ID so retry cannot resurrect an undone choice.
    const command = unsent.current ?? { value, choiceId: crypto.randomUUID() }
    unsent.current = command
    setBusy(true)
    setError(null)
    try {
      const result = await sendBinary(token, question.questionId, command.value, command.choiceId)
      setAuthoritative(result)
      unsent.current = null
      await onChanged().catch(() => {
        setError("Server outcome acknowledged. Reconnecting to refresh the Inbox.")
      })
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnavailable()
        return
      }
      setError(
        "Choice unacknowledged and shown as unsent. Reconnect and retry to retrieve the server outcome."
      )
      try {
        await onChanged()
      } catch {
        /* Keep the unsent state visible while offline. */
      }
    } finally {
      setBusy(false)
    }
  }
  async function undo() {
    if (busy || !authoritative.provisional) return
    setBusy(true)
    setError(null)
    try {
      const result = await undoBinary(token, question.questionId, authoritative.provisional.choiceId)
      setAuthoritative(result)
      await onChanged().catch(() => {
        setError("Server outcome acknowledged. Reconnecting to refresh the Inbox.")
      })
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { onUnavailable(); return }
      setError("Undo unacknowledged. The stored deadline continues; reconnect to check the outcome.")
      try { await onChanged() } catch {}
    } finally { setBusy(false) }
  }
  const gestures = useQuestionSwipe({
    disabled: busy || !!authoritative.provisional || authoritative.state !== "pending" || !!unsent.current,
    onBinary: (value) => void answer(value),
  })
  return (
    <article
      {...gestures}
      style={{ touchAction: "pan-y" }}
      className="question-card panel space-y-6"
      aria-label="Question card"
    >
      <div className="identity">
        <span>{question.project}</span>
        <span>Agent session · {question.agentSession}</span>
      </div>
      <h2 className="question-wording">{question.wording}</h2>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          className="large-button"
          disabled={busy || !!authoritative.provisional || authoritative.state !== "pending" || !!unsent.current}
          onClick={() => void answer("no")}
        >
          No
        </Button>
        <Button
          className="large-button"
          disabled={busy || !!authoritative.provisional || authoritative.state !== "pending" || !!unsent.current}
          onClick={() => void answer("yes")}
        >
          Yes
        </Button>
      </div>
      {busy && <p role="status">{authoritative.provisional
        ? "Sending Undo… The stored deadline continues."
        : "Sending choice… Unsent until acknowledged."}</p>}
      {authoritative.provisional && (
        <div className="space-y-3" aria-live="polite">
          <p role="status">
            {authoritative.provisional.value === "yes" ? "Yes" : "No"} acknowledged. {remaining > 0
              ? `Provisional · Undo within ${(remaining / 1000).toFixed(1)} seconds.`
              : "Waiting for the server to confirm the final outcome…"}
          </p>
          <Button variant="outline" disabled={busy || remaining === 0} onClick={() => void undo()}>Undo</Button>
        </div>
      )}
      {authoritative.state === "answered" && <p role="status">
        {authoritative.response?.value === "yes" ? "Yes" : "No"} committed. Further answers cannot change it.
      </p>}
      {unsent.current && !busy && <Button onClick={() => void answer(unsent.current!.value)}>Retry unsent choice</Button>}
      {error && <p role="alert">{error}</p>}
    </article>
  )
}
