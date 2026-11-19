"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, ArrowUpRight, CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import type { ProviderConnectionRecord } from "@/providers/config-types";
import { PROVIDER_DEFINITIONS, type ProviderDefinition } from "@/providers/definitions";
import { filterProviderDefinitions } from "@/lib/provider-helpers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ConnectionDialog } from "./ConnectionDialog";
import { ProviderMark } from "./ProviderMark";
import { configRequest, providerErrorMessage } from "../lib/api";

interface ProvidersApiPayload {
    providers: ProviderDefinition[];
    connections: ProviderConnectionRecord[];
    connectedProviderIds?: string[];
    environmentProviderIds?: string[];
}

export function CredentialsDrawer({
    open,
    onClose,
    returnFocus,
}: {
    open: boolean;
    onClose: () => void;
    returnFocus: React.RefObject<HTMLElement | null>;
}) {
    const t = useTranslations("providers");
    const common = useTranslations("common");
    const locale = useLocale();
    const { mutate: mutateCache } = useSWRConfig();
    const [tab, setTab] = useState<"free" | "all">("free");
    const [editing, setEditing] = useState<{ provider: ProviderDefinition; connection?: ProviderConnectionRecord } | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
    const triggerRef = useRef<HTMLElement | null>(null);

    const { data, error, isLoading, mutate } = useSWR(open ? "/api/providers" : null, (url: string) =>
        configRequest<ProvidersApiPayload>(url),
    );

    const providers = data?.providers ?? [...PROVIDER_DEFINITIONS];
    const connections = data?.connections ?? [];
    const connected = new Set(
        data?.connectedProviderIds ?? connections.filter((c) => c.enabled && c.secretConfigured).map((c) => c.providerId),
    );
    const visibleProviders = filterProviderDefinitions(
        providers,
        connections,
        connected,
        tab === "free" ? "free" : "all",
        "",
        (id) => t(`descriptions.${id}`),
    );

    async function revalidateAll() {
        await Promise.all([
            mutate(),
            mutateCache("provider-settings", undefined, { revalidate: true }),
            mutateCache("/api/providers", undefined, { revalidate: true }),
            mutateCache("/api/image-models", undefined, { revalidate: true }),
            mutateCache("/api/models", undefined, { revalidate: true }),
        ]);
    }

    async function quickEnableFree(provider: ProviderDefinition) {
        setBusy(provider.id);
        setNotice(null);
        try {
            const metadata = provider.id === "ollama" ? { baseUrl: provider.defaultBaseUrl ?? "http://127.0.0.1:11434" } : {};
            const created = await configRequest<{ connection: ProviderConnectionRecord }>("/api/providers", "POST", {
                providerId: provider.id,
                label: `${provider.label} Free`,
                metadata,
                enabled: true,
                priority: 100,
            });
            await revalidateAll();
            setNotice({ error: false, text: t("quickFreeConnected", { provider: provider.label }) });
            if (provider.supportsVerify && created?.connection?.id) {
                void configRequest(`/api/providers/${encodeURIComponent(created.connection.id)}/test`, "POST")
                    .then(() => revalidateAll())
                    .catch(() => undefined);
            }
        } catch (failure) {
            setNotice({ error: true, text: providerErrorMessage(failure, t, "saveError") });
        } finally {
            setBusy(null);
        }
    }

    async function toggleConnection(connection: ProviderConnectionRecord, enabled: boolean) {
        setBusy(connection.id);
        setNotice(null);
        try {
            await configRequest(`/api/providers/${encodeURIComponent(connection.id)}`, "PATCH", { enabled });
            await revalidateAll();
        } catch (failure) {
            setNotice({ error: true, text: providerErrorMessage(failure, t, "saveError") });
        } finally {
            setBusy(null);
        }
    }

    async function verifyConnection(connection: ProviderConnectionRecord) {
        setBusy(`test:${connection.id}`);
        setNotice(null);
        try {
            const res = await configRequest<{ status?: string; quotaSummary?: string }>(
                `/api/providers/${encodeURIComponent(connection.id)}/test`,
                "POST",
            );
            await revalidateAll();
            const base = t(res.status === "healthy" ? "testSuccess" : "unsupportedTest");
            setNotice({ error: false, text: res.quotaSummary ? `${base} · ${res.quotaSummary}` : base });
        } catch (failure) {
            setNotice({ error: true, text: providerErrorMessage(failure, t, "testFailure") });
        } finally {
            setBusy(null);
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={(next) => { if (!next && !editing) onClose(); }}>
                <DialogContent
                    finalFocus={returnFocus}
                    closeLabel={common("close")}
                    className="flex max-h-[85dvh] flex-col overflow-hidden bg-[#111315] p-0 sm:max-w-2xl"
                >
                    <div className="shrink-0 border-b border-white/10 px-5 py-4 pr-12 sm:px-6">
                        <DialogTitle className="text-lg font-semibold tracking-tight">{t("drawerTitle")}</DialogTitle>
                        <DialogDescription className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {t("drawerSubtitle")}
                        </DialogDescription>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <div role="tablist" aria-label={t("filterGroupLabel")} className="inline-flex rounded-xl bg-white/[.04] p-0.5">
                                {(["free", "all"] as const).map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        role="tab"
                                        aria-selected={tab === mode}
                                        onClick={() => setTab(mode)}
                                        className={`min-h-8 rounded-[10px] px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                                            tab === mode ? "bg-white/[.12] text-white" : "text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {t(mode === "free" ? "filterFree" : "filterAll")}
                                    </button>
                                ))}
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground">
                                {t("connectedCount", { count: connected.size, total: providers.length })}
                            </span>
                        </div>
                    </div>

                    <div className="model-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 pb-6 sm:px-6">
                        {error && (
                            <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">
                                <AlertCircle className="size-4 shrink-0" />
                                <span>{providerErrorMessage(error, t, "loadError")}</span>
                            </div>
                        )}
                        {notice && (
                            <div
                                role={notice.error ? "alert" : "status"}
                                className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
                                    notice.error ? "border-destructive/25 bg-destructive/10 text-destructive" : "border-primary/20 bg-primary/5 text-primary"
                                }`}
                            >
                                {notice.error ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
                                <span>{notice.text}</span>
                            </div>
                        )}
                        {isLoading && !data ? (
                            <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                                <Loader2 className="size-4 animate-spin" />
                                {t("loading")}
                            </div>
                        ) : (
                            <div className="divide-y divide-white/[.08] rounded-2xl border border-white/10 bg-[#0d0f10]">
                                {visibleProviders.map((provider) => {
                                    const saved = connections.filter((c) => c.providerId === provider.id);
                                    const primary = saved.find((c) => c.enabled) ?? saved[0];
                                    const isReady = connected.has(provider.id);
                                    const isEnv = Boolean(data?.environmentProviderIds?.includes(provider.id));
                                    return (
                                        <div key={provider.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex min-w-0 items-start gap-3">
                                                <ProviderMark id={provider.id} />
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                        <span className="text-sm font-semibold text-foreground">{provider.label}</span>
                                                        <span className={`text-xs font-medium ${isReady ? "text-primary" : "text-muted-foreground"}`}>
                                                            <span aria-hidden="true">· </span>
                                                            {t(isReady ? "connected" : saved.length ? "paused" : "disconnected")}
                                                        </span>
                                                    </div>
                                                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                                                        {provider.freeTier.headline}
                                                    </p>
                                                    <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground/80">
                                                        {primary?.lastQuotaSummary ?? `${provider.freeTier.rateLimit} · ${provider.freeTier.resetCadence}`}
                                                    </p>
                                                    {isEnv && saved.length === 0 && (
                                                        <p className="mt-0.5 text-[11px] text-primary/90">{t("environment")}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                                {provider.secretOptional && saved.length === 0 && (
                                                    <Button
                                                        size="sm"
                                                        variant="default"
                                                        disabled={busy !== null}
                                                        onClick={() => void quickEnableFree(provider)}
                                                        className="whitespace-nowrap"
                                                    >
                                                        {busy === provider.id ? <Loader2 className="animate-spin" /> : <Sparkles className="size-3.5" />}
                                                        {t("quickEnableFree")}
                                                    </Button>
                                                )}
                                                {primary && (
                                                    <>
                                                        {provider.supportsVerify && primary.enabled && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={busy !== null}
                                                                onClick={() => void verifyConnection(primary)}
                                                                className="whitespace-nowrap"
                                                            >
                                                                {busy === `test:${primary.id}` ? <Loader2 className="animate-spin" /> : <ShieldCheck className="size-3.5" />}
                                                                {t("test")}
                                                            </Button>
                                                        )}
                                                        <Switch
                                                            aria-label={t("enableName", { name: primary.label })}
                                                            checked={primary.enabled}
                                                            onCheckedChange={(val) => void toggleConnection(primary, val)}
                                                            disabled={busy !== null}
                                                        />
                                                    </>
                                                )}
                                                <Button
                                                    size="sm"
                                                    variant={primary ? "ghost" : "outline"}
                                                    disabled={busy !== null}
                                                    onClick={(event) => {
                                                        triggerRef.current = event.currentTarget;
                                                        setEditing({ provider, connection: primary });
                                                    }}
                                                    className="whitespace-nowrap"
                                                >
                                                    <KeyRound className="size-3.5" />
                                                    {t(primary ? "updateCredentials" : "addCredentials")}
                                                </Button>
                                                <Link
                                                    href={`/${locale}/settings?provider=${encodeURIComponent(provider.id)}`}
                                                    onClick={onClose}
                                                    title={t("manage")}
                                                    aria-label={`${provider.label} · ${t("manage")}`}
                                                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/[.06] hover:text-foreground"
                                                >
                                                    <ArrowUpRight className="size-4" />
                                                </Link>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-3.5 sm:px-6">
                        <Link
                            href={`/${locale}/settings`}
                            onClick={onClose}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline whitespace-nowrap"
                        >
                            {t("openAllSettings")}
                            <ExternalLink className="size-3.5" />
                        </Link>
                        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                            {common("close")}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {editing && (
                <ConnectionDialog
                    returnFocus={triggerRef}
                    provider={editing.provider}
                    connection={editing.connection}
                    onClose={() => setEditing(null)}
                    onSaved={revalidateAll}
                />
            )}
        </>
    );
}
