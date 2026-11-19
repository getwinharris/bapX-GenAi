import type { ProviderId } from "./types";

export type ProviderSecretKind = "api-key" | "optional-api-key" | "google-service-account";

export type ProviderFreeTierKind = "free-no-key" | "local-unlimited" | "free-tier" | "free-credits" | "paid";

export interface ProviderFreeTierInfo {
    kind: ProviderFreeTierKind;
    headline: string;
    rateLimit: string;
    quota: string;
    resetCadence: string;
    modalitiesNote: string;
}

export interface ProviderDefinition {
    id: ProviderId;
    label: string;
    description: string;
    secretKind: ProviderSecretKind;
    secretOptional?: boolean;
    supportsVerify: boolean;
    supportsBaseUrl?: boolean;
    defaultBaseUrl?: string;
    requiresAccountId?: boolean;
    mediaTypes: Array<"image" | "video">;
    supportsMultipleConnections: boolean;
    discovery: "built-in" | "provider-api" | "manual";
    envKeys: string[];
    docsUrl: string;
    apiKeyUrl: string;
    freeTier: ProviderFreeTierInfo;
}

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
    {
        id: "pollinations",
        docsUrl: "https://enter.pollinations.ai/api/docs",
        apiKeyUrl: "https://enter.pollinations.ai/",
        label: "Pollinations",
        description: "Keyless free & keyed tier for Flux, Z-Image, Veo, Seedance & Wan.",
        secretKind: "optional-api-key",
        secretOptional: true,
        supportsVerify: true,
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["POLLINATIONS_API_KEY"],
        freeTier: {
            kind: "free-no-key",
            headline: "Free tier · Keyless or API key",
            rateLimit: "Anon burst ~1 req/15s · Keyed higher concurrency",
            quota: "Unlimited anonymous queues · Free pollen starter tier with key",
            resetCadence: "Rolling burst / daily pollen refill",
            modalitiesNote: "Image (Flux, Z-Image, Klein) + Video (Veo, Seedance, Wan)",
        },
    },
    {
        id: "ollama",
        docsUrl: "https://docs.ollama.com/capabilities/image-generation",
        apiKeyUrl: "https://ollama.com/settings/keys",
        label: "Ollama",
        description: "Local & self-hosted zero-limit image models (Z-Image, FLUX.2 Klein).",
        secretKind: "optional-api-key",
        secretOptional: true,
        supportsVerify: true,
        supportsBaseUrl: true,
        defaultBaseUrl: "http://127.0.0.1:11434",
        mediaTypes: ["image"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["OLLAMA_BASE_URL", "OLLAMA_API_KEY"],
        freeTier: {
            kind: "local-unlimited",
            headline: "Unlimited · Local hardware / custom endpoint",
            rateLimit: "No API rate limits locally",
            quota: "100% free local inference (x/z-image-turbo, x/flux2-klein)",
            resetCadence: "No reset · Local GPU/CPU bound",
            modalitiesNote: "Image via /v1/images/generations",
        },
    },
    {
        id: "cloudflare",
        docsUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
        apiKeyUrl: "https://dash.cloudflare.com/profile/api-tokens",
        label: "Cloudflare Workers AI",
        description: "Edge serverless FLUX.1 Schnell, SDXL & Lightning on free daily Neurons.",
        secretKind: "api-key",
        supportsVerify: true,
        requiresAccountId: true,
        mediaTypes: ["image"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        freeTier: {
            kind: "free-tier",
            headline: "10,000 free Neurons / day · No credit card",
            rateLimit: "~300 req/min on text-to-image workers",
            quota: "10,000 Neurons/day (~150–170 FLUX/SDXL images/day)",
            resetCadence: "Daily at 00:00 UTC",
            modalitiesNote: "Image (@cf/black-forest-labs/flux-1-schnell, SDXL, Lightning)",
        },
    },
    {
        id: "together",
        docsUrl: "https://docs.together.ai/docs/images-overview",
        apiKeyUrl: "https://api.together.xyz/settings/api-keys",
        label: "Together AI",
        description: "Free FLUX.1-schnell-Free endpoint plus fast Image and Video models.",
        secretKind: "api-key",
        supportsVerify: true,
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["TOGETHER_API_KEY"],
        freeTier: {
            kind: "free-tier",
            headline: "10 free images / min · FLUX.1-schnell-Free",
            rateLimit: "10 RPM on free tier · Higher on Build/Scale",
            quota: "Unlimited free-tier access on FLUX.1-schnell-Free ($1+ starter credits)",
            resetCadence: "Rolling per-minute window",
            modalitiesNote: "Image (FLUX.1-schnell-Free, FLUX.1-dev) + Video (Kling, Wan, Hailuo)",
        },
    },
    {
        id: "huggingface",
        docsUrl: "https://huggingface.co/docs/inference-providers/index",
        apiKeyUrl: "https://huggingface.co/settings/tokens",
        label: "Hugging Face",
        description: "HF Inference Providers router for open FLUX, SD 3.5 & Wan video models.",
        secretKind: "api-key",
        supportsVerify: true,
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["HF_TOKEN", "HUGGINGFACE_HUB_TOKEN", "HUGGINGFACE_API_KEY"],
        freeTier: {
            kind: "free-credits",
            headline: "$0.10 / mo free serverless credits · PRO $2 / mo",
            rateLimit: "Shared free tier concurrency · Cold-start queue",
            quota: "$0.10/month free credits on HF Inference Providers",
            resetCadence: "Monthly billing cycle",
            modalitiesNote: "Image (FLUX.1-schnell, SDXL, SD 3.5) + Video (Wan2.1/2.2, Hunyuan)",
        },
    },
    {
        id: "openrouter",
        docsUrl: "https://openrouter.ai/docs/features/multimodal/image-generation",
        apiKeyUrl: "https://openrouter.ai/settings/keys",
        label: "OpenRouter",
        description: "Unified router with /images API, multimodal Gemini/FLUX & live key quota checks.",
        secretKind: "api-key",
        supportsVerify: true,
        mediaTypes: ["image"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["OPENROUTER_API_KEY"],
        freeTier: {
            kind: "free-tier",
            headline: "50 req/day on :free models · 1,000/day with $10+",
            rateLimit: "20 RPM burst on free routes · Live key limit check",
            quota: "50 free req/day (:free routes) · Pay-as-you-go image models",
            resetCadence: "Daily at 00:00 UTC",
            modalitiesNote: "Image (/api/v1/images + chat image-output models)",
        },
    },
    {
        id: "google-ai-studio",
        docsUrl: "https://ai.google.dev/gemini-api/docs",
        apiKeyUrl: "https://aistudio.google.com/apikey",
        label: "Google AI Studio",
        description: "Gemini and Veo through the Gemini API.",
        secretKind: "api-key",
        supportsVerify: true,
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"],
        freeTier: {
            kind: "free-tier",
            headline: "Free tier · Gemini Flash Image (region dependent)",
            rateLimit: "5–15 RPM & 250k TPM free tier · Paid tier for Veo/4K",
            quota: "Free tier up to ~100–500 RPD on eligible Gemini Flash models",
            resetCadence: "Daily at midnight PT",
            modalitiesNote: "Image (Gemini Image / Nano Banana) + Video (Veo, Gemini Omni)",
        },
    },
    {
        id: "google-vertex",
        docsUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs",
        apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
        label: "Google Vertex AI",
        description: "Gemini and Veo through Vertex AI.",
        secretKind: "google-service-account",
        supportsVerify: false,
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "manual",
        envKeys: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_CLOUD_CREDENTIALS"],
        freeTier: {
            kind: "free-credits",
            headline: "$300 new GCP trial credits · Enterprise quotas",
            rateLimit: "Regional project RPM quotas",
            quota: "$300 free GCP trial credits for 90 days",
            resetCadence: "Trial window / GCP billing",
            modalitiesNote: "Image (Gemini Image) + Video (Veo 3.1, Gemini Omni)",
        },
    },
    {
        id: "vercel-ai-gateway",
        docsUrl: "https://vercel.com/docs/ai-gateway",
        apiKeyUrl: "https://vercel.com/dashboard/ai-gateway",
        label: "Vercel AI Gateway",
        description: "A unified gateway for image and video providers.",
        secretKind: "api-key",
        supportsVerify: true,
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["AI_GATEWAY_API_KEY"],
        freeTier: {
            kind: "free-credits",
            headline: "$5 / mo free AI Gateway credits (Hobby/Pro)",
            rateLimit: "Upstream provider & Vercel plan limits",
            quota: "$5 monthly free credits included on Vercel accounts",
            resetCadence: "Monthly",
            modalitiesNote: "Image (FLUX, GPT Image, Recraft) + Video (Kling, Wan, Veo, Seedance)",
        },
    },
    {
        id: "runware",
        docsUrl: "https://runware.ai/docs/models-api/introduction",
        apiKeyUrl: "https://my.runware.ai/keys",
        label: "Runware",
        description: "Image and video models through the Runware API.",
        secretKind: "api-key",
        supportsVerify: true,
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["RUNWARE_API_KEY"],
        freeTier: {
            kind: "free-credits",
            headline: "Free starter credits on signup · Sub-cent per image",
            rateLimit: "High throughput async queue",
            quota: "Starter trial credits on new accounts",
            resetCadence: "Pay-as-you-go after starter credits",
            modalitiesNote: "Image & Video across AIR model checkpoints",
        },
    },
    {
        id: "toapis",
        docsUrl: "https://docs.toapis.com/",
        apiKeyUrl: "https://toapis.com/",
        label: "ToAPIs",
        description: "Documented image, video and Midjourney operations.",
        secretKind: "api-key",
        supportsVerify: false,
        supportsBaseUrl: true,
        defaultBaseUrl: "https://toapis.com",
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "manual",
        envKeys: ["TOAPIS_API_KEY"],
        freeTier: {
            kind: "paid",
            headline: "Usage-based billing · Custom gateway origin",
            rateLimit: "Plan-based concurrency",
            quota: "Pay-as-you-go balance",
            resetCadence: "Usage-based",
            modalitiesNote: "Image, Video & Midjourney operations",
        },
    },
    {
        id: "magnific",
        docsUrl: "https://docs.magnific.com/",
        apiKeyUrl: "https://magnific.ai/",
        label: "Magnific",
        description: "Magnific image and video APIs.",
        secretKind: "api-key",
        supportsVerify: false,
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "built-in",
        envKeys: ["MAGNIFIC_API_KEY"],
        freeTier: {
            kind: "paid",
            headline: "API credits required",
            rateLimit: "Account tier concurrency",
            quota: "Credit-based generation & upscaling",
            resetCadence: "Plan billing cycle",
            modalitiesNote: "Image, Video & Upscale tools",
        },
    },
];

export function getProviderDefinition(id: ProviderId): ProviderDefinition {
    const definition = PROVIDER_DEFINITIONS.find((entry) => entry.id === id);
    if (!definition) throw new Error(`ERR_UNKNOWN_PROVIDER: ${id}`);
    return definition;
}

export function isProviderId(value: unknown): value is ProviderId {
    return typeof value === "string" && PROVIDER_DEFINITIONS.some((entry) => entry.id === value);
}
