import "server-only";

import type { ModelCapabilities } from "@/models/capabilities/types";
import { GoogleProvider } from "@/server/providers/google";
import type { GenerationProvider, ProviderId } from "@/providers/types";
import { VercelAiGatewayProvider } from "@/server/providers/vercel-ai-gateway";
import { ToapisProvider } from "@/server/providers/toapis";
import { MagnificProvider } from "@/server/providers/magnific-provider";
import { RunwareProvider } from "@/server/providers/runware";
import { PollinationsProvider } from "@/server/providers/pollinations";
import { HuggingFaceProvider } from "@/server/providers/huggingface";
import { TogetherProvider } from "@/server/providers/together";
import { CloudflareProvider } from "@/server/providers/cloudflare";
import { OpenRouterProvider } from "@/server/providers/openrouter";
import { OllamaProvider } from "@/server/providers/ollama";

const providers = new Map<ProviderId, GenerationProvider>([
    ["pollinations", new PollinationsProvider()],
    ["ollama", new OllamaProvider()],
    ["cloudflare", new CloudflareProvider()],
    ["together", new TogetherProvider()],
    ["huggingface", new HuggingFaceProvider()],
    ["openrouter", new OpenRouterProvider()],
    ["google-ai-studio", new GoogleProvider("google-ai-studio")],
    ["google-vertex", new GoogleProvider("google-vertex")],
    ["vercel-ai-gateway", new VercelAiGatewayProvider()],
    ["toapis", new ToapisProvider()],
    ["magnific", new MagnificProvider()],
    ["runware", new RunwareProvider()],
]);

export function resolveProvider(caps: ModelCapabilities): {
    provider: GenerationProvider;
    providerId: ProviderId;
    providerModelId: string;
} {
    const providerId = caps.provider;
    const provider = providers.get(providerId);
    if (!provider) throw new Error(`ERR_UNKNOWN_PROVIDER: ${providerId}`);
    return {
        provider,
        providerId,
        providerModelId: caps.provider_model_id ?? caps.id,
    };
}

export function getProvider(providerId: ProviderId): GenerationProvider {
    const provider = providers.get(providerId);
    if (!provider) throw new Error(`ERR_UNKNOWN_PROVIDER: ${providerId}`);
    return provider;
}
