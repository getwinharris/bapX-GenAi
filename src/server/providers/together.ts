import "server-only";

import type { GeneratedAsset, GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import { parseBase64DataUrl, resolveDimensions } from "@/lib/provider-helpers";
import { readBoundedResponse } from "@/server/media/transfer";
import { createProviderTransport, invalidProviderResponse, providerHttpError, providerObject, ProviderRequestError, publicMediaUrl } from "./request-error";
import { getMediaUrls } from "./utils";

const BASE = "https://api.together.xyz/v1";
const MAX_JSON_BYTES = 24 * 1024 * 1024;

export class TogetherProvider implements GenerationProvider {
    readonly id = "together" as const;

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const key = request.connection?.secret?.trim() ?? process.env.TOGETHER_API_KEY;
        if (!key?.trim()) throw new ProviderRequestError("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
        const prompt = request.params.prompt?.trim();
        if (!prompt) throw new ProviderRequestError("ERR_PROMPT_REQUIRED");

        const fields = request.params.field_values ?? {};
        const transport = createProviderTransport("TOGETHER", "submit", request.signal);

        if (request.mediaType === "video") {
            const imageUrls = getMediaUrls(request.media);
            const body: Record<string, unknown> = {
                model: request.providerModelId,
                prompt,
                ...(request.params.negative_prompt ? { negative_prompt: request.params.negative_prompt } : {}),
                ...(request.params.seed !== undefined ? { seed: Math.round(request.params.seed) } : {}),
            };
            if (request.params.duration) body.seconds = Number(request.params.duration);
            if (imageUrls[0]) {
                body.frame_images = [{ input_image: publicMediaUrl(imageUrls[0], "ERR_TOGETHER_MEDIA_URL"), frame: "first" }];
            }
            const { width, height } = resolveDimensions({ aspect_ratio: request.params.aspect_ratio }, 1280, 720);
            body.width = width;
            body.height = height;

            try {
                const response = await transport.fetch(`${BASE}/videos`, {
                    method: "POST",
                    cache: "no-store",
                    headers: {
                        Authorization: `Bearer ${key}`,
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    body: JSON.stringify(body),
                });
                if (!response.ok) {
                    await response.body?.cancel().catch(() => undefined);
                    throw providerHttpError("TOGETHER", "submit", response.status, response.headers.get("retry-after"));
                }
                const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: 4 * 1024 * 1024 });
                const payload = providerObject(JSON.parse(bytes.toString("utf8")), "TOGETHER", "submit");
                if (typeof payload.id !== "string" || !payload.id.trim()) throw invalidProviderResponse("TOGETHER", "submit");
                return {
                    status: "IN_PROGRESS",
                    providerTaskId: payload.id,
                    operation: { version: 1, taskId: payload.id, model: request.providerModelId },
                };
            } catch (error) {
                throw transport.classify(error);
            }
        }

        const { width, height } = resolveDimensions(
            {
                width: request.params.width ?? fields.width,
                height: request.params.height ?? fields.height,
                aspect_ratio: request.params.aspect_ratio,
            },
            1024,
            1024,
        );
        const imageUrls = getMediaUrls(request.media);
        const body: Record<string, unknown> = {
            model: request.providerModelId,
            prompt,
            width,
            height,
            response_format: "base64",
            ...(typeof fields.steps === "number" && Number.isFinite(fields.steps) ? { steps: Math.round(fields.steps) } : {}),
            ...(typeof fields.n === "number" && Number.isFinite(fields.n) ? { n: Math.min(4, Math.max(1, Math.round(fields.n))) } : {}),
            ...(request.params.seed !== undefined && Number.isFinite(request.params.seed) ? { seed: Math.round(request.params.seed) } : {}),
            ...(request.params.negative_prompt ? { negative_prompt: request.params.negative_prompt } : {}),
            ...(imageUrls[0] ? { image_url: publicMediaUrl(imageUrls[0], "ERR_TOGETHER_MEDIA_URL") } : {}),
        };

        try {
            const response = await transport.fetch(`${BASE}/images/generations`, {
                method: "POST",
                cache: "no-store",
                headers: {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw providerHttpError("TOGETHER", "submit", response.status, response.headers.get("retry-after"));
            }
            const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: MAX_JSON_BYTES });
            const payload = providerObject(JSON.parse(bytes.toString("utf8")), "TOGETHER", "submit");
            if (!Array.isArray(payload.data) || !payload.data.length) throw invalidProviderResponse("TOGETHER", "submit");
            const assets: GeneratedAsset[] = [];
            for (const item of payload.data) {
                const row = providerObject(item, "TOGETHER", "submit");
                if (typeof row.b64_json === "string" && row.b64_json.trim()) {
                    const parsed = row.b64_json.startsWith("data:") ? parseBase64DataUrl(row.b64_json) : undefined;
                    assets.push(parsed ?? { data: new Uint8Array(Buffer.from(row.b64_json, "base64")), mimeType: "image/png" });
                } else if (typeof row.url === "string" && row.url.trim()) {
                    assets.push({ url: publicMediaUrl(row.url, "ERR_TOGETHER_OUTPUT"), mimeType: "image/png" });
                }
            }
            if (!assets.length) throw invalidProviderResponse("TOGETHER", "submit");
            return { status: "COMPLETED", assets };
        } catch (error) {
            throw transport.classify(error);
        }
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const key = request.connection?.secret?.trim() ?? process.env.TOGETHER_API_KEY;
        if (!key?.trim()) throw new ProviderRequestError("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
        const op = providerObject(request.operation, "TOGETHER", "poll");
        if (op.version !== 1 || typeof op.taskId !== "string" || !op.taskId.trim()) throw new ProviderRequestError("ERR_TOGETHER_OPERATION");
        const transport = createProviderTransport("TOGETHER", "poll", request.signal);
        try {
            const response = await transport.fetch(`${BASE}/videos/${encodeURIComponent(op.taskId)}`, {
                method: "GET",
                cache: "no-store",
                headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw providerHttpError("TOGETHER", "poll", response.status, response.headers.get("retry-after"));
            }
            const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: 4 * 1024 * 1024 });
            const payload = providerObject(JSON.parse(bytes.toString("utf8")), "TOGETHER", "poll");
            const status = String(payload.status ?? "").toLowerCase();
            if (status === "failed" || status === "error" || status === "cancelled") {
                return { status: "FAILED", error: "ERR_TOGETHER_TASK_FAILED", operation: op };
            }
            if (status !== "completed" && status !== "done") {
                return { status: "IN_PROGRESS", operation: op };
            }
            const outputs = payload.outputs && typeof payload.outputs === "object" ? payload.outputs as Record<string, unknown> : undefined;
            const url = typeof outputs?.video_url === "string" ? outputs.video_url
                : typeof payload.video_url === "string" ? payload.video_url : undefined;
            if (!url) throw invalidProviderResponse("TOGETHER", "poll");
            return {
                status: "COMPLETED",
                assets: [{ url: publicMediaUrl(url, "ERR_TOGETHER_OUTPUT"), mimeType: "video/mp4" }],
                operation: op,
            };
        } catch (error) {
            throw transport.classify(error);
        }
    }
}
