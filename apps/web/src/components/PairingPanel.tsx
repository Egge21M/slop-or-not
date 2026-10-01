import { useState } from "react"
import { Button } from "./ui/button"
import { createInbox, fetchInbox } from "../lib/api"
export function PairingPanel({
  token,
  onPair,
}: {
  token: string | null
  onPair: (token: string) => void
}) {
  const [pasted, setPasted] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function pair(create: boolean) {
    setBusy(true)
    setError(null)
    try {
      const credential = create ? (await createInbox()).token : pasted.trim()
      if (!credential) throw new Error("Paste your saved credential.")
      await fetchInbox(credential)
      onPair(credential)
      setPasted("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pairing failed")
    } finally {
      setBusy(false)
    }
  }
  if (!token)
    return (
      <section className="panel space-y-5">
        <h2>Your phone, your Inbox</h2>
        <p>
          Create an Inbox, then share its credential with your coding agents.
        </p>
        <Button
          className="large-button w-full"
          disabled={busy}
          onClick={() => void pair(true)}
        >
          Create Inbox
        </Button>
        <div className="space-y-2">
          <label htmlFor="join-token">Join with a saved credential</label>
          <textarea
            id="join-token"
            autoComplete="off"
            spellCheck={false}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder="Paste shared credential"
          />
          <Button
            variant="outline"
            className="large-button w-full"
            disabled={busy || !pasted.trim()}
            onClick={() => void pair(false)}
          >
            Join Inbox
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
        <p className="small-note">
          No registration or recovery. Save your credential somewhere you can
          find it.
        </p>
      </section>
    )
  return (
    <details className="panel">
      <summary>Pair agents & save credential</summary>
      <div className="space-y-4 pt-4">
        <label htmlFor="mcp-endpoint">MCP endpoint</label>
        <input
          id="mcp-endpoint"
          readOnly
          value={`${window.location.origin}/mcp`}
        />
        <label htmlFor="shared-credential">Shared credential</label>
        <textarea
          id="shared-credential"
          readOnly
          autoComplete="off"
          spellCheck={false}
          value={token}
        />
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token)
              setError("Credential copied.")
            } catch {
              setError("Select the credential above to copy it.")
            }
          }}
        >
          Copy credential
        </Button>
        <p className="small-note">
          Stored in this browser. Anyone with this credential can read, ask, and
          answer Questions. Save another copy; there is no recovery.
        </p>
        <p className="small-note">
          Configure Codex with this endpoint and a bearer token environment
          variable. Another phone can join by pasting the credential.
        </p>
        {error && <p role="status">{error}</p>}
      </div>
    </details>
  )
}
