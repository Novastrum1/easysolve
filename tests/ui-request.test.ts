import { afterEach, expect, it, vi } from "vitest";
import { request, RequestError } from "../components/ui";

afterEach(() => vi.unstubAllGlobals());

it("preserves API field errors and HTTP status for sign-in handling", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: "Sign in to continue", fieldErrors: { email: "Required" } },
          { status: 401 },
        ),
      ),
  );
  await expect(request("bootstrap")).rejects.toMatchObject({
    status: 401,
    fieldErrors: { email: "Required" },
  });
});

it("shows a useful error when a proxy returns HTML instead of JSON", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("<html>Bad gateway</html>", { status: 502 }),
      ),
  );
  await expect(request("billing")).rejects.toMatchObject({
    status: 502,
    message: "The server could not complete the request. Please try again.",
  });
});

it("shows a useful error when the browser cannot connect", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );
  await expect(request("billing")).rejects.toBeInstanceOf(RequestError);
  await expect(request("billing")).rejects.toThrow("Check your connection");
});

it("reassembles streamed chat frames split across network chunks", async () => {
  const encoder = new TextEncoder();
  const onText = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('{"type":"text","text":"Hel'));
            controller.enqueue(
              encoder.encode(
                'lo"}\n{"type":"complete","message":{"id":"reply","role":"assistant","conversation":"default","content":"Hello","activity":[],"createdAt":"2026-10-30T00:00:00Z"}}\n',
              ),
            );
            controller.close();
          },
        }),
        { headers: { "content-type": "application/x-ndjson" } },
      ),
    ),
  );
  expect(
    await request("chat", { text: "Hello" }, undefined, onText),
  ).toMatchObject({ id: "reply", content: "Hello" });
  expect(onText).toHaveBeenCalledWith("Hello");
});

it("rejects interrupted or failed chat streams", async () => {
  for (const value of [
    '{"type":"text","text":"partial"}\n',
    '{"type":"error","error":"DeepSeek rejected the server API key"}\n',
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(value, {
          headers: { "content-type": "application/x-ndjson" },
        }),
      ),
    );
    await expect(
      request("chat", { text: "Hello" }, undefined, vi.fn()),
    ).rejects.toBeInstanceOf(RequestError);
  }
});

it("accepts empty text deltas and a final frame without a newline", async () => {
  const onText = vi.fn();
  const message = {
    id: "reply",
    role: "assistant",
    conversation: "default",
    content: "```js\nconsole.log('ok')\n```",
    activity: [],
    createdAt: "2026-10-30T00:00:00Z",
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          '{"type":"text","text":""}\n' +
            JSON.stringify({ type: "text", text: message.content }) +
            "\n" +
            JSON.stringify({ type: "complete", message }),
          { headers: { "content-type": "application/x-ndjson" } },
        ),
      ),
  );
  expect(await request("chat", { text: "code" }, undefined, onText)).toEqual(
    message,
  );
  expect(onText).toHaveBeenCalledExactlyOnceWith(message.content);
});

it.each([null, {}, { text: "object" }])(
  "rejects non-string streamed text inline: %j",
  async (text) => {
    const onText = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ type: "text", text }) + "\n", {
            headers: { "content-type": "application/x-ndjson" },
          }),
        ),
    );
    await expect(
      request("chat", { text: "Hello" }, undefined, onText),
    ).rejects.toMatchObject({
      message: "Chat returned invalid text. Retry this message.",
    });
    expect(onText).not.toHaveBeenCalled();
  },
);

it("rejects invalid saved-message fields instead of passing objects into rendering", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "complete",
            message: {
              id: "reply",
              role: "assistant",
              conversation: "default",
              content: { answer: "wrong shape" },
              activity: null,
              createdAt: "2026-10-30T00:00:00Z",
            },
          }) + "\n",
          { headers: { "content-type": "application/x-ndjson" } },
        ),
      ),
  );
  await expect(
    request("chat", { text: "Hello" }, undefined, vi.fn()),
  ).rejects.toMatchObject({
    message: "Chat returned an invalid saved message. Retry this message.",
  });
});
