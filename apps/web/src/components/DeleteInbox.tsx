import { useState } from "react"
import { ApiError, deleteInbox } from "../lib/api"
import { Button } from "./ui/button"

export function DeleteInbox({ token, onDeleted, onUnavailable }: {
  token: string
  onDeleted: () => void
  onUnavailable: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function remove() {
    if (!window.confirm("Permanently delete this Inbox and all its Questions and Responses? Every paired device and agent will lose access. This cannot be recovered.")) return
    setBusy(true)
    setError(null)
    try {
      await deleteInbox(token)
      onDeleted()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onUnavailable()
      else setError(cause instanceof Error ? cause.message : "Deletion could not be confirmed. Try again when connected.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel space-y-3">
      <h2>Delete your Inbox</h2>
      <p>All Questions and Responses will be removed, and every saved credential for this Inbox will stop working. There is no recovery.</p>
      <Button variant="destructive" className="large-button" disabled={busy} onClick={() => void remove()}>
        {busy ? "Deleting…" : "Delete Inbox"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
