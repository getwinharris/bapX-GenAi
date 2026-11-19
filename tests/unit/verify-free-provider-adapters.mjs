import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createModuleLoader } from "../../scripts/test-module-loader.mjs";

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MP4_HEADER = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

function makeReq(overrides) {
    return {
        mediaType: overrides.mediaType ?? "image",
        modelId: overrides.modelId ?? "test_model",
        providerModelId: overrides.providerModelId ?? "test",
        capabilities: {},
        params: {
            prompt: overrides.prompt ?? "a crisp alpine peak at sunrise",
            ...(overrides.params ?? {}),
        },
        media: overrides.media ?? {},
        connection: overrides.connection,
        providerMode: overrides.providerMode,
    };
}

test("free provider adapters dispatch documented requests and normalize image/video outputs", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-free-adapters-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    let mockFetch = async () => { throw new Error("Unstubbed fetch"); };
    const loader = createModuleLoader({
        env: {
            OPEN_HIGGSFIELD_STORAGE_DIR: dir,
            PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-provider-config-key-32-characters",
        },
        globals: {
            fetch: (...args) => mockFetch(...args),
        },
    });
    const registry = loader.load("src/server/providers/registry.ts");
    const store = loader.load("src/server/config/provider-store.ts");

    const seen = [];

    // 1. Pollinations (keyless image & video)
    mockFetch = async (url, init) => {
        seen.push({ url: String(url), method: init?.method ?? "GET" });
        if (String(url).includes("/video/")) {
            return new Response(MP4_HEADER, { status: 200, headers: { "content-type": "video/mp4" } });
        }
        return new Response(PNG_HEADER, { status: 200, headers: { "content-type": "image/png" } });
    };
    const pollConn = await store.saveProviderConnection({ providerId: "pollinations", label: "Pollinations Free" });
    const pollCtx = await store.resolveProviderConnection("pollinations");
    const pollAdapter = registry.getProvider("pollinations");
    const pollImg = await pollAdapter.submit(makeReq({
        mediaType: "image",
        modelId: "pollinations__flux",
        providerModelId: "flux",
        prompt: "neon owl",
        params: { aspect_ratio: "16:9", seed: 7 },
        connection: pollCtx,
    }));
    assert.equal(pollImg.status, "COMPLETED");
    assert.equal(pollImg.assets[0].mimeType, "image/png");
    assert.ok(seen.at(-1).url.startsWith("https://gen.pollinations.ai/image/neon%20owl"));

    const pollVid = await pollAdapter.submit(makeReq({
        mediaType: "video",
        modelId: "pollinations__video__veo",
        providerModelId: "veo",
        prompt: "flying bird",
        params: { duration: "4" },
        connection: pollCtx,
    }));
    assert.equal(pollVid.status, "COMPLETED");
    assert.equal(pollVid.assets[0].mimeType, "video/mp4");
    assert.ok(pollConn.id.startsWith("conn_"));

    // 2. Hugging Face router
    mockFetch = async (url, init) => {
        seen.push({ url: String(url), method: init?.method });
        return new Response(PNG_HEADER, { status: 200, headers: { "content-type": "image/png" } });
    };
    const hfAdapter = registry.getProvider("huggingface");
    const hfRes = await hfAdapter.submit(makeReq({
        mediaType: "image",
        modelId: "huggingface__flux_1_schnell",
        providerModelId: "black-forest-labs/FLUX.1-schnell",
        prompt: "castle",
        params: { field_values: { steps: 4 } },
        connection: { id: "c_hf", providerId: "huggingface", secret: "hf_test_tok", metadata: {} },
    }));
    assert.equal(hfRes.status, "COMPLETED");
    assert.ok(seen.at(-1).url.includes("https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell"));

    // 3. Cloudflare Workers AI JSON base64 response
    mockFetch = async (url) => {
        seen.push({ url: String(url) });
        return new Response(JSON.stringify({ result: { image: Buffer.from(PNG_HEADER).toString("base64") } }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    const cfAdapter = registry.getProvider("cloudflare");
    const cfRes = await cfAdapter.submit(makeReq({
        mediaType: "image",
        modelId: "cloudflare__flux_1_schnell",
        providerModelId: "@cf/black-forest-labs/flux-1-schnell",
        prompt: "sunset",
        params: { field_values: { steps: 4 } },
        connection: { id: "c_cf", providerId: "cloudflare", secret: "cf_tok", metadata: { accountId: "a1b2c3d4e5f60718293a4b5c6d7e8f90" } },
    }));
    assert.equal(cfRes.status, "COMPLETED");
    assert.ok(seen.at(-1).url.includes("/accounts/a1b2c3d4e5f60718293a4b5c6d7e8f90/ai/run/@cf/black-forest-labs/flux-1-schnell"));

    // 4. Together AI image + async video polling
    mockFetch = async (url, init) => {
        const u = String(url);
        if (u.endsWith("/v1/images/generations")) {
            return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG_HEADER).toString("base64") }] }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        if (u.endsWith("/v1/videos") && init?.method === "POST") {
            return new Response(JSON.stringify({ id: "tog_vid_123", status: "queued" }), {
                status: 202,
                headers: { "content-type": "application/json" },
            });
        }
        if (u.endsWith("/v1/videos/tog_vid_123")) {
            return new Response(JSON.stringify({ id: "tog_vid_123", status: "completed", outputs: { video_url: "https://cdn.together.xyz/out.mp4" } }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        throw new Error(`Unexpected Together URL: ${u}`);
    };
    const togAdapter = registry.getProvider("together");
    const togConn = { id: "c_tog", providerId: "together", secret: "tog_tok", metadata: {} };
    const togImg = await togAdapter.submit(makeReq({
        mediaType: "image",
        modelId: "together__flux_1_schnell_free",
        providerModelId: "black-forest-labs/FLUX.1-schnell-Free",
        prompt: "robot",
        params: { field_values: { steps: 4 } },
        connection: togConn,
    }));
    assert.equal(togImg.status, "COMPLETED");
    const togVidSub = await togAdapter.submit(makeReq({
        mediaType: "video",
        modelId: "together__wan_2_2_t2v",
        providerModelId: "Wan-AI/Wan2.2-T2V-A14B",
        prompt: "waves",
        connection: togConn,
    }));
    assert.equal(togVidSub.status, "IN_PROGRESS");
    const togPoll = await togAdapter.poll({
        mediaType: "video",
        providerModelId: "Wan-AI/Wan2.2-T2V-A14B",
        operation: togVidSub.operation,
        connection: togConn,
    });
    assert.equal(togPoll.status, "COMPLETED");
    assert.equal(togPoll.assets[0].url, "https://cdn.together.xyz/out.mp4");

    // 5. OpenRouter chat multimodal image-output
    mockFetch = async (url) => {
        const u = String(url);
        if (u.endsWith("/api/v1/chat/completions")) {
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        images: [{ image_url: { url: `data:image/png;base64,${Buffer.from(PNG_HEADER).toString("base64")}` } }],
                    },
                }],
            }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG_HEADER).toString("base64") }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    const orAdapter = registry.getProvider("openrouter");
    const orConn = { id: "c_or", providerId: "openrouter", secret: "or_tok", metadata: {} };
    const orChat = await orAdapter.submit(makeReq({
        mediaType: "image",
        modelId: "openrouter__gemini_2_5_flash_image",
        providerModelId: "google/gemini-2.5-flash-image",
        providerMode: "language-image",
        prompt: "editorial portrait",
        params: { aspect_ratio: "16:9" },
        connection: orConn,
    }));
    assert.equal(orChat.status, "COMPLETED");
    assert.equal(orChat.assets[0].mimeType, "image/png");

    // 6. Ollama local endpoint
    mockFetch = async (url) => {
        seen.push({ url: String(url) });
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG_HEADER).toString("base64") }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    const olAdapter = registry.getProvider("ollama");
    const olRes = await olAdapter.submit(makeReq({
        mediaType: "image",
        modelId: "ollama__z_image_turbo",
        providerModelId: "x/z-image-turbo",
        prompt: "sketch",
        params: { field_values: { steps: 9 } },
        connection: { id: "c_ol", providerId: "ollama", metadata: { baseUrl: "http://127.0.0.1:11434" } },
    }));
    assert.equal(olRes.status, "COMPLETED");
    assert.equal(seen.at(-1).url, "http://127.0.0.1:11434/v1/images/generations");
});
