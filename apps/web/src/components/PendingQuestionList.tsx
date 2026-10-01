import type { QuestionView } from "@slop-or-not/shared"

export function PendingQuestionList({
  questions,
  activeQuestionId,
  onSelect,
}: {
  questions: QuestionView[]
  activeQuestionId: string | null
  onSelect: (questionId: string) => void
}) {
  if (!questions.length) return null
  return (
    <section className="panel space-y-4" aria-labelledby="pending-heading">
      <h2 id="pending-heading">Pending Questions</h2>
      <p className="small-note">Choose a Question to read. Your other Questions stay pending.</p>
      <ol className="space-y-3">
        {questions.map((question) => (
          <li key={question.questionId}>
            <button
              type="button"
              aria-pressed={question.questionId === activeQuestionId}
              className="w-full rounded-xl border border-border p-3 text-left aria-pressed:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => onSelect(question.questionId)}
            >
              <span className="identity">
                <span>{question.project}</span>
                <span>Agent session · {question.agentSession}</span>
              </span>
              <span className="mt-2 block whitespace-pre-wrap break-words">{question.wording}</span>
              {question.prio && <span className="eyebrow mt-2 block">Priority</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
