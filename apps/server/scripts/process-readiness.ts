// A pipe chunk is not a log line: startup diagnostics and split writes are valid.
export async function listeningPort(child: {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}, timeoutMs = 5000): Promise<string> {
  const stdout = child.stdout.getReader();
  const stderr = child.stderr.getReader();
  let output = "";
  let diagnostics = "";
  const captureStderr = (async () => {
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await stderr.read();
      if (chunk.done) return;
      diagnostics += decoder.decode(chunk.value, { stream: true });
    }
  })();
  const failure = (reason: string) => new Error(
    `${reason}\nstdout: ${output || "(empty)"}\nstderr: ${diagnostics || "(empty)"}`,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const decoder = new TextDecoder();
        while (true) {
          const chunk = await stdout.read();
          if (chunk.done) {
            const code = await child.exited;
            await captureStderr;
            throw failure(`Server exited before listening (exit ${code})`);
          }
          output += decoder.decode(chunk.value, { stream: true });
          // Wait for the newline so a partially received port cannot win.
          const port = output.match(/Slop or Not listening on port (\d+)\r?\n/)?.[1];
          if (port) return port;
        }
      })(),
      child.exited.then(async (code) => {
        await captureStderr;
        throw failure(`Server exited before listening (exit ${code})`);
      }),
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(failure(`Server did not listen within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await Promise.all([stdout.cancel(), stderr.cancel()]);
    await captureStderr;
  }
}
