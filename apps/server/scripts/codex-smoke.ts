// Optional live smoke: production app + real Codex + separate current Chrome.
// Install/choose Playwright separately; it is not a production dependency.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createApplication } from '../src/app';
const mode = process.argv[2] ?? 'wait';
if (!['wait', 'continue', 'timeout'].includes(mode)) throw new Error('Use wait, continue, or timeout');
const browserModule = process.env.SLOP_PLAYWRIGHT_MODULE;
if (!browserModule || !process.env.SLOP_CHROME_PATH) throw new Error('Set SLOP_PLAYWRIGHT_MODULE and SLOP_CHROME_PATH');
const { chromium } = await import(browserModule);
const directory = await mkdtemp('/tmp/slop-codex-wait-');
const options = { databasePath: `${directory}/inbox.sqlite`, jwtSecret: 'temporary-live-smoke-signing-secret-at-least-32-bytes' };
let app = createApplication(options);
const trace: { method?: string; tool?: string; revision?: string | null; offered?: string }[] = [];
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(request) {
  if (new URL(request.url).pathname === '/mcp' && request.method === 'POST') {
    const data = await request.clone().json() as { method?: string; params?: { name?: string; protocolVersion?: string } };
    trace.push({ method: data.method, tool: data.params?.name, revision: request.headers.get('MCP-Protocol-Version'), offered: data.params?.protocolVersion });
  }
  return app.fetch(request);
} });
const browser = await chromium.launch({ executablePath: process.env.SLOP_CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(server.url.href);
  await page.getByRole('button', { name: 'Create Inbox', exact: true }).click();
  await page.getByText('Pair agents & save credential', { exact: true }).waitFor();
  const token = await page.evaluate(() => localStorage.getItem('slop-or-not:credential')) as string;
  if (!token) throw new Error('Phone pairing failed');
  const questionId = Bun.randomUUIDv7();
  const submit = `Use slop_not submit_question with questionId ${questionId}, wording "Should we proceed after ${mode}?", project "production-smoke", and agentSession "${mode}".`;
  const prompts: Record<string, string> = {
    wait: `${submit} Then wait_for_response with this ID and waitMs 10000. Report the exact state and Response. Do not use other tools.`,
    continue: `${submit} After submission, produce a commentary sentence computing 17*19 and explaining its arithmetic before calling another tool. Then wait_for_response with this ID and waitMs 10000. Report exact state and Response. Do not use other tools.`,
    timeout: `${submit} Then wait_for_response with this ID and waitMs 20000. The client timeout is one second. Report the timeout and make no more calls.`,
  };
  async function run(prompt: string, timeout: number) {
    child = Bun.spawn(['codex', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--json', '-s', 'read-only', '-C', '/tmp', '-c', `mcp_servers.slop_not.url="${server.url}mcp"`, '-c', 'mcp_servers.slop_not.bearer_token_env_var="SLOP_SMOKE_TOKEN"', '-c', 'mcp_servers.slop_not.tools.submit_question.approval_mode="approve"', '-c', `mcp_servers.slop_not.tool_timeout_sec=${timeout}`, prompt], { env: { ...process.env, SLOP_SMOKE_TOKEN: token }, stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    const exitCode = await child.exited;
    return { stdout, stderr, exitCode };
  }
  const runResult = run(prompts[mode]!, mode === 'timeout' ? 1 : 30);
  await page.getByRole('heading', { name: `Should we proceed after ${mode}?`, exact: true }).waitFor({ timeout: 120000 });
  const deadline = Date.now() + 120000;
  while (!trace.some(entry => entry.tool === 'wait_for_response') && Date.now() < deadline) await Bun.sleep(25);
  if (!trace.some(entry => entry.tool === 'wait_for_response')) throw new Error('No active Codex wait');
  await Bun.sleep(mode === 'timeout' ? 1500 : 1000);
  let pendingAfterTimeout: unknown;
  if (mode === 'timeout') pendingAfterTimeout = await (await fetch(`${server.url}api/questions/${questionId}`, { headers: { authorization: `Bearer ${token}` } })).json();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('heading', { name: "You're all caught up", exact: true }).waitFor({ timeout: 10000 });
  const first = await runResult;
  let reconnect;
  if (mode === 'timeout') {
    await app.close();
    app = createApplication(options);
    reconnect = await run(`Use slop_not get_response for questionId ${questionId} twice. Report the exact outcome both times. Do not use other tools.`, 30);
  }
  const items = (output: string) => output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(event => event.type === 'item.completed').map(event => event.item);
  const completed = items(first.stdout);
  const outcome = (item: any) => item.result?.structured_content?.state === 'answered' && item.result?.structured_content?.response?.type === 'binary' && item.result?.structured_content?.response?.value === 'yes';
  const checks = {
    paired: true,
    submitted: completed.some(item => item.tool === 'submit_question' && item.result?.structured_content?.state === 'pending'),
    ...(mode === 'timeout' ? {
      timeout: completed.some(item => item.tool === 'wait_for_response' && item.error?.message?.includes('1000ms')),
      pendingAfterTimeout: (pendingAfterTimeout as { state?: string })?.state === 'pending',
      restartAndRepeatedRetrieval: items(reconnect!.stdout).filter(item => item.tool === 'get_response' && outcome(item)).length === 2,
    } : {
      consumed: completed.some(item => item.tool === 'wait_for_response' && outcome(item)),
      ...(mode === 'continue' ? { independentWork: completed.findIndex(item => item.type === 'agent_message' && item.text?.includes('323')) >= 0 && completed.findIndex(item => item.type === 'agent_message' && item.text?.includes('323')) < completed.findIndex(item => item.tool === 'wait_for_response') } : {}),
    }),
  };
  const evidenceDirectory = process.env.SLOP_SMOKE_EVIDENCE ?? '/tmp/slop-production-codex-evidence';
  await mkdir(evidenceDirectory, { recursive: true });
  const cli = Bun.spawn(['codex', '--version'], { stdout: 'pipe', stderr: 'ignore' });
  const evidence = { mode, versions: { bun: Bun.version, codex: (await new Response(cli.stdout).text()).trim(), chrome: browser.version(), sdk: '2.2.0' }, checks, trace, pendingAfterTimeout, first, reconnect };
  await Bun.write(`${evidenceDirectory}/${mode}.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ mode, checks, evidenceDirectory }));
  if (first.exitCode !== 0 || Object.values(checks).some(check => !check)) process.exitCode = 1;
} finally {
  child?.kill();
  await browser.close();
  server.stop(true);
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
