import Markdown from "react-markdown"

export function SupportingMarkdown({ markdown }: { markdown: string }) {
  return (
    <section
      className="supporting-markdown"
      aria-label="Supporting information"
    >
      <Markdown skipHtml>{markdown}</Markdown>
    </section>
  )
}
