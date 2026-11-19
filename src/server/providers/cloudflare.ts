import "server-only";

import type { GenerationProvider, ProviderGenerationRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import { resolveDimensions, validateCloudflareAccountId } from "@/lib/provider-helpers";
import { readBoundedResponse } from "@/server/media/transfer";
import { createProviderTransport, invalidProviderResponse, providerHttpError, providerObject, ProviderRequestError } from "./request-error";

const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;

export class CloudflareProvider implements GenerationProvider {
    readonly id = "cloudflare" as const;

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const key = request.connection?.secret?.trim() ?? process.env.CLOUDFLARE_API_TOKEN;
        if (!key?.trim()) throw new ProviderRequestError("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
        const accountId = validateCloudflareAccountId(request.connection?.metadata?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID);
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

        const isFlux = request.providerModelId.includes("flux");
        const body: Record<string, unknown> = { prompt };
        if (isFlux) {
            if (typeof fields.steps === "number" && Number.isFinite(fields.steps)) {
                body.steps = Math.min(8, Math.max(1, Math.round(fields.steps)));
            }
        } else {
            body.width = width;
            body.height = height;
            if (typeof fields.steps === "number" && Number.isFinite(fields.steps)) body.num_steps = Math.min(20, Math.max(1, Math.round(fields.steps)));
            if (typeof fields.guidance === "number" && Number.isFinite(fields.guidance)) body.guidance = fields.guidance;
            if (request.params.negative_prompt) body.negative_prompt = request.params.negative_prompt;
            if (request.params.seed !== undefined && Number.isFinite(request.params.seed)) body.seed = Math.round(request.params.seed);
        }

        const modelPath = request.providerModelId
            .split("/")
            .map((segment) => (segment.startsWith("@") ? `@${encodeURIComponent(segment.slice(1))}` : encodeURIComponent(segment)))
            .join("/");
        const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelPath}`;

        const transport = createProviderTransport("CLOUDFLARE", "submit", request.signal);
        try {
            const response = await transport.fetch(endpoint, {
                method: "POST",
                cache: "no-store",
                headers: {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw providerHttpError("CLOUDFLARE", "submit", response.status, response.headers.get("retry-after"));
            }
            const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
            const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: MAX_OUTPUT_BYTES });
            if (!bytes.length) throw invalidProviderResponse("CLOUDFLARE", "submit");

            if (contentType.startsWith("image/")) {
                return { status: "COMPLETED", assets: [{ data: new Uint8Array(bytes), mimeType: contentType }] };
            }
            if (contentType === "application/json") {
                const payload = providerObject(JSON.parse(bytes.toString("utf8")), "CLOUDFLARE", "submit");
                const result = payload.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : undefined;
                const b64 = typeof result?.image === "string" ? result.image : undefined;
                if (!b64) throw invalidProviderResponse("CLOUDFLARE", "submit");
                return { status: "COMPLETED", assets: [{ data: new Uint8Array(Buffer.from(b64, "base64")), mimeType: "image/jpeg" }] };
            }
            throw invalidProviderResponse("CLOUDFLARE", "submit");
        } catch (error) {
            throw transport.classify(error);
        }
    }

    async poll(): Promise<ProviderPollResult> {
        throw new ProviderRequestError("ERR_CLOUDFLARE_POLL_UNSUPPORTED");
    }
}
