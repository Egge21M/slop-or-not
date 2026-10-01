import { useState } from "react"
import type { QuestionView } from "@slop-or-not/shared"
import { Button } from "./ui/button"
import { sendBinary, ApiError } from "../lib/api"
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
  async function answer(value: "yes" | "no") {
    setBusy(true)
    setError(null)
    try {
      await sendBinary(token, question.questionId, value)
      await onChanged()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnavailable()
        return
      }
      setError(
        "Response unacknowledged. Reconnect and retry; the server preserves the first committed answer."
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
  return (
    <article
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
          disabled={busy}
          onClick={() => void answer("no")}
        >
          No
        </Button>
        <Button
          className="large-button"
          disabled={busy}
          onClick={() => void answer("yes")}
        >
          Yes
        </Button>
      </div>
      {busy && <p role="status">Sending Response…</p>}
      {error && <p role="alert">{error}</p>}
    </article>
  )
}
