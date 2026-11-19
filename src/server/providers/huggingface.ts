import "server-only";

import type { GenerationProvider, ProviderGenerationRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import { resolveDimensions } from "@/lib/provider-helpers";
import { readBoundedResponse } from "@/server/media/transfer";
import { createProviderTransport, invalidProviderResponse, providerHttpError, ProviderRequestError } from "./request-error";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export class HuggingFaceProvider implements GenerationProvider {
    readonly id = "huggingface" as const;

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const key = request.connection?.secret?.trim() ?? process.env.HF_TOKEN ?? process.env.HUGGINGFACE_HUB_TOKEN ?? process.env.HUGGINGFACE_API_KEY;
        if (!key?.trim()) throw new ProviderRequestError("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
        const prompt = request.params.prompt?.trim();
        if (!prompt) throw new ProviderRequestError("ERR_PROMPT_REQUIRED");

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

        const parameters: Record<string, unknown> = {};
        if (request.mediaType === "image") {
            parameters.width = width;
            parameters.height = height;
        }
        if (request.params.negative_prompt) parameters.negative_prompt = request.params.negative_prompt;
        if (typeof fields.steps === "number" && Number.isFinite(fields.steps)) parameters.num_inference_steps = Math.round(fields.steps);
        if (typeof fields.guidance_scale === "number" && Number.isFinite(fields.guidance_scale)) parameters.guidance_scale = fields.guidance_scale;
        if (request.params.seed !== undefined && Number.isFinite(request.params.seed)) parameters.seed = Math.round(request.params.seed);

        const modelPath = request.providerModelId.split("/").map((segment) => encodeURIComponent(segment)).join("/");
        const endpoint = `https://router.huggingface.co/hf-inference/models/${modelPath}`;

        const transport = createProviderTransport("HUGGINGFACE", "submit", request.signal);
        try {
            const response = await transport.fetch(endpoint, {
                method: "POST",
                cache: "no-store",
                headers: {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                    Accept: request.mediaType === "video" ? "video/mp4, video/*" : "image/png, image/jpeg, image/*",
                    "x-wait-for-model": "true",
                },
                body: JSON.stringify({ inputs: prompt, parameters }),
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw providerHttpError("HUGGINGFACE", "submit", response.status, response.headers.get("retry-after"));
            }
            const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
            if (!contentType.startsWith(request.mediaType === "video" ? "video/" : "image/") && contentType !== "application/octet-stream") {
                await response.body?.cancel().catch(() => undefined);
                throw invalidProviderResponse("HUGGINGFACE", "submit");
            }
            const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: MAX_OUTPUT_BYTES });
            if (!bytes.length) throw invalidProviderResponse("HUGGINGFACE", "submit");
            const mimeType = contentType === "application/octet-stream"
                ? (request.mediaType === "video" ? "video/mp4" : "image/png")
                : contentType;
            return {
                status: "COMPLETED",
                assets: [{ data: new Uint8Array(bytes), mimeType }],
            };
        } catch (error) {
            throw transport.classify(error);
        }
    }

    async poll(): Promise<ProviderPollResult> {
        throw new ProviderRequestError("ERR_HUGGINGFACE_POLL_UNSUPPORTED");
    }
}
