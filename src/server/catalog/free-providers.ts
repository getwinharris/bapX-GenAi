import "server-only";

import type { CustomFieldCapability, ImageModelCapability, ModelCapabilities } from "@/models/capabilities/types";

const BASE = {
    prompt_required: true,
    duration: false,
    aspect_ratio: false,
    size: false,
    resolution_variant: false,
    negative_prompt: false,
    cfg_scale: false,
    style: false,
    shot_type: false,
    prompt_expansion: false,
    elements: false,
} as const;

const RATIOS_STANDARD = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;

function ratioUi(ratios: readonly string[], resolutions: Array<{ id: string; base: number }>, defaultAspect = "1:1", defaultResolution = resolutions[0]?.id ?? "1K") {
    return {
        width_field: "width",
        height_field: "height",
        aspect_ratios: ratios.map((id) => {
            const [w, h] = id.split(":").map(Number);
            return { id, w, h };
        }),
        resolutions,
        default_aspect: defaultAspect,
        default_resolution: defaultResolution,
    };
}

function tupleRatios(values: readonly string[]): { options: Array<[string, string]>; default: [string, string] } {
    return {
        options: values.map((v) => [v, v] as [string, string]),
        default: [values[0], values[0]],
    };
}

const seedRange = { minimum: 0, maximum: 2_147_483_647 };

function pollinationsImage(model: string, label: string, sortKey: number, extra: { refImages?: boolean; gpt?: boolean } = {}): ImageModelCapability {
    const custom_fields: CustomFieldCapability[] = [
        { id: "enhance_prompt", label: "Enhance prompt", type: "checkbox", default: false },
        { id: "watermark", label: "Watermark", type: "checkbox", default: false },
    ];
    return {
        ...BASE,
        id: `pollinations__${model.replace(/[^a-z0-9]+/gi, "_")}`,
        label,
        family: "Pollinations Free",
        variant: "Free / Keyless",
        group: "Pollinations",
        category: extra.refImages ? "Generate / Edit" : "Generate",
        provider: "pollinations",
        provider_model_id: model,
        provider_mode: "image-model",
        has_edit_variant: false,
        negative_prompt: !extra.gpt,
        seed: seedRange,
        sort_key: sortKey,
        size_ui: ratioUi(RATIOS_STANDARD, [{ id: "768", base: 768 }, { id: "1K", base: 1024 }, { id: "1.5K", base: 1536 }], "1:1", "1K"),
        media_slots: extra.refImages
            ? [{ id: "reference_images", label: "Reference images", kind: "image", multiple: true, max_count: 4 }]
            : [],
        custom_fields,
    };
}

function pollinationsVideo(model: string, label: string, sortKey: number, durations: string[], audio = false): ModelCapabilities {
    return {
        ...BASE,
        id: `pollinations__video__${model.replace(/[^a-z0-9]+/gi, "_")}`,
        label,
        family: "Pollinations Video",
        variant: "Free Tier",
        group: "Pollinations",
        provider: "pollinations",
        provider_model_id: model,
        provider_mode: "video",
        seed: seedRange,
        sort_key: sortKey,
        duration: { options: durations, default: durations[0] },
        aspect_ratio: tupleRatios(["16:9", "9:16", "1:1"]),
        media_slots: [
            { id: "start_image", label: "First frame", kind: "image", max_count: 1 },
        ],
        custom_fields: audio ? [{ id: "generate_audio", label: "Generate audio", type: "checkbox", default: false }] : [],
    };
}

function hfImage(id: string, providerModelId: string, label: string, sortKey: number, defaultSteps: number, maxSteps: number, guidanceDefault?: number): ImageModelCapability {
    const custom_fields: CustomFieldCapability[] = [
        { id: "steps", label: "Steps", type: "number", minimum: 1, maximum: maxSteps, step: 1, default: defaultSteps },
    ];
    if (guidanceDefault !== undefined) {
        custom_fields.push({ id: "guidance_scale", label: "Guidance scale", type: "number", minimum: 0, maximum: 20, step: 0.5, default: guidanceDefault });
    }
    return {
        ...BASE,
        id,
        label,
        family: "Hugging Face Hub",
        variant: "HF Inference",
        group: "Hugging Face",
        category: "Generate",
        provider: "huggingface",
        provider_model_id: providerModelId,
        provider_mode: "image-model",
        has_edit_variant: false,
        negative_prompt: guidanceDefault !== undefined,
        seed: seedRange,
        sort_key: sortKey,
        size_ui: ratioUi(["1:1", "16:9", "9:16", "4:3", "3:4"], [{ id: "768", base: 768 }, { id: "1K", base: 1024 }], "1:1", "1K"),
        media_slots: [],
        custom_fields,
    };
}

function hfVideo(id: string, providerModelId: string, label: string, sortKey: number): ModelCapabilities {
    return {
        ...BASE,
        id,
        label,
        family: "Hugging Face Video",
        variant: "HF Inference",
        group: "Hugging Face",
        provider: "huggingface",
        provider_model_id: providerModelId,
        provider_mode: "video",
        negative_prompt: true,
        seed: seedRange,
        sort_key: sortKey,
        custom_fields: [
            { id: "steps", label: "Steps", type: "number", minimum: 10, maximum: 50, step: 1, default: 25 },
            { id: "guidance_scale", label: "Guidance scale", type: "number", minimum: 1, maximum: 15, step: 0.5, default: 5 },
        ],
        media_slots: [],
    };
}

function togetherImage(id: string, providerModelId: string, label: string, sortKey: number, stepsDefault: number, stepsMax: number, refImages = false): ImageModelCapability {
    return {
        ...BASE,
        id,
        label,
        family: "Together Images",
        variant: providerModelId.endsWith("-Free") ? "Free 10/min" : "Together API",
        group: "Together AI",
        category: refImages ? "Generate / Edit" : "Generate",
        provider: "together",
        provider_model_id: providerModelId,
        provider_mode: "image-model",
        has_edit_variant: false,
        negative_prompt: !providerModelId.includes("FLUX"),
        seed: seedRange,
        sort_key: sortKey,
        size_ui: ratioUi(RATIOS_STANDARD, [{ id: "768", base: 768 }, { id: "1K", base: 1024 }], "1:1", "1K"),
        media_slots: refImages ? [{ id: "reference_images", label: "Reference images", kind: "image", max_count: 1 }] : [],
        custom_fields: [
            { id: "steps", label: "Steps", type: "number", minimum: 1, maximum: stepsMax, step: 1, default: stepsDefault },
            { id: "n", label: "Number of outputs", type: "number", minimum: 1, maximum: 4, step: 1, default: 1 },
        ],
    };
}

function togetherVideo(id: string, providerModelId: string, label: string, sortKey: number): ModelCapabilities {
    return {
        ...BASE,
        id,
        label,
        family: "Together Video",
        variant: "Together API",
        group: "Together AI",
        provider: "together",
        provider_model_id: providerModelId,
        provider_mode: "video",
        negative_prompt: true,
        seed: seedRange,
        sort_key: sortKey,
        duration: { options: ["5", "6", "10"], default: "5" },
        aspect_ratio: tupleRatios(["16:9", "9:16", "1:1"]),
        resolution_variant: { options: ["720p", "1080p"], default: "720p" },
        media_slots: [{ id: "start_image", label: "First frame", kind: "image", max_count: 1 }],
        custom_fields: [],
    };
}

function cloudflareImage(id: string, providerModelId: string, label: string, sortKey: number, stepsDefault: number, stepsMax: number, flux = false): ImageModelCapability {
    const custom_fields: CustomFieldCapability[] = [
        { id: "steps", label: "Steps", type: "number", minimum: 1, maximum: stepsMax, step: 1, default: stepsDefault },
    ];
    if (!flux) {
        custom_fields.push({ id: "guidance", label: "Guidance", type: "number", minimum: 1, maximum: 20, step: 0.5, default: 7.5 });
    }
    return {
        ...BASE,
        id,
        label,
        family: "Cloudflare Workers AI",
        variant: "10k Neurons/day",
        group: "Cloudflare Workers AI",
        category: "Generate",
        provider: "cloudflare",
        provider_model_id: providerModelId,
        provider_mode: "image-model",
        has_edit_variant: false,
        negative_prompt: !flux,
        seed: flux ? false : seedRange,
        sort_key: sortKey,
        size_ui: flux
            ? ratioUi(["1:1", "16:9", "9:16"], [{ id: "512", base: 512 }, { id: "1K", base: 1024 }], "1:1", "1K")
            : ratioUi(["1:1", "4:3", "3:4", "16:9", "9:16"], [{ id: "512", base: 512 }, { id: "1K", base: 1024 }], "1:1", "1K"),
        media_slots: [],
        custom_fields,
    };
}

function openrouterImage(id: string, providerModelId: string, label: string, sortKey: number, mode: "image-model" | "language-image", refImages = false): ImageModelCapability {
    return {
        ...BASE,
        id,
        label,
        family: "OpenRouter",
        variant: "Unified Router",
        group: "OpenRouter",
        category: refImages ? "Generate / Edit" : "Generate",
        provider: "openrouter",
        provider_model_id: providerModelId,
        provider_mode: mode,
        has_edit_variant: false,
        seed: mode === "image-model" ? seedRange : false,
        sort_key: sortKey,
        aspect_ratio: tupleRatios(RATIOS_STANDARD),
        media_slots: refImages ? [{ id: "reference_images", label: "Reference images", kind: "image", multiple: true, max_count: 4 }] : [],
        custom_fields: mode === "image-model"
            ? [{ id: "n", label: "Number of outputs", type: "number", minimum: 1, maximum: 4, step: 1, default: 1 }]
            : [],
    };
}

function ollamaImage(id: string, providerModelId: string, label: string, sortKey: number, defaultSteps: number): ImageModelCapability {
    return {
        ...BASE,
        id,
        label,
        family: "Ollama Local",
        variant: "Local Unlimited",
        group: "Ollama",
        category: "Generate",
        provider: "ollama",
        provider_model_id: providerModelId,
        provider_mode: "image-model",
        has_edit_variant: false,
        negative_prompt: true,
        seed: seedRange,
        sort_key: sortKey,
        size_ui: ratioUi(["1:1", "16:9", "9:16", "4:3", "3:4"], [{ id: "512", base: 512 }, { id: "768", base: 768 }, { id: "1K", base: 1024 }], "1:1", "1K"),
        media_slots: [],
        custom_fields: [
            { id: "steps", label: "Steps", type: "number", minimum: 1, maximum: 50, step: 1, default: defaultSteps },
        ],
    };
}

export const FREE_PROVIDER_IMAGE_CAPABILITIES: Record<string, ImageModelCapability> = {
    // Pollinations (keyless or keyed free tier)
    pollinations__flux: pollinationsImage("flux", "FLUX.1 Schnell (Pollinations)", 9600),
    pollinations__zimage: pollinationsImage("zimage", "Z-Image Turbo (Pollinations)", 9580),
    pollinations__klein: pollinationsImage("klein", "FLUX.2 Klein 4B (Pollinations)", 9560, { refImages: true }),
    pollinations__turbo: pollinationsImage("turbo", "SDXL Turbo (Pollinations)", 9540),
    pollinations__gptimage: pollinationsImage("gptimage", "GPT Image 1 Mini (Pollinations)", 9520, { refImages: true, gpt: true }),

    // Together AI (explicit FLUX.1-schnell-Free 10/min free tier)
    together__flux_1_schnell_free: togetherImage("together__flux_1_schnell_free", "black-forest-labs/FLUX.1-schnell-Free", "FLUX.1 Schnell Free (Together)", 9400, 4, 4),
    together__flux_1_dev: togetherImage("together__flux_1_dev", "black-forest-labs/FLUX.1-dev", "FLUX.1 Dev (Together)", 9380, 28, 50, true),
    together__flux_1_1_pro: togetherImage("together__flux_1_1_pro", "black-forest-labs/FLUX.1.1-pro", "FLUX 1.1 Pro (Together)", 9360, 24, 50),

    // Cloudflare Workers AI (10,000 free Neurons/day)
    cloudflare__flux_1_schnell: cloudflareImage("cloudflare__flux_1_schnell", "@cf/black-forest-labs/flux-1-schnell", "FLUX.1 Schnell (Cloudflare)", 9300, 4, 8, true),
    cloudflare__sdxl_lightning: cloudflareImage("cloudflare__sdxl_lightning", "@cf/bytedance/stable-diffusion-xl-lightning", "SDXL Lightning (Cloudflare)", 9280, 4, 20),
    cloudflare__sdxl_base: cloudflareImage("cloudflare__sdxl_base", "@cf/stabilityai/stable-diffusion-xl-base-1.0", "SDXL 1.0 Base (Cloudflare)", 9260, 20, 20),
    cloudflare__dreamshaper_8_lcm: cloudflareImage("cloudflare__dreamshaper_8_lcm", "@cf/lykon/dreamshaper-8-lcm", "DreamShaper 8 LCM (Cloudflare)", 9240, 8, 20),

    // Hugging Face Inference Providers ($0.10/mo free credits)
    huggingface__flux_1_schnell: hfImage("huggingface__flux_1_schnell", "black-forest-labs/FLUX.1-schnell", "FLUX.1 Schnell (Hugging Face)", 9200, 4, 8),
    huggingface__flux_1_dev: hfImage("huggingface__flux_1_dev", "black-forest-labs/FLUX.1-dev", "FLUX.1 Dev (Hugging Face)", 9180, 28, 50, 3.5),
    huggingface__sd_3_5_large: hfImage("huggingface__sd_3_5_large", "stabilityai/stable-diffusion-3.5-large", "Stable Diffusion 3.5 Large (HF)", 9160, 28, 50, 4.5),
    huggingface__sdxl_base: hfImage("huggingface__sdxl_base", "stabilityai/stable-diffusion-xl-base-1.0", "Stable Diffusion XL 1.0 (HF)", 9140, 25, 50, 7.5),

    // Ollama Local (unlimited local hardware inference)
    ollama__z_image_turbo: ollamaImage("ollama__z_image_turbo", "x/z-image-turbo", "Z-Image Turbo (Ollama)", 9100, 9),
    ollama__flux2_klein_4b: ollamaImage("ollama__flux2_klein_4b", "x/flux2-klein:4b", "FLUX.2 Klein 4B (Ollama)", 9080, 4),
    ollama__flux2_klein_9b: ollamaImage("ollama__flux2_klein_9b", "x/flux2-klein:9b", "FLUX.2 Klein 9B (Ollama)", 9060, 4),

    // OpenRouter Unified Images
    openrouter__seedream_4_5: openrouterImage("openrouter__seedream_4_5", "bytedance-seed/seedream-4.5", "Seedream 4.5 (OpenRouter)", 9020, "image-model"),
    openrouter__gemini_2_5_flash_image: openrouterImage("openrouter__gemini_2_5_flash_image", "google/gemini-2.5-flash-image", "Gemini 2.5 Flash Image (OpenRouter)", 9010, "language-image", true),
    openrouter__flux_2_pro: openrouterImage("openrouter__flux_2_pro", "black-forest-labs/flux.2-pro", "FLUX.2 Pro (OpenRouter)", 9000, "image-model", true),
    openrouter__gpt_image_1: openrouterImage("openrouter__gpt_image_1", "openai/gpt-image-1", "GPT Image 1 (OpenRouter)", 8990, "image-model"),
};

export const FREE_PROVIDER_VIDEO_CAPABILITIES: Record<string, ModelCapabilities> = {
    // Pollinations Video (free/keyed tier)
    pollinations__video__veo: pollinationsVideo("veo", "Veo 3.1 Fast (Pollinations)", 9600, ["4", "6", "8"], true),
    pollinations__video__seedance: pollinationsVideo("seedance", "Seedance Lite (Pollinations)", 9580, ["4", "5", "6", "8"], false),
    pollinations__video__wan: pollinationsVideo("wan", "Wan 2.6 Video (Pollinations)", 9560, ["5", "8"], true),
    pollinations__video__ltx_video: pollinationsVideo("ltx-video", "LTX-2 Video (Pollinations)", 9540, ["5", "6", "8"], false),
    pollinations__video__grok_video: pollinationsVideo("grok-video", "Grok Video (Pollinations)", 9520, ["5", "6"], false),

    // Hugging Face Video
    huggingface__wan_2_1_t2v: hfVideo("huggingface__wan_2_1_t2v", "Wan-AI/Wan2.1-T2V-14B", "Wan 2.1 T2V 14B (Hugging Face)", 9200),
    huggingface__wan_2_2_ti2v: hfVideo("huggingface__wan_2_2_ti2v", "Wan-AI/Wan2.2-TI2V-5B", "Wan 2.2 TI2V 5B (Hugging Face)", 9180),
    huggingface__hunyuan_video: hfVideo("huggingface__hunyuan_video", "tencent/HunyuanVideo", "HunyuanVideo (Hugging Face)", 9160),

    // Together AI Video
    together__wan_2_2_t2v: togetherVideo("together__wan_2_2_t2v", "Wan-AI/Wan2.2-T2V-A14B", "Wan 2.2 T2V A14B (Together)", 9300),
    together__kling_1_6_standard: togetherVideo("together__kling_1_6_standard", "kwaivgi/kling-1.6-standard", "Kling 1.6 Standard (Together)", 9280),
    together__minimax_video_01: togetherVideo("together__minimax_video_01", "minimax/video-01-director", "MiniMax Video-01 (Together)", 9260),
};
