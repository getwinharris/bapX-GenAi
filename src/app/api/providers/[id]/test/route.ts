import { NextResponse } from "next/server";
import { getProviderDefinition } from "@/providers/definitions";
import { normalizeOllamaBaseUrl, parseOpenRouterKeyQuota, validateCloudflareAccountId } from "@/lib/provider-helpers";
import { getProviderConnection, markProviderConnectionHealth } from "@/server/config/provider-store";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/server/security/workspace-access";
import { providerConfigFailure } from "@/server/http/provider-config";
import { assertEmptyBody, RequestLimitError } from "@/server/http/request-limits";
import { readBoundedResponse } from "@/server/media/transfer";
import { testRunwareConnection } from "@/server/providers/runware-client";

export const runtime = "nodejs";

async function readJsonSafe(response: Response, signal: AbortSignal): Promise<Record<string, unknown> | undefined> {
    try {
        const bytes = await readBoundedResponse(response, { signal, maxBytes: 1024 * 1024 });
        const value = JSON.parse(bytes.toString("utf8"));
        return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    } catch {
        return undefined;
    }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    try {
        await assertEmptyBody(request);
        const { id } = await context.params;
        const connection = await getProviderConnection(id);
        signal.throwIfAborted();
        const def = connection ? getProviderDefinition(connection.providerId) : undefined;
        if (!connection || (!connection.secret && !def?.secretOptional)) {
            return applyWorkspaceHeaders(NextResponse.json({ status: "unconfigured", error: "ERR_PROVIDER_CONNECTION_NOT_CONFIGURED" }, { status: 400 }));
        }

        if (connection.providerId === "runware") {
            try {
                await testRunwareConnection(connection, signal);
                signal.throwIfAborted();
                await markProviderConnectionHealth(id, "healthy").catch(() => undefined);
                return applyWorkspaceHeaders(NextResponse.json({ status: "healthy" }));
            } catch (error) {
                signal.throwIfAborted();
                await markProviderConnectionHealth(id, "unhealthy").catch(() => undefined);
                throw error;
            }
        }

        if (connection.providerId === "vercel-ai-gateway" || connection.providerId === "google-ai-studio") {
            const gateway = connection.providerId === "vercel-ai-gateway";
            const headers: Record<string, string> = { Accept: "application/json", ...(gateway ? { Authorization: `Bearer ${connection.secret}` } : { "x-goog-api-key": connection.secret! }) };
            const response = await fetch(gateway ? "https://ai-gateway.vercel.sh/v1/models" : "https://generativelanguage.googleapis.com/v1beta/models", { headers, signal, cache: "no-store" });
            // Health only needs the status; release the unused model-list stream.
            await response.body?.cancel().catch(() => undefined);
            signal.throwIfAborted();
            const status = response.ok ? "healthy" : "unhealthy";
            await markProviderConnectionHealth(id, status).catch(() => undefined);
            return applyWorkspaceHeaders(NextResponse.json({ status, status_code: response.status }, { status: response.ok ? 200 : 502 }));
        }

        if (connection.providerId === "openrouter") {
            const response = await fetch("https://openrouter.ai/api/v1/key", {
                headers: { Accept: "application/json", Authorization: `Bearer ${connection.secret}` },
                signal,
                cache: "no-store",
            });
            const payload = response.ok ? await readJsonSafe(response, signal) : (await response.body?.cancel().catch(() => undefined), undefined);
            signal.throwIfAborted();
            const status = response.ok ? "healthy" : "unhealthy";
            const quotaSummary = response.ok ? parseOpenRouterKeyQuota(payload) : undefined;
            await markProviderConnectionHealth(id, status, quotaSummary).catch(() => undefined);
            return applyWorkspaceHeaders(NextResponse.json({ status, status_code: response.status, quotaSummary }, { status: response.ok ? 200 : 502 }));
        }

        if (connection.providerId === "huggingface") {
            const response = await fetch("https://huggingface.co/api/whoami-v2", {
                headers: { Accept: "application/json", Authorization: `Bearer ${connection.secret}` },
                signal,
                cache: "no-store",
            });
            const payload = response.ok ? await readJsonSafe(response, signal) : (await response.body?.cancel().catch(() => undefined), undefined);
            signal.throwIfAborted();
            const status = response.ok ? "healthy" : "unhealthy";
            const isPro = payload?.isPro === true;
            const name = typeof payload?.name === "string" ? payload.name : undefined;
            const quotaSummary = response.ok
                ? `${name ? `@${name} · ` : ""}${isPro ? "HF PRO ($2/mo credits)" : "HF Free tier ($0.10/mo credits)"}`
                : undefined;
            await markProviderConnectionHealth(id, status, quotaSummary).catch(() => undefined);
            return applyWorkspaceHeaders(NextResponse.json({ status, status_code: response.status, quotaSummary }, { status: response.ok ? 200 : 502 }));
        }

        if (connection.providerId === "together") {
            const response = await fetch("https://api.together.xyz/v1/models", {
                headers: { Accept: "application/json", Authorization: `Bearer ${connection.secret}` },
                signal,
                cache: "no-store",
            });
            await response.body?.cancel().catch(() => undefined);
            signal.throwIfAborted();
            const status = response.ok ? "healthy" : "unhealthy";
            const quotaSummary = response.ok ? "10 images/min free tier active" : undefined;
            await markProviderConnectionHealth(id, status, quotaSummary).catch(() => undefined);
            return applyWorkspaceHeaders(NextResponse.json({ status, status_code: response.status, quotaSummary }, { status: response.ok ? 200 : 502 }));
        }

        if (connection.providerId === "cloudflare") {
            const accountId = validateCloudflareAccountId(connection.metadata?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID);
            const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=1`, {
                headers: { Accept: "application/json", Authorization: `Bearer ${connection.secret}` },
                signal,
                cache: "no-store",
            });
            await response.body?.cancel().catch(() => undefined);
            signal.throwIfAborted();
            const status = response.ok ? "healthy" : "unhealthy";
            const quotaSummary = response.ok ? "10,000 Neurons/day free tier ready" : undefined;
            await markProviderConnectionHealth(id, status, quotaSummary).catch(() => undefined);
            return applyWorkspaceHeaders(NextResponse.json({ status, status_code: response.status, quotaSummary }, { status: response.ok ? 200 : 502 }));
        }

        if (connection.providerId === "pollinations") {
            const headers: Record<string, string> = { Accept: "application/json" };
            if (connection.secret) headers.Authorization = `Bearer ${connection.secret}`;
            const response = await fetch("https://gen.pollinations.ai/image/models", { headers, signal, cache: "no-store" });
            const payload = response.ok ? await readJsonSafe(response, signal) : (await response.body?.cancel().catch(() => undefined), undefined);
            signal.throwIfAborted();
            const status = response.ok ? "healthy" : "unhealthy";
            const count = Array.isArray(payload) ? payload.length : undefined;
            const quotaSummary = response.ok
                ? `${connection.secret ? "Keyed tier" : "Free keyless tier"}${count ? ` · ${count} image models live` : ""}`
                : undefined;
            await markProviderConnectionHealth(id, status, quotaSummary).catch(() => undefined);
            return applyWorkspaceHeaders(NextResponse.json({ status, status_code: response.status, quotaSummary }, { status: response.ok ? 200 : 502 }));
        }

        if (connection.providerId === "ollama") {
            const baseUrl = normalizeOllamaBaseUrl(connection.metadata?.baseUrl ?? process.env.OLLAMA_BASE_URL);
            const headers: Record<string, string> = { Accept: "application/json" };
            if (connection.secret) headers.Authorization = `Bearer ${connection.secret}`;
            const response = await fetch(`${baseUrl}/api/tags`, { headers, signal, cache: "no-store" });
            const payload = response.ok ? await readJsonSafe(response, signal) : (await response.body?.cancel().catch(() => undefined), undefined);
            signal.throwIfAborted();
            const status = response.ok ? "healthy" : "unhealthy";
            const models = Array.isArray(payload?.models) ? payload.models.length : 0;
            const quotaSummary = response.ok ? `Connected · ${models} local models installed · Unlimited` : undefined;
            await markProviderConnectionHealth(id, status, quotaSummary).catch(() => undefined);
            return applyWorkspaceHeaders(NextResponse.json({ status, status_code: response.status, quotaSummary }, { status: response.ok ? 200 : 502 }));
        }

        return applyWorkspaceHeaders(NextResponse.json({ status: "configured", message: "No non-billable model-list health endpoint is defined for this provider." }));
    } catch (error) {
        return providerConfigFailure(signal.aborted ? new RequestLimitError("ERR_REQUEST_CANCELLED", 408) : error, "ERR_PROVIDER_HEALTH_FAILED", 502);
    }
}
