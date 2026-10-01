import { useRef, useState } from "react"
import { customResponseSchema } from "@slop-or-not/shared"
import { ApiError, sendCustom } from "../lib/api"
import { Button } from "./ui/button"

export function CustomComposer({
  questionId,
  token,
  onClose,
  onChanged,
  onUnavailable,
}: {
  questionId: string
  token: string
  onClose: () => void
  onChanged: () => Promise<void>
  onUnavailable: () => void
}) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)
  async function send() {
    if (sending.current || !customResponseSchema.safeParse({ text }).success)
      return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const outcome = await sendCustom(token, questionId, text)
      if (
        outcome.response?.type === "custom" &&
        outcome.response.text === text
      ) {
        onClose()
      } else {
        setError(
          "This text was not sent: the Question already has a final outcome."
        )
      }
      await onChanged()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnavailable()
        return
      }
      setError(
        "Custom answer unacknowledged. Your text is unsent here; reconnect and retry to check the server's outcome."
      )
      try {
        await onChanged()
      } catch {
        /* Keep the draft and unacknowledged state visible while offline. */
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-3"
      aria-label="Custom answer composer"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <label htmlFor="custom-answer">Custom answer</label>
      <textarea
        id="custom-answer"
        autoFocus
        maxLength={32000}
        value={text}
        disabled={busy}
        placeholder="Yes, but…"
        onChange={(event) => setText(event.target.value)}
      />
      <p className="small-note">
        Send commits your exact text. Custom answers have no Undo window.
      </p>
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          Close
        </Button>
        <Button
          type="submit"
          disabled={busy || !customResponseSchema.safeParse({ text }).success}
        >
          Send
        </Button>
      </div>
      {busy && <p role="status">Sending Custom answer…</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
