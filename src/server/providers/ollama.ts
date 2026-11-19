import "server-only";

import type { GeneratedAsset, GenerationProvider, ProviderGenerationRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import { normalizeOllamaBaseUrl, parseBase64DataUrl, resolveDimensions } from "@/lib/provider-helpers";
import { readBoundedResponse } from "@/server/media/transfer";
import { createProviderTransport, invalidProviderResponse, providerHttpError, providerObject, ProviderRequestError } from "./request-error";

const MAX_JSON_BYTES = 24 * 1024 * 1024;

export class OllamaProvider implements GenerationProvider {
    readonly id = "ollama" as const;

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const prompt = request.params.prompt?.trim();
        if (!prompt) throw new ProviderRequestError("ERR_PROMPT_REQUIRED");

        const baseUrl = normalizeOllamaBaseUrl(request.connection?.metadata?.baseUrl ?? process.env.OLLAMA_BASE_URL);
        const key = request.connection?.secret?.trim() ?? process.env.OLLAMA_API_KEY?.trim();
        const fields = request.params.field_values ?? {};
        const { width, height } = resolveDimensions(
            {
                width: request.params.width ?? fields.width,
                height: request.params.height ?? fields.height,
                aspect_ratio: request.params.aspect_ratio,
            },
            1024,
            1024,
        );

        const body: Record<string, unknown> = {
            model: request.providerModelId,
            prompt,
            size: `${width}x${height}`,
            response_format: "b64_json",
            ...(typeof fields.steps === "number" && Number.isFinite(fields.steps) ? { steps: Math.round(fields.steps) } : {}),
            ...(request.params.seed !== undefined && Number.isFinite(request.params.seed) ? { seed: Math.round(request.params.seed) } : {}),
            ...(request.params.negative_prompt ? { negative_prompt: request.params.negative_prompt } : {}),
        };

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Accept: "application/json",
        };
        if (key) headers.Authorization = `Bearer ${key}`;

        const transport = createProviderTransport("OLLAMA", "submit", request.signal);
        try {
            const response = await transport.fetch(`${baseUrl}/v1/images/generations`, {
                method: "POST",
                cache: "no-store",
                headers,
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw providerHttpError("OLLAMA", "submit", response.status, response.headers.get("retry-after"));
            }
            const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: MAX_JSON_BYTES });
            const payload = providerObject(JSON.parse(bytes.toString("utf8")), "OLLAMA", "submit");
            const assets: GeneratedAsset[] = [];

            if (Array.isArray(payload.data)) {
                for (const item of payload.data) {
                    const row = providerObject(item, "OLLAMA", "submit");
                    if (typeof row.b64_json === "string" && row.b64_json.trim()) {
                        const dataUrl = parseBase64DataUrl(row.b64_json);
                        assets.push(dataUrl ?? { data: new Uint8Array(Buffer.from(row.b64_json, "base64")), mimeType: "image/png" });
                    }
                }
            } else if (typeof payload.image === "string" && payload.image.trim()) {
                const dataUrl = parseBase64DataUrl(payload.image);
                assets.push(dataUrl ?? { data: new Uint8Array(Buffer.from(payload.image, "base64")), mimeType: "image/png" });
            }

            if (!assets.length) throw invalidProviderResponse("OLLAMA", "submit");
            return { status: "COMPLETED", assets };
        } catch (error) {
            throw transport.classify(error);
        }
    }

    async poll(): Promise<ProviderPollResult> {
        throw new ProviderRequestError("ERR_OLLAMA_POLL_UNSUPPORTED");
    }
}
