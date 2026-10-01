import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createProbe, type Trace } from "./probe";

const mode = process.argv[2] ?? "strict";
if (!["strict", "wait", "continue", "timeout"].includes(mode))
  throw new Error("Mode must be strict, wait, continue, or timeout.");
const evidenceDir =
  process.env.SLOP_PROBE_EVIDENCE ?? "/tmp/slop-probe-evidence";
await mkdir(evidenceDir, { recursive: true });
const token = crypto.randomUUID();
const traces: Trace[] = [];
const probe = createProbe({
  token,
  legacy: mode !== "strict",
  trace: (event) => traces.push(event),
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 30,
  fetch: probe.fetch,
});
let browser;
try {
  let browserAnswer: unknown;
  let pendingAfterTimeout: unknown;
  const id = `probe-${mode}`;
  if (mode !== "strict") {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SLOP_CHROME_PATH,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(server.url.href);
    await page.locator("#credential").fill(token);
    await page.locator("#connect").click();
    // Separate Chrome page supplies the Response after observing the submitted Question.
    const answer = async () => {
      const card = page.locator(`article[data-question-id="${id}"]`);
      await card.waitFor({ timeout: 120000 });
      // Waiting mode holds MCP request; continue mode gives the model time to perform work.
      if (mode === "wait" || mode === "timeout") {
        const deadline = Date.now() + 120000;
        while (
          !traces.some((event) => event.phase === "wait-started") &&
          Date.now() < deadline
        )
          await Bun.sleep(25);
        if (!traces.some((event) => event.phase === "wait-started"))
          throw new Error("Codex did not start a wait");
      }
      if (mode === "timeout") {
        await Bun.sleep(1500);
        pendingAfterTimeout = await page.evaluate(async () => {
          const credential = (
            document.querySelector("#credential") as HTMLInputElement
          ).value;
          return await (
            await fetch("/questions", {
              headers: { Authorization: `Bearer ${credential}` },
            })
          ).json();
        });
        await Bun.sleep(1000);
      } else await Bun.sleep(mode === "continue" ? 2500 : 1000);
      await card.getByRole("button", { name: "yes", exact: true }).click();
      await page.waitForFunction(
        (questionId) =>
          document
            .querySelector(`article[data-question-id="${questionId}"]`)
            ?.textContent?.includes("answered (yes)"),
        id,
      );
      browserAnswer = {
        browser: browser!.version(),
        questionId: id,
        response: "yes",
        pageState: await card.textContent(),
      };
    };
    void answer().catch((error) => {
      browserAnswer = { error: String(error) };
    });
  }
  const instructions: Record<string, string> = {
    strict:
      "Attempt to use slop_probe submit_question with questionId probe-strict and wording Proceed? Report only whether the MCP server connected and the exact connection error if it did not. Do not use any other tools.",
    wait: `Use slop_probe submit_question with questionId ${id} and wording Proceed with waiting? Then use wait_for_response with the same questionId and waitMs 10000. Report the exact returned state and response. Do not use other tools.`,
    continue: `Use slop_probe submit_question with questionId ${id} and wording Proceed after independent work? After submission, do independent work: compute 17*19 and explain its arithmetic in one sentence, before consuming the response. Then call wait_for_response with this questionId and waitMs 10000 and report both the arithmetic and exact response. Do not use other tools.`,
    timeout: `Use slop_probe submit_question with questionId ${id} and wording Proceed after timeout? Then call wait_for_response with waitMs 20000. The tool request will time out after 1 second. Report the timeout and do not call more tools.`,
    reconnect: `Use slop_probe get_response for questionId probe-timeout. Report its exact state and response. Do not use other tools.`,
  };
  const command = [
    "codex",
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--json",
    "-s",
    "read-only",
    "-C",
    "/tmp",
    "-c",
    `mcp_servers.slop_probe.url="${server.url}mcp"`,
    "-c",
    'mcp_servers.slop_probe.bearer_token_env_var="SLOP_PROBE_TOKEN"',
    "-c",
    'mcp_servers.slop_probe.tools.submit_question.approval_mode="approve"',
    "-c",
    `mcp_servers.slop_probe.tool_timeout_sec=${mode === "timeout" ? 1 : 30}`,
    instructions[mode] ?? instructions.wait!,
  ];
  const child = Bun.spawn(command, {
    env: { ...process.env, SLOP_PROBE_TOKEN: token },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(child.stdout).text();
  const err = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  let reconnect: unknown;
  if (mode === "timeout") {
    await Bun.sleep(3000);
    const again = Bun.spawn(
      [...command.slice(0, -1), instructions.reconnect!],
      {
        env: { ...process.env, SLOP_PROBE_TOKEN: token },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    reconnect = {
      stdout: await new Response(again.stdout).text(),
      stderr: await new Response(again.stderr).text(),
      exitCode: await again.exited,
    };
  }
  const events = out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const completed = events
    .filter((event) => event.type === "item.completed")
    .map((event) => event.item);
  const checks =
    mode === "strict"
      ? {
          latestRejected: traces.some((event) => event.status === 400),
        }
      : {
          browserAnswered:
            !!browserAnswer && !(browserAnswer as { error?: string }).error,
          submitted: completed.some(
            (item) =>
              item.tool === "submit_question" &&
              item.result?.structured_content?.state === "pending",
          ),
          ...(mode === "timeout"
            ? {
                clientTimeout: completed.some(
                  (item) =>
                    item.tool === "wait_for_response" &&
                    item.error?.message?.includes("1000ms"),
                ),
                pendingAfterTimeout:
                  Array.isArray(pendingAfterTimeout) &&
                  pendingAfterTimeout[0]?.state === "pending",
                reconnected: (reconnect as { stdout?: string })?.stdout
                  ?.trim()
                  .split("\n")
                  .map((line) => JSON.parse(line))
                  .some(
                    (event) =>
                      event.item?.tool === "get_response" &&
                      event.item?.result?.structured_content?.state ===
                        "answered" &&
                      event.item?.result?.structured_content?.response ===
                        "yes",
                  ),
              }
            : {
                received: completed.some(
                  (item) =>
                    item.tool === "wait_for_response" &&
                    item.result?.structured_content?.response === "yes",
                ),
                ...(mode === "continue"
                  ? {
                      independentWork:
                        completed.findIndex(
                          (item) =>
                            item.type === "agent_message" &&
                            item.text?.includes("323"),
                        ) >= 0 &&
                        completed.findIndex(
                          (item) =>
                            item.type === "agent_message" &&
                            item.text?.includes("323"),
                        ) <
                          completed.findIndex(
                            (item) => item.tool === "wait_for_response",
                          ),
                    }
                  : {}),
              }),
        };
  const cliVersion = Bun.spawn(["codex", "--version"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const result = {
    mode,
    versions: {
      bun: Bun.version,
      sdkServer: (
        await Bun.file(
          "./node_modules/@modelcontextprotocol/server/package.json",
        ).json()
      ).version,
      sdkClient: (
        await Bun.file(
          "./node_modules/@modelcontextprotocol/client/package.json",
        ).json()
      ).version,
      codex: (await new Response(cliVersion.stdout).text()).trim(),
    },
    exitCode,
    checks,
    traces,
    browserAnswer,
    pendingAfterTimeout,
    stdout: out,
    stderr: err,
    reconnect,
  };
  await Bun.write(
    `${evidenceDir}/${mode}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  if (exitCode !== 0 || Object.values(checks).some((value) => !value))
    process.exitCode = 1;
} finally {
  await browser?.close();
  await probe.close();
  server.stop(true);
}
