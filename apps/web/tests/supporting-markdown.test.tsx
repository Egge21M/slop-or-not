import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SupportingMarkdown } from "../src/components/SupportingMarkdown"

test("supporting Markdown renders reasoning and code while submitted HTML and unsafe URLs cannot execute", () => {
  const html = renderToStaticMarkup(
    <SupportingMarkdown
      markdown={
        '**Reasoning**\n\n```ts\nconst keep = true;\n```\n\n<script>window.evil = true</script>\n\n<img src=x onerror="evil()">\n\n[bad](javascript:alert(1))\n\n[safe](https://example.com)'
      }
    />
  )
  expect(html).toContain("<strong>Reasoning</strong>")
  expect(html).toContain('class="language-ts"')
  expect(html).toContain("const keep = true;")
  expect(html).not.toContain("<script")
  expect(html).not.toContain("onerror")
  expect(html).not.toContain("javascript:")
  expect(html).toContain('href="https://example.com"')
})
