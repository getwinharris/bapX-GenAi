import type { ProviderConnectionRecord } from "@/providers/config-types";
import type { ProviderId } from "@/providers/types";
import type { ProviderDefinition as Def } from "@/providers/definitions";

export type ProviderFilterTab = "all" | "free" | "local" | "image" | "video" | "connected";

const ASPECT_RATIO_DIMENSIONS: Record<string, [number, number]> = {
    "1:1": [1024, 1024],
    "16:9": [1344, 768],
    "9:16": [768, 1344],
    "4:3": [1152, 896],
    "3:4": [896, 1152],
    "3:2": [1216, 832],
    "2:3": [832, 1216],
    "4:5": [896, 1152],
    "5:4": [1152, 896],
    "21:9": [1536, 640],
};

export function resolveDimensions(
    params: { width?: unknown; height?: unknown; size?: unknown; aspect_ratio?: unknown },
    fallbackWidth = 1024,
    fallbackHeight = 1024,
): { width: number; height: number } {
    const rawW = typeof params.width === "number" && Number.isFinite(params.width) ? Math.round(params.width) : undefined;
    const rawH = typeof params.height === "number" && Number.isFinite(params.height) ? Math.round(params.height) : undefined;
    if (rawW && rawH && rawW >= 64 && rawH >= 64 && rawW <= 4096 && rawH <= 4096) {
        return { width: rawW, height: rawH };
    }
    if (typeof params.size === "string") {
        const match = /^(\d{2,4})x(\d{2,4})$/i.exec(params.size.trim());
        if (match) {
            return {
                width: Math.min(4096, Math.max(64, Number(match[1]))),
                height: Math.min(4096, Math.max(64, Number(match[2]))),
            };
        }
    }
    if (typeof params.aspect_ratio === "string" && ASPECT_RATIO_DIMENSIONS[params.aspect_ratio]) {
        const [width, height] = ASPECT_RATIO_DIMENSIONS[params.aspect_ratio];
        return { width, height };
    }
    return { width: fallbackWidth, height: fallbackHeight };
}

export function normalizeOllamaBaseUrl(value?: unknown): string {
    const raw = typeof value === "string" && value.trim() ? value.trim() : "http://127.0.0.1:11434";
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error("ERR_OLLAMA_BASE_URL");
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error("ERR_OLLAMA_BASE_URL");
    }
    return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, ""));
}

export function validateCloudflareAccountId(value?: unknown): string {
    if (typeof value !== "string") throw new Error("ERR_CLOUDFLARE_ACCOUNT_ID_REQUIRED");
    const trimmed = value.trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(trimmed)) throw new Error("ERR_CLOUDFLARE_ACCOUNT_ID_REQUIRED");
    return trimmed;
}

export function parseBase64DataUrl(value: string): { data: Uint8Array; mimeType: string } | undefined {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
    if (!match) return undefined;
    const mimeType = match[1].toLowerCase();
    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) return undefined;
    const binary = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    if (!binary.length) return undefined;
    return { data: new Uint8Array(binary), mimeType };
}

export function buildPollinationsUrl(input: {
    mediaType: "image" | "video";
    providerModelId: string;
    prompt: string;
    width?: number;
    height?: number;
    seed?: number;
    negative_prompt?: string;
    enhance?: boolean;
    nologo?: boolean;
    duration?: string | number;
    aspect_ratio?: string;
    generate_audio?: boolean;
    imageUrls?: string[];
}): string {
    const endpoint = input.mediaType === "video" ? "video" : "image";
    const url = new URL(`https://gen.pollinations.ai/${endpoint}/${encodeURIComponent(input.prompt)}`);
    url.searchParams.set("model", input.providerModelId);
    if (input.mediaType === "image") {
        if (input.width) url.searchParams.set("width", String(input.width));
        if (input.height) url.searchParams.set("height", String(input.height));
        if (input.negative_prompt) url.searchParams.set("negative_prompt", input.negative_prompt);
        if (input.enhance) url.searchParams.set("enhance", "true");
        if (input.nologo !== false) url.searchParams.set("nologo", "true");
    } else {
        if (input.duration !== undefined) url.searchParams.set("duration", String(input.duration));
        if (input.aspect_ratio) url.searchParams.set("aspectRatio", input.aspect_ratio);
        if (input.generate_audio !== undefined) url.searchParams.set("audio", String(input.generate_audio));
    }
    if (input.seed !== undefined && Number.isFinite(input.seed)) url.searchParams.set("seed", String(Math.round(input.seed)));
    if (input.imageUrls?.length) url.searchParams.set("image", input.imageUrls.join(","));
    return url.toString();
}

export function parseOpenRouterKeyQuota(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    const data = (payload as Record<string, unknown>).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    const entry = data as Record<string, unknown>;
    const tier = entry.is_free_tier === true ? "Free tier (50 req/day :free)" : "Paid tier (1,000 req/day :free)";
    if (typeof entry.limit === "number" && typeof entry.limit_remaining === "number") {
        return `${tier} · $${entry.limit_remaining.toFixed(2)} / $${entry.limit.toFixed(2)} left`;
    }
    if (typeof entry.usage === "number") {
        return `${tier} · $${entry.usage.toFixed(2)} used`;
    }
    return tier;
}

export function filterProviderDefinitions(
    providers: readonly Def[],
    connections: readonly ProviderConnectionRecord[],
    connectedIds: Set<string>,
    filter: ProviderFilterTab,
    search: string,
    getDescription: (id: ProviderId) => string = (id) => id,
): Def[] {
    const q = search.trim().toLocaleLowerCase();
    return providers.filter((provider) => {
        if (filter === "free" && provider.freeTier.kind === "paid") return false;
        if (filter === "local" && provider.freeTier.kind !== "local-unlimited") return false;
        if (filter === "image" && !provider.mediaTypes.includes("image")) return false;
        if (filter === "video" && !provider.mediaTypes.includes("video")) return false;
        if (filter === "connected") {
            const hasSaved = connections.some((c) => c.providerId === provider.id && c.enabled);
            if (!connectedIds.has(provider.id) && !hasSaved) return false;
        }
        if (!q) return true;
        const haystack = `${provider.label} ${getDescription(provider.id)} ${provider.freeTier.headline} ${provider.freeTier.quota} ${provider.mediaTypes.join(" ")}`.toLocaleLowerCase();
        return haystack.includes(q);
    });
}
