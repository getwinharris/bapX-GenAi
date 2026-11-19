import "server-only";

import type { GeneratedAsset, GenerationProvider, ProviderGenerationRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import { parseBase64DataUrl } from "@/lib/provider-helpers";
import { readBoundedResponse } from "@/server/media/transfer";
import { createProviderTransport, invalidProviderResponse, providerHttpError, providerObject, ProviderRequestError, publicMediaUrl } from "./request-error";
import { fetchMedia, getMediaUrls } from "./utils";

const BASE = "https://openrouter.ai/api/v1";
const MAX_JSON_BYTES = 24 * 1024 * 1024;

export class OpenRouterProvider implements GenerationProvider {
    readonly id = "openrouter" as const;

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const key = request.connection?.secret?.trim() ?? process.env.OPENROUTER_API_KEY;
        if (!key?.trim()) throw new ProviderRequestError("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
        const prompt = request.params.prompt?.trim();
        if (!prompt) throw new ProviderRequestError("ERR_PROMPT_REQUIRED");

        const fields = request.params.field_values ?? {};
        const transport = createProviderTransport("OPENROUTER", "submit", request.signal);
        const headers: Record<string, string> = {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "HTTP-Referer": process.env.APP_ORIGIN ?? "http://localhost:3000",
            "X-Title": "OpenHiggsfield",
        };

        try {
            if (request.providerMode === "language-image") {
                const refs = getMediaUrls(request.media);
                const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
                for (const url of refs) {
                    const media = await fetchMedia(url, { signal: transport.signal });
                    const encoded = `data:${media.mimeType};base64,${Buffer.from(media.data).toString("base64")}`;
                    content.push({ type: "image_url", image_url: { url: encoded } });
                }
                const body: Record<string, unknown> = {
                    model: request.providerModelId,
                    messages: [{ role: "user", content }],
                    modalities: ["image", "text"],
                    ...(request.params.aspect_ratio ? { image_config: { aspect_ratio: request.params.aspect_ratio } } : {}),
                };
                const response = await transport.fetch(`${BASE}/chat/completions`, {
                    method: "POST",
                    cache: "no-store",
                    headers,
                    body: JSON.stringify(body),
                });
                if (!response.ok) {
                    await response.body?.cancel().catch(() => undefined);
                    throw providerHttpError("OPENROUTER", "submit", response.status, response.headers.get("retry-after"));
                }
                const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: MAX_JSON_BYTES });
                const payload = providerObject(JSON.parse(bytes.toString("utf8")), "OPENROUTER", "submit");
                const choices = Array.isArray(payload.choices) ? payload.choices : [];
                const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : undefined;
                const message = first?.message && typeof first.message === "object" ? first.message as Record<string, unknown> : undefined;
                const images = Array.isArray(message?.images) ? message.images : [];
                const assets: GeneratedAsset[] = [];
                for (const item of images) {
                    const obj = item && typeof item === "object" ? item as Record<string, unknown> : undefined;
                    const imageUrl = obj?.image_url && typeof obj.image_url === "object" ? (obj.image_url as Record<string, unknown>).url : undefined;
                    if (typeof imageUrl === "string") {
                        const dataUrl = parseBase64DataUrl(imageUrl);
                        if (dataUrl) assets.push(dataUrl);
                        else assets.push({ url: publicMediaUrl(imageUrl, "ERR_OPENROUTER_OUTPUT"), mimeType: "image/png" });
                    }
                }
                if (!assets.length) throw invalidProviderResponse("OPENROUTER", "submit");
                return { status: "COMPLETED", assets };
            }

            const body: Record<string, unknown> = {
                model: request.providerModelId,
                prompt,
                ...(request.params.aspect_ratio ? { aspect_ratio: request.params.aspect_ratio } : {}),
                ...(typeof fields.n === "number" && Number.isFinite(fields.n) ? { n: Math.min(4, Math.max(1, Math.round(fields.n))) } : {}),
                ...(request.params.seed !== undefined && Number.isFinite(request.params.seed) ? { seed: Math.round(request.params.seed) } : {}),
            };
            const response = await transport.fetch(`${BASE}/images`, {
                method: "POST",
                cache: "no-store",
                headers,
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw providerHttpError("OPENROUTER", "submit", response.status, response.headers.get("retry-after"));
            }
            const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: MAX_JSON_BYTES });
            const payload = providerObject(JSON.parse(bytes.toString("utf8")), "OPENROUTER", "submit");
            const rows = Array.isArray(payload.data) ? payload.data : [];
            const assets: GeneratedAsset[] = [];
            for (const item of rows) {
                const row = providerObject(item, "OPENROUTER", "submit");
                if (typeof row.b64_json === "string" && row.b64_json.trim()) {
                    const dataUrl = parseBase64DataUrl(row.b64_json);
                    assets.push(dataUrl ?? { data: new Uint8Array(Buffer.from(row.b64_json, "base64")), mimeType: "image/png" });
                } else if (typeof row.url === "string" && row.url.trim()) {
                    const dataUrl = parseBase64DataUrl(row.url);
                    assets.push(dataUrl ?? { url: publicMediaUrl(row.url, "ERR_OPENROUTER_OUTPUT"), mimeType: "image/png" });
                }
            }
            if (!assets.length) throw invalidProviderResponse("OPENROUTER", "submit");
            return { status: "COMPLETED", assets };
        } catch (error) {
            throw transport.classify(error);
        }
    }

    async poll(): Promise<ProviderPollResult> {
        throw new ProviderRequestError("ERR_OPENROUTER_POLL_UNSUPPORTED");
    }
}
