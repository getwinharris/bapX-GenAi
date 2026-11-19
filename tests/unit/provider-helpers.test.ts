import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDER_DEFINITIONS } from "../../src/providers/definitions";
import {
    buildPollinationsUrl,
    filterProviderDefinitions,
    normalizeOllamaBaseUrl,
    parseBase64DataUrl,
    parseOpenRouterKeyQuota,
    resolveDimensions,
    validateCloudflareAccountId,
} from "../../src/lib/provider-helpers";

test("resolveDimensions prioritizes explicit dimensions, size string, aspect ratio, then fallback", () => {
    assert.deepEqual(resolveDimensions({ width: 1280, height: 720 }), { width: 1280, height: 720 });
    assert.deepEqual(resolveDimensions({ size: "1536x896" }), { width: 1536, height: 896 });
    assert.deepEqual(resolveDimensions({ aspect_ratio: "16:9" }), { width: 1344, height: 768 });
    assert.deepEqual(resolveDimensions({ aspect_ratio: "unknown" }, 768, 768), { width: 768, height: 768 });
});

test("normalizeOllamaBaseUrl validates protocols and strips trailing slashes", () => {
    assert.equal(normalizeOllamaBaseUrl(), "http://127.0.0.1:11434");
    assert.equal(normalizeOllamaBaseUrl("http://localhost:11434///"), "http://localhost:11434");
    assert.equal(normalizeOllamaBaseUrl("https://ollama.com/"), "https://ollama.com");
    assert.throws(() => normalizeOllamaBaseUrl("ftp://localhost:11434"), /ERR_OLLAMA_BASE_URL/);
    assert.throws(() => normalizeOllamaBaseUrl("http://user:pass@localhost:11434"), /ERR_OLLAMA_BASE_URL/);
    assert.throws(() => normalizeOllamaBaseUrl("not-a-url"), /ERR_OLLAMA_BASE_URL/);
});

test("validateCloudflareAccountId enforces safe alphanumeric account format", () => {
    assert.equal(validateCloudflareAccountId("  a1b2c3d4e5f60718293a4b5c6d7e8f90  "), "a1b2c3d4e5f60718293a4b5c6d7e8f90");
    assert.throws(() => validateCloudflareAccountId(""), /ERR_CLOUDFLARE_ACCOUNT_ID_REQUIRED/);
    assert.throws(() => validateCloudflareAccountId("short"), /ERR_CLOUDFLARE_ACCOUNT_ID_REQUIRED/);
    assert.throws(() => validateCloudflareAccountId("../etc/passwd"), /ERR_CLOUDFLARE_ACCOUNT_ID_REQUIRED/);
});

test("parseBase64DataUrl decodes image and video payloads and rejects unsafe/empty inputs", () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const parsed = parseBase64DataUrl(`data:image/png;base64,${pngBytes.toString("base64")}`);
    assert.ok(parsed);
    assert.equal(parsed.mimeType, "image/png");
    assert.deepEqual(Array.from(parsed.data), [0x89, 0x50, 0x4e, 0x47]);

    assert.equal(parseBase64DataUrl("data:text/html;base64,PGgxPkhlbGxvPC9oMT4="), undefined);
    assert.equal(parseBase64DataUrl("data:image/png;base64,"), undefined);
});

test("buildPollinationsUrl constructs image and video endpoints cleanly", () => {
    const imgUrl = buildPollinationsUrl({
        mediaType: "image",
        providerModelId: "flux",
        prompt: "mountain sunrise",
        width: 1024,
        height: 1024,
        seed: 42,
        enhance: true,
        nologo: true,
        imageUrls: ["https://example.com/ref.png"],
    });
    const parsedImg = new URL(imgUrl);
    assert.equal(parsedImg.origin, "https://gen.pollinations.ai");
    assert.ok(parsedImg.pathname.startsWith("/image/mountain"));
    assert.equal(parsedImg.searchParams.get("model"), "flux");
    assert.equal(parsedImg.searchParams.get("width"), "1024");
    assert.equal(parsedImg.searchParams.get("enhance"), "true");
    assert.equal(parsedImg.searchParams.get("nologo"), "true");
    assert.equal(parsedImg.searchParams.get("seed"), "42");
    assert.equal(parsedImg.searchParams.get("image"), "https://example.com/ref.png");

    const vidUrl = buildPollinationsUrl({
        mediaType: "video",
        providerModelId: "veo",
        prompt: "ocean waves",
        duration: "6",
        aspect_ratio: "16:9",
        generate_audio: true,
    });
    const parsedVid = new URL(vidUrl);
    assert.ok(parsedVid.pathname.startsWith("/video/ocean"));
    assert.equal(parsedVid.searchParams.get("duration"), "6");
    assert.equal(parsedVid.searchParams.get("aspectRatio"), "16:9");
    assert.equal(parsedVid.searchParams.get("audio"), "true");
});

test("parseOpenRouterKeyQuota formats free and paid tier usage summaries", () => {
    assert.equal(
        parseOpenRouterKeyQuota({ data: { is_free_tier: true, limit: 5, limit_remaining: 4.75 } }),
        "Free tier (50 req/day :free) · $4.75 / $5.00 left",
    );
    assert.equal(
        parseOpenRouterKeyQuota({ data: { is_free_tier: false, usage: 1.2 } }),
        "Paid tier (1,000 req/day :free) · $1.20 used",
    );
    assert.equal(parseOpenRouterKeyQuota(null), undefined);
});

test("filterProviderDefinitions supports free, local, image, video, connected tabs and search", () => {
    const connections = [
        {
            id: "c1",
            providerId: "pollinations" as const,
            label: "Pollinations Free",
            enabled: true,
            priority: 100,
            secretConfigured: false,
            metadata: {},
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
        },
    ];
    const connected = new Set(["pollinations"]);

    assert.equal(filterProviderDefinitions(PROVIDER_DEFINITIONS, connections, connected, "all", "").length, 12);
    assert.deepEqual(
        filterProviderDefinitions(PROVIDER_DEFINITIONS, connections, connected, "local", "").map((p) => p.id),
        ["ollama"],
    );
    const freeIds = filterProviderDefinitions(PROVIDER_DEFINITIONS, connections, connected, "free", "").map((p) => p.id);
    assert.ok(freeIds.includes("pollinations"));
    assert.ok(freeIds.includes("cloudflare"));
    assert.ok(!freeIds.includes("magnific"));
    assert.deepEqual(
        filterProviderDefinitions(PROVIDER_DEFINITIONS, connections, connected, "connected", "").map((p) => p.id),
        ["pollinations"],
    );
    assert.deepEqual(
        filterProviderDefinitions(PROVIDER_DEFINITIONS, connections, connected, "all", "neurons").map((p) => p.id),
        ["cloudflare"],
    );
});
