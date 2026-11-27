import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OpenAICompatibleProvider, TimeoutError } from "../core/model/openai-compatible";

let server: Server | undefined;
afterEach(() => server?.close());

/** A local endpoint whose /chat/completions does what `handler` says. */
async function endpoint(handler: (res: import("node:http").ServerResponse, n: number) => void): Promise<string> {
  let n = 0;
  server = createServer((_req, res) => handler(res, ++n));
  await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`;
}

const chunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

describe("a model call that stalls", () => {
  it("gives up on a reply that stops streaming, and does not make it again once part of it arrived", async () => {
    let calls = 0;
    const url = await endpoint((res) => {
      calls++;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk("partial"));
      // …and then nothing, forever.
    });
    const p = new OpenAICompatibleProvider("Slow", url, "", { idleTimeoutMs: 150, retries: 2, backoffMs: 1 });
    const err = await p.chat({ model: "m", messages: [{ role: "user", content: "hi" }], onDelta: () => undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(String((err as Error).message)).toMatch(/stalled/);
    expect(calls).toBe(1);
  });

  it("gives up on a call that never answers within the limit, and does not make it again", async () => {
    let calls = 0;
    const url = await endpoint(() => {
      calls++; // never answers
    });
    const p = new OpenAICompatibleProvider("Silent", url, "", { callTimeoutMs: 150, retries: 1, backoffMs: 1 });
    const err = await p.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(calls).toBe(1);
  });

  it("lets a reply that keeps streaming finish, however long it takes overall", async () => {
    const url = await endpoint((res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      let i = 0;
      const t = setInterval(() => {
        res.write(chunk(String(i)));
        if (++i === 6) {
          clearInterval(t);
          res.end("data: [DONE]\n\n");
        }
      }, 60);
    });
    const p = new OpenAICompatibleProvider("Steady", url, "", { idleTimeoutMs: 200 });
    const r = await p.chat({ model: "m", messages: [{ role: "user", content: "hi" }], onDelta: () => undefined });
    expect(r.content).toBe("012345");
  });

  it("waits for a model that thinks silently before its reply begins, up to the call limit", async () => {
    const url = await endpoint((res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Hidden thinking: nothing streamed for longer than the stall limit, then the answer.
      setTimeout(() => res.end(chunk("done") + "data: [DONE]\n\n"), 300);
    });
    const p = new OpenAICompatibleProvider("Quiet thinker", url, "", { idleTimeoutMs: 100, callTimeoutMs: 5_000 });
    const r = await p.chat({ model: "m", messages: [{ role: "user", content: "hi" }], onDelta: () => undefined });
    expect(r.content).toBe("done");
  });

  it("still stops at once when the caller stops it", async () => {
    const url = await endpoint(() => undefined);
    const p = new OpenAICompatibleProvider("Silent", url, "");
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 50);
    const err = await p.chat({ model: "m", messages: [{ role: "user", content: "hi" }], signal: stop.signal }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TimeoutError);
  });
});
