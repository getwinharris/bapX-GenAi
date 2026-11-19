import { NextResponse } from "next/server";
import { normalizeOllamaBaseUrl, validateCloudflareAccountId } from "@/lib/provider-helpers";
import { getProviderConnection, resolveProviderConnection, saveDiscoveredModels } from "@/server/config/provider-store";
import { isProviderId } from "@/providers/definitions";
import type { ProviderId } from "@/providers/types";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/server/security/workspace-access";
import { providerConfigFailure, readConfigObject } from "@/server/http/provider-config";
import { RequestLimitError } from "@/server/http/request-limits";
import { readBoundedResponse } from "@/server/media/transfer";
import { discoverRunwareModels } from "@/server/providers/runware-client";

export const runtime = "nodejs";

function boundedId(value: unknown, allowAt = false): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 200
        && (allowAt ? /^[A-Za-z0-9_.:@/-]+$/ : /^[A-Za-z0-9_.:/-]+$/).test(value);
}

async function discoveryPayload(response: Response, signal: AbortSignal): Promise<unknown> {
    try {
        const bytes = await readBoundedResponse(response, { signal, maxBytes: 4 * 1024 * 1024 });
        const value = JSON.parse(bytes.toString("utf8"));
        if (!value || typeof value !== "object") throw new Error();
        return value;
    } catch {
        throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502);
    }
}

async function resolveOptionalConnection(providerId: ProviderId, connectionId: unknown, requireSecret = true) {
    const connection = typeof connectionId === "string" ? await getProviderConnection(connectionId) : await resolveProviderConnection(providerId);
    if (connection && connection.providerId !== providerId) throw new Error("ERR_PROVIDER_CONNECTION_PROVIDER_MISMATCH");
    if (requireSecret && !connection?.secret) throw new Error("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
    return connection;
}

export async function POST(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    let signal: AbortSignal | undefined;
    try {
        const body = await readConfigObject(request);
        if (!isProviderId(body.providerId)) throw new Error("ERR_UNKNOWN_PROVIDER");
        const providerId = body.providerId as ProviderId;
        if (["google-vertex", "toapis", "magnific"].includes(providerId)) {
            return applyWorkspaceHeaders(NextResponse.json({
                providerId,
                status: "manual",
                models: [],
                message: "This provider exposes no safe generic model-list contract. Use the built-in catalog or add a reviewed capability contract.",
            }));
        }
        signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);

        if (providerId === "runware") {
            const connection = await resolveOptionalConnection(providerId, body.connectionId, true);
            const { models, truncated } = await discoverRunwareModels(connection!, signal);
            signal.throwIfAborted();
            const discovered = await saveDiscoveredModels(providerId, models);
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models, discovered, truncated }));
        }

        if (providerId === "google-ai-studio") {
            const connection = await resolveOptionalConnection(providerId, body.connectionId, true);
            const found = new Map<string, { id: string; display_name?: string; status: "unverified" }>();
            const seenTokens = new Set<string>();
            let pageToken: string | undefined;
            let truncated = false;
            for (let page = 0; page < 20; page++) {
                signal.throwIfAborted();
                const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
                url.searchParams.set("pageSize", "100");
                if (pageToken) url.searchParams.set("pageToken", pageToken);
                const response = await fetch(url.toString(), { headers: { Accept: "application/json", "x-goog-api-key": connection!.secret! }, signal, cache: "no-store" });
                if (!response.ok) {
                    await response.body?.cancel().catch(() => undefined);
                    signal.throwIfAborted();
                    return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: response.status }, { status: 502 }));
                }
                const payload = await discoveryPayload(response, signal) as Record<string, unknown>;
                if (!Array.isArray(payload.models)) throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502);
                for (const entry of payload.models) {
                    const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
                    const name = typeof value.name === "string" ? value.name.replace(/^models\//, "") : undefined;
                    if (!boundedId(name)) continue;
                    if (found.size === 500 && !found.has(name)) { truncated = true; break; }
                    found.set(name, { id: name, display_name: typeof value.displayName === "string" ? value.displayName.slice(0, 300) : undefined, status: "unverified" });
                }
                const next = payload.nextPageToken;
                if (next === undefined || next === "") break;
                if (typeof next !== "string" || next.length > 4096 || seenTokens.has(next)) throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502);
                seenTokens.add(next);
                if (found.size === 500) { truncated = true; break; }
                if (page === 19) throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502);
                pageToken = next;
            }
            signal.throwIfAborted();
            const models = [...found.values()];
            const discovered = await saveDiscoveredModels(providerId, models.map((model) => ({ providerModelId: model.id, displayName: model.display_name })));
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models, discovered, truncated }));
        }

        if (providerId === "pollinations") {
            const connection = await resolveOptionalConnection(providerId, body.connectionId, false).catch(() => undefined);
            const headers: Record<string, string> = { Accept: "application/json" };
            if (connection?.secret) headers.Authorization = `Bearer ${connection.secret}`;
            const [imgRes, vidRes] = await Promise.all([
                fetch("https://gen.pollinations.ai/image/models", { headers, signal, cache: "no-store" }),
                fetch("https://gen.pollinations.ai/video/models", { headers, signal, cache: "no-store" }).catch(() => null),
            ]);
            if (!imgRes.ok) {
                await imgRes.body?.cancel().catch(() => undefined);
                await vidRes?.body?.cancel().catch(() => undefined);
                return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: imgRes.status }, { status: 502 }));
            }
            const imgList = await discoveryPayload(imgRes, signal);
            const vidList = vidRes?.ok ? await discoveryPayload(vidRes, signal).catch(() => []) : [];
            const items: Array<{ providerModelId: string; displayName?: string; mediaType: "image" | "video" }> = [];
            for (const [list, mediaType] of [[imgList, "image"], [vidList, "video"]] as const) {
                if (!Array.isArray(list)) continue;
                for (const row of list.slice(0, 200)) {
                    const name = typeof row === "string" ? row : (row && typeof row === "object" ? String((row as Record<string, unknown>).name ?? (row as Record<string, unknown>).id ?? "") : "");
                    if (!boundedId(name)) continue;
                    const desc = row && typeof row === "object" && typeof (row as Record<string, unknown>).description === "string"
                        ? (row as Record<string, unknown>).description as string
                        : undefined;
                    items.push({ providerModelId: name, displayName: desc?.slice(0, 200) ?? name, mediaType });
                }
            }
            const discovered = await saveDiscoveredModels(providerId, items);
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models: items, discovered }));
        }

        if (providerId === "openrouter") {
            const connection = await resolveOptionalConnection(providerId, body.connectionId, false).catch(() => undefined);
            const headers: Record<string, string> = { Accept: "application/json" };
            if (connection?.secret) headers.Authorization = `Bearer ${connection.secret}`;
            const response = await fetch("https://openrouter.ai/api/v1/images/models", { headers, signal, cache: "no-store" });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: response.status }, { status: 502 }));
            }
            const payload = await discoveryPayload(response, signal) as Record<string, unknown>;
            const rows = Array.isArray(payload.data) ? payload.data : [];
            const items = rows.slice(0, 300).map((row) => {
                const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
                return boundedId(value.id) ? { providerModelId: value.id, displayName: typeof value.name === "string" ? value.name.slice(0, 200) : value.id, mediaType: "image" as const } : undefined;
            }).filter((item): item is NonNullable<typeof item> => Boolean(item));
            const discovered = await saveDiscoveredModels(providerId, items);
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models: items, discovered }));
        }

        if (providerId === "ollama") {
            const connection = await resolveOptionalConnection(providerId, body.connectionId, false);
            const baseUrl = normalizeOllamaBaseUrl(connection?.metadata?.baseUrl ?? process.env.OLLAMA_BASE_URL);
            const headers: Record<string, string> = { Accept: "application/json" };
            if (connection?.secret) headers.Authorization = `Bearer ${connection.secret}`;
            const response = await fetch(`${baseUrl}/api/tags`, { headers, signal, cache: "no-store" });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: response.status }, { status: 502 }));
            }
            const payload = await discoveryPayload(response, signal) as Record<string, unknown>;
            const rows = Array.isArray(payload.models) ? payload.models : [];
            const items = rows.slice(0, 200).map((row) => {
                const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
                const id = typeof value.name === "string" ? value.name : typeof value.model === "string" ? value.model : undefined;
                return boundedId(id) ? { providerModelId: id, displayName: id, mediaType: "image" as const } : undefined;
            }).filter((item): item is NonNullable<typeof item> => Boolean(item));
            const discovered = await saveDiscoveredModels(providerId, items);
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models: items, discovered }));
        }

        if (providerId === "huggingface") {
            const connection = await resolveOptionalConnection(providerId, body.connectionId, false).catch(() => undefined);
            const headers: Record<string, string> = { Accept: "application/json" };
            if (connection?.secret) headers.Authorization = `Bearer ${connection.secret}`;
            const [imgRes, vidRes] = await Promise.all([
                fetch("https://huggingface.co/api/models?pipeline_tag=text-to-image&inference=warm&sort=downloads&limit=40", { headers, signal, cache: "no-store" }),
                fetch("https://huggingface.co/api/models?pipeline_tag=text-to-video&inference=warm&sort=downloads&limit=20", { headers, signal, cache: "no-store" }),
            ]);
            if (!imgRes.ok) {
                await imgRes.body?.cancel().catch(() => undefined);
                await vidRes.body?.cancel().catch(() => undefined);
                return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: imgRes.status }, { status: 502 }));
            }
            const imgList = await discoveryPayload(imgRes, signal);
            const vidList = vidRes.ok ? await discoveryPayload(vidRes, signal).catch(() => []) : [];
            const items: Array<{ providerModelId: string; displayName?: string; mediaType: "image" | "video" }> = [];
            for (const [list, mediaType] of [[imgList, "image"], [vidList, "video"]] as const) {
                if (!Array.isArray(list)) continue;
                for (const row of list) {
                    const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
                    if (boundedId(value.id)) items.push({ providerModelId: value.id, displayName: value.id, mediaType });
                }
            }
            const discovered = await saveDiscoveredModels(providerId, items);
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models: items, discovered }));
        }

        if (providerId === "together") {
            const connection = await resolveOptionalConnection(providerId, body.connectionId, true);
            const response = await fetch("https://api.together.xyz/v1/models", {
                headers: { Accept: "application/json", Authorization: `Bearer ${connection!.secret!}` },
                signal,
                cache: "no-store",
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: response.status }, { status: 502 }));
            }
            const payload = await discoveryPayload(response, signal);
            const rows = Array.isArray(payload) ? payload : [];
            const items = rows.filter((row) => {
                const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
                return ["image", "video"].includes(String(value.type ?? "").toLowerCase()) && boundedId(value.id);
            }).slice(0, 200).map((row) => {
                const value = row as Record<string, unknown>;
                const type = String(value.type).toLowerCase() === "video" ? "video" as const : "image" as const;
                return { providerModelId: String(value.id), displayName: typeof value.display_name === "string" ? value.display_name.slice(0, 200) : String(value.id), mediaType: type };
            });
            const discovered = await saveDiscoveredModels(providerId, items);
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models: items, discovered }));
        }

        if (providerId === "cloudflare") {
            const connection = await resolveOptionalConnection(providerId, body.connectionId, true);
            const accountId = validateCloudflareAccountId(connection?.metadata?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID);
            const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?task=Text-to-Image`, {
                headers: { Accept: "application/json", Authorization: `Bearer ${connection!.secret!}` },
                signal,
                cache: "no-store",
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: response.status }, { status: 502 }));
            }
            const payload = await discoveryPayload(response, signal) as Record<string, unknown>;
            const rows = Array.isArray(payload.result) ? payload.result : [];
            const items = rows.slice(0, 200).map((row) => {
                const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
                return boundedId(value.name, true)
                    ? { providerModelId: value.name, displayName: typeof value.description === "string" ? `${value.name}` : value.name, mediaType: "image" as const }
                    : undefined;
            }).filter((item): item is NonNullable<typeof item> => Boolean(item));
            const discovered = await saveDiscoveredModels(providerId, items);
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models: items, discovered }));
        }

        // The Gateway model catalog is public; generation still requires a connection.
        const response = await fetch("https://ai-gateway.vercel.sh/v1/models", { headers: { Accept: "application/json" }, signal, cache: "no-store" });
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            signal.throwIfAborted();
            return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: response.status }, { status: 502 }));
        }
        const payload = await discoveryPayload(response, signal) as Record<string, unknown>;
        if (!Array.isArray(payload.data)) throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502);
        const raw = payload.data;
        const models = raw.slice(0, 500).map((entry) => {
            const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
            return boundedId(value.id) ? { id: value.id, owned_by: typeof value.owned_by === "string" ? value.owned_by.slice(0, 300) : undefined, status: "unverified" as const } : undefined;
        }).filter(Boolean);
        signal.throwIfAborted();
        const discovered = await saveDiscoveredModels(providerId, models.filter(Boolean).map((model) => ({ providerModelId: model!.id, displayName: model!.owned_by })));
        return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models, discovered }));
    } catch (error) {
        return providerConfigFailure(signal?.aborted ? new RequestLimitError("ERR_REQUEST_CANCELLED", 408) : error, "ERR_PROVIDER_DISCOVERY_FAILED");
    }
}
