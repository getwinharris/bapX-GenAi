import "server-only";

import type { GenerationProvider, ProviderGenerationRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import { buildPollinationsUrl, resolveDimensions } from "@/lib/provider-helpers";
import { readBoundedResponse } from "@/server/media/transfer";
import { createProviderTransport, invalidProviderResponse, providerHttpError, ProviderRequestError, publicMediaUrl } from "./request-error";
import { getMediaUrls } from "./utils";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export class PollinationsProvider implements GenerationProvider {
    readonly id = "pollinations" as const;

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        if (request.signal?.aborted) throw new ProviderRequestError("ERR_POLLINATIONS_ABORTED");
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
        const imageUrls = getMediaUrls(request.media).map((u) => publicMediaUrl(u, "ERR_POLLINATIONS_MEDIA_URL"));
        const url = buildPollinationsUrl({
            mediaType: request.mediaType,
            providerModelId: request.providerModelId,
            prompt,
            width,
            height,
            seed: request.params.seed,
            negative_prompt: request.params.negative_prompt,
            enhance: typeof fields.enhance_prompt === "boolean" ? fields.enhance_prompt : undefined,
            nologo: typeof fields.watermark === "boolean" ? !fields.watermark : true,
            duration: request.params.duration,
            aspect_ratio: request.params.aspect_ratio,
            generate_audio: request.params.generate_audio,
            imageUrls,
        });

        const key = request.connection?.secret?.trim() ?? process.env.POLLINATIONS_API_KEY?.trim();
        const headers: Record<string, string> = {
            Accept: request.mediaType === "video" ? "video/mp4, video/*, application/octet-stream" : "image/png, image/jpeg, image/webp, image/*",
        };
        if (key) headers.Authorization = `Bearer ${key}`;

        const transport = createProviderTransport("POLLINATIONS", "submit", request.signal);
        try {
            const response = await transport.fetch(url, { method: "GET", headers, cache: "no-store" });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw providerHttpError("POLLINATIONS", "submit", response.status, response.headers.get("retry-after"));
            }
            const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
            if (!contentType.startsWith(request.mediaType === "video" ? "video/" : "image/") && contentType !== "application/octet-stream") {
                await response.body?.cancel().catch(() => undefined);
                throw invalidProviderResponse("POLLINATIONS", "submit");
            }
            const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: MAX_OUTPUT_BYTES });
            if (!bytes.length) throw invalidProviderResponse("POLLINATIONS", "submit");
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
        throw new ProviderRequestError("ERR_POLLINATIONS_POLL_UNSUPPORTED");
    }
}
