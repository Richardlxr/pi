import { afterEach, describe, expect, it, vi } from "vitest";
import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { Model } from "../src/types.ts";

/**
 * Regression test: api.kimi.com (Kimi Coding, OpenAI-compatible endpoint)
 * must be detected as a Moonshot endpoint. Without that detection the system
 * prompt is sent with role "developer", which Kimi rejects with
 * 400: role 'developer' is not allowed.
 */
function buildKimiModel(): Model<"openai-completions"> {
	return {
		id: "k3",
		name: "Kimi K3 1M",
		api: "openai-completions",
		provider: "kimi-code",
		baseUrl: "https://api.kimi.com/coding/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1048576,
		maxTokens: 1048576,
		// Mirrors custom-provider configs (e.g. DeepSeek Harness llm-pi-ai):
		// only reasoning-effort is declared explicitly, so supportsDeveloperRole
		// must fall back to the baseUrl-based detection.
		compat: { supportsReasoningEffort: true },
	};
}

describe("kimi coding endpoint compat", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends the system prompt with role system (not developer) and max_tokens", async () => {
		let capturedBody: { messages: Array<{ role: string }>; max_tokens?: number; max_completion_tokens?: number } | undefined;
		const encoder = new TextEncoder();
		vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
			capturedBody = JSON.parse(String(init.body));
			const sse =
				'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"k3","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":"stop"}]}\n\n' +
				"data: [DONE]\n\n";
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(sse));
						controller.close();
					},
				}),
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			);
		});

		const stream = streamOpenAICompletions(
			buildKimiModel(),
			{ messages: [], systemPrompt: "You are a helpful assistant.", tools: undefined },
			{ apiKey: "test-key", reasoningEffort: "high", maxTokens: 8192 },
		);
		for await (const event of stream) {
			if (event.type === "error") {
				throw new Error(JSON.stringify(event));
			}
		}

		expect(capturedBody).toBeDefined();
		expect(capturedBody!.messages[0].role).toBe("system");
		expect(capturedBody!.max_tokens).toBe(8192);
		expect(capturedBody!.max_completion_tokens).toBeUndefined();
	});
});
