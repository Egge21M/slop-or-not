import type { ResponseHistory as History } from "@slop-or-not/shared"
import { SupportingMarkdown } from "./SupportingMarkdown"

export function ResponseHistory({ history }: { history: History | null }) {
  return (
    <details className="panel space-y-4">
      <summary>Response history ({history?.questions.length ?? 0})</summary>
      <p className="small-note">
        Committed Responses are read-only. Finished content is removed after seven days.
      </p>
      {!history ? <p>Loading Response history…</p> : history.questions.length === 0 ? (
        <p>No retained Responses.</p>
      ) : history.questions.map((question) => (
        <article key={question.questionId} className="space-y-3 border-t pt-4" aria-label="History Response">
          <div className="identity">
            <span>{question.project}</span>
            <span>Agent session · {question.agentSession}</span>
          </div>
          <h3 className="break-words">{question.wording}</h3>
          {question.supportingMarkdown !== undefined && <SupportingMarkdown markdown={question.supportingMarkdown} />}
          {question.response?.type === "custom" ? (
            <p className="break-words whitespace-pre-wrap">Custom answer: {question.response.text}</p>
          ) : (
            <p>Response: {question.response?.type === "binary" && question.response.value === "yes" ? "Yes" : "No"}</p>
          )}
          <p className="small-note">
            Question created: <time dateTime={new Date(question.createdAt).toISOString()}>{new Date(question.createdAt).toLocaleString()}</time>
            <br />
            Response committed: <time dateTime={new Date(question.response!.committedAt).toISOString()}>{new Date(question.response!.committedAt).toLocaleString()}</time>
          </p>
        </article>
      ))}
    </details>
  )
}
