import type { Store } from "./store";
export function createPhoneEvents(store: Store) {
  const connections = new Set<() => void>();
  return {
    stream(inboxId: string, signal: AbortSignal) {
      let stop = () => {};
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          let stopped = false;
          const send = (data: string) => {
            if (!stopped) controller.enqueue(encoder.encode(data));
          };
          const unsubscribe = store.subscribe(inboxId, (event) => {
            if (event.type === "deleted") {
              send("event: unavailable\ndata: {}\n\n");
              stop();
            } else send("event: changed\ndata: {}\n\n");
          });
          const heartbeat = setInterval(() => send(": heartbeat\n\n"), 15000);
          stop = () => {
            if (stopped) return;
            stopped = true;
            clearInterval(heartbeat);
            unsubscribe();
            signal.removeEventListener("abort", stop);
            connections.delete(stop);
            if (!cancelled) controller.close();
          };
          connections.add(stop);
          signal.addEventListener("abort", stop, { once: true });
          send("event: changed\ndata: {}\n\n");
          if (signal.aborted) stop();
        },
        cancel() {
          cancelled = true;
          stop();
        },
      });
      return new Response(body, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
        },
      });
    },
    close() {
      for (const stop of [...connections]) stop();
    },
  };
}
