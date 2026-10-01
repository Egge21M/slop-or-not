import { useCallback, useState } from "react"
import { PairingPanel } from "./components/PairingPanel"
import { QuestionCard } from "./components/QuestionCard"
import { credentialKey, useInbox } from "./lib/useInbox"
function readCredential() {
  try {
    return localStorage.getItem(credentialKey)
  } catch {
    return null
  }
}
export default function App() {
  const [token, setToken] = useState<string | null>(readCredential)
  const [notice, setNotice] = useState<string | null>(null)
  const unavailable = useCallback(() => {
    try {
      localStorage.removeItem(credentialKey)
    } catch {}
    setToken(null)
    setNotice(
      "This Inbox is unavailable. Join with a valid saved credential or create another Inbox."
    )
  }, [])
  const inbox = useInbox(token, unavailable)
  function pair(credential: string) {
    try {
      localStorage.setItem(credentialKey, credential)
      setNotice(null)
    } catch {
      setNotice(
        "Browser storage is unavailable. Save the credential before closing this page."
      )
    }
    setToken(credential)
  }
  return (
    <main className="mx-auto max-w-xl space-y-6 px-5 py-8">
      <header>
        <p className="eyebrow">Human input for coding agents</p>
        <h1>Slop or Not</h1>
        <p className="subtitle">A little direction. Keep the work moving.</p>
      </header>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <PairingPanel token={token} onPair={pair} />
      {token && (
        <>
          <div className="flex justify-between text-sm">
            <span>{inbox.snapshot?.questions.length ?? 0} pending</span>
            <span role="status">{inbox.connection}</span>
          </div>
          {inbox.error && <p role="alert">{inbox.error}</p>}
          {inbox.activeQuestion ? (
            <QuestionCard
              key={inbox.activeQuestion.questionId}
              question={inbox.activeQuestion}
              token={token}
              onChanged={inbox.reconcile}
              onUnavailable={unavailable}
            />
          ) : (
            <section className="panel empty-state">
              <h2>
                {inbox.snapshot
                  ? "You're all caught up"
                  : "Opening your Inbox…"}
              </h2>
              <p>
                Questions from your agents appear here while this page is open.
              </p>
            </section>
          )}
        </>
      )}
      <footer className="small-note">
        Foreground updates only. Responses are final when delivered.
      </footer>
    </main>
  )
}
