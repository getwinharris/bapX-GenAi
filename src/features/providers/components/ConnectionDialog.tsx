"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Eye, EyeOff, ExternalLink, KeyRound, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import type { ProviderConnectionRecord } from "@/providers/config-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { configRequest, providerErrorMessage } from "../lib/api";
import { fieldClass } from "./styles";
import type { ProviderDefinition } from "../types";

export function ConnectionDialog({ provider, connection, onClose, onSaved, returnFocus }: {
    returnFocus: React.RefObject<HTMLElement | null>;
    provider: ProviderDefinition;
    connection?: ProviderConnectionRecord;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const t = useTranslations("providers");
    const common = useTranslations("common");
    const [label, setLabel] = useState(connection?.label ?? (provider.secretOptional ? `${provider.label} Free` : ""));
    const [secret, setSecret] = useState("");
    const [clearSecret, setClearSecret] = useState(false);
    const [showSecret, setShowSecret] = useState(false);
    const [project, setProject] = useState(String(connection?.metadata?.project ?? ""));
    const [location, setLocation] = useState(String(connection?.metadata?.location ?? "global"));
    const [veoLocation, setVeoLocation] = useState(String(connection?.metadata?.veoLocation ?? "us-central1"));
    const [baseUrl, setBaseUrl] = useState(String(connection?.metadata?.baseUrl ?? provider.defaultBaseUrl ?? ""));
    const [accountId, setAccountId] = useState(String(connection?.metadata?.accountId ?? ""));
    const [priority, setPriority] = useState(connection?.priority ?? 100);
    const [error, setError] = useState("");
    const [statusMessage, setStatusMessage] = useState("");
    const [saving, setSaving] = useState<"save" | "verify" | false>(false);

    const serviceAccount = provider.secretKind === "google-service-account";
    const secretOptional = Boolean(provider.secretOptional);
    const secretRequired = !connection && !secretOptional;

    async function persist(verifyAfterSave: boolean) {
        setError("");
        setStatusMessage("");
        let account: Record<string, unknown> | undefined;
        if (serviceAccount && secret.trim()) {
            try {
                account = JSON.parse(secret);
                if (!account || typeof account !== "object" || Array.isArray(account)) throw new Error();
            } catch {
                setError(t("invalidCredentials"));
                return;
            }
        }
        setSaving(verifyAfterSave ? "verify" : "save");
        try {
            const metadata: Record<string, unknown> = { ...connection?.metadata };
            if (serviceAccount) {
                metadata.project = project.trim() || account?.project_id;
                metadata.location = location.trim();
                metadata.veoLocation = veoLocation.trim();
            }
            if (provider.supportsBaseUrl && baseUrl.trim()) {
                metadata.baseUrl = baseUrl.trim();
            }
            if (provider.requiresAccountId) {
                metadata.accountId = accountId.trim();
            }

            const saved = await configRequest<{ connection: ProviderConnectionRecord }>(
                connection ? `/api/providers/${encodeURIComponent(connection.id)}` : "/api/providers",
                connection ? "PATCH" : "POST",
                {
                    providerId: provider.id,
                    label: label.trim() || `${provider.label}`,
                    ...(secret.trim() ? { secret: secret.trim() } : {}),
                    ...(clearSecret && secretOptional ? { clearSecret: true } : {}),
                    metadata,
                    priority,
                },
            );

            if (verifyAfterSave && provider.supportsVerify && saved?.connection?.id) {
                const testResult = await configRequest<{ status?: string; quotaSummary?: string }>(
                    `/api/providers/${encodeURIComponent(saved.connection.id)}/test`,
                    "POST",
                );
                void onSaved().catch(() => undefined);
                if (testResult.status === "healthy") {
                    setStatusMessage(testResult.quotaSummary ? `${t("testSuccess")} · ${testResult.quotaSummary}` : t("testSuccess"));
                    onClose();
                    return;
                }
            }

            onClose();
            void onSaved().catch(() => undefined);
        } catch (failure) {
            setError(providerErrorMessage(failure, t));
            void onSaved().catch(() => undefined);
        } finally {
            setSaving(false);
        }
    }

    function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        void persist(false);
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
            <DialogContent
                finalFocus={returnFocus}
                closeLabel={common("close")}
                showCloseButton={!saving}
                className="max-h-[90dvh] overflow-y-auto bg-[#141618] p-5 sm:max-w-lg sm:p-6"
            >
                <div className="flex items-start justify-between gap-4 pr-6">
                    <div>
                        <DialogTitle className="text-xl leading-snug">{t(connection ? "editConnection" : "addConnection")}</DialogTitle>
                        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
                            {provider.label} <span aria-hidden="true">·</span> {provider.freeTier.headline}
                        </DialogDescription>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
                    {statusMessage && (
                        <p role="status" className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm text-primary">
                            <CheckCircle2 className="size-4 shrink-0" />
                            <span>{statusMessage}</span>
                        </p>
                    )}

                    <label className="block space-y-2">
                        <span className="text-sm font-medium">{t("name")}</span>
                        <input
                            autoFocus
                            required
                            maxLength={120}
                            value={label}
                            onChange={(event) => setLabel(event.target.value)}
                            placeholder={t("namePlaceholder")}
                            className={fieldClass}
                        />
                    </label>

                    {provider.requiresAccountId && (
                        <label className="block space-y-2">
                            <span className="text-sm font-medium">{t("accountId")}</span>
                            <input
                                required
                                value={accountId}
                                onChange={(event) => setAccountId(event.target.value)}
                                placeholder={t("accountIdPlaceholder")}
                                className={`${fieldClass} font-mono text-xs`}
                            />
                            <span className="block text-xs text-muted-foreground">{t("accountIdHint")}</span>
                        </label>
                    )}

                    {provider.supportsBaseUrl && (
                        <div className="space-y-2">
                            <label className="block space-y-2">
                                <span className="text-sm font-medium">{t("baseUrl")}</span>
                                <input
                                    type="url"
                                    required={provider.id === "ollama"}
                                    value={baseUrl}
                                    onChange={(event) => setBaseUrl(event.target.value)}
                                    placeholder={provider.defaultBaseUrl ?? "https://..."}
                                    className={`${fieldClass} font-mono text-xs`}
                                />
                            </label>
                            {provider.id === "ollama" && (
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <button
                                        type="button"
                                        onClick={() => setBaseUrl("http://127.0.0.1:11434")}
                                        className="rounded-lg border border-white/10 px-2.5 py-1.5 text-muted-foreground hover:border-primary/40 hover:text-foreground whitespace-nowrap shrink-0"
                                    >
                                        {t("ollamaLocalPreset")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBaseUrl("https://ollama.com")}
                                        className="rounded-lg border border-white/10 px-2.5 py-1.5 text-muted-foreground hover:border-primary/40 hover:text-foreground whitespace-nowrap shrink-0"
                                    >
                                        {t("ollamaCloudPreset")}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <label htmlFor="connection-secret-input" className="text-sm font-medium">
                                {t(serviceAccount ? "serviceAccount" : secretOptional ? "apiKeyOptional" : "apiKey")}
                            </label>
                            <a
                                href={provider.apiKeyUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline whitespace-nowrap shrink-0"
                            >
                                <KeyRound className="size-3" />
                                {t("getKey")}
                                <ExternalLink className="size-3" />
                            </a>
                        </div>

                        {serviceAccount ? (
                            <textarea
                                id="connection-secret-input"
                                required={secretRequired}
                                aria-describedby="connection-key-help"
                                value={secret}
                                onChange={(event) => setSecret(event.target.value)}
                                placeholder={connection ? t("keySaved") : '{"type": "service_account", ...}'}
                                spellCheck={false}
                                className={`${fieldClass} h-32 py-3 font-mono text-xs`}
                            />
                        ) : (
                            <input
                                id="connection-secret-input"
                                type={showSecret ? "text" : "password"}
                                required={secretRequired}
                                disabled={clearSecret}
                                aria-describedby="connection-key-help"
                                autoComplete="new-password"
                                value={secret}
                                onChange={(event) => { setSecret(event.target.value); setClearSecret(false); }}
                                placeholder={clearSecret ? t("keylessActive") : t(connection?.secretConfigured ? "keySaved" : secretOptional ? "keyPlaceholderOptional" : "keyPlaceholder")}
                                className={fieldClass}
                            />
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p id="connection-key-help" className="text-xs text-muted-foreground">
                                {connection?.secretConfigured ? t("keepKey") : secretOptional ? t("keyHintOptional") : t("keyHint")}
                            </p>
                            {!serviceAccount && (
                                <button
                                    type="button"
                                    aria-label={t(showSecret ? "hideKey" : "showKey")}
                                    onClick={() => setShowSecret(!showSecret)}
                                    className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0"
                                >
                                    {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                                    {t(showSecret ? "hideKey" : "showKey")}
                                </button>
                            )}
                        </div>

                        {connection?.secretConfigured && secretOptional && (
                            <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                                <input
                                    type="checkbox"
                                    checked={clearSecret}
                                    onChange={(event) => {
                                        setClearSecret(event.target.checked);
                                        if (event.target.checked) setSecret("");
                                    }}
                                    className="size-4 accent-[#d5ff47]"
                                />
                                <span>{t("clearStoredKey")}</span>
                            </label>
                        )}
                    </div>

                    {serviceAccount && (
                        <div className="space-y-4 rounded-xl border border-white/10 p-4">
                            <label className="block space-y-2">
                                <span className="text-sm font-medium">{t("project")}</span>
                                <input value={project} onChange={(event) => setProject(event.target.value)} placeholder={t("projectPlaceholder")} className={fieldClass} />
                            </label>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="space-y-2">
                                    <span className="text-xs text-muted-foreground">{t("location")}</span>
                                    <input required value={location} onChange={(event) => setLocation(event.target.value)} className={fieldClass} />
                                </label>
                                <label className="space-y-2">
                                    <span className="text-xs text-muted-foreground">{t("veoLocation")}</span>
                                    <input required value={veoLocation} onChange={(event) => setVeoLocation(event.target.value)} className={fieldClass} />
                                </label>
                            </div>
                            <p className="text-xs leading-relaxed text-muted-foreground">{t("locationHint")}</p>
                        </div>
                    )}

                    <details className="rounded-xl border border-white/10 p-3">
                        <summary className="cursor-pointer rounded-md text-sm font-medium text-muted-foreground">{t("settings")}</summary>
                        <label className="mt-4 block space-y-2">
                            <span className="text-sm font-medium">{t("priority")}</span>
                            <input
                                type="number"
                                aria-label={t("priority")}
                                aria-describedby="connection-priority-help"
                                min={0}
                                max={10000}
                                step={1}
                                required
                                value={priority}
                                onChange={(event) => setPriority(Number(event.target.value))}
                                className={fieldClass}
                            />
                            <span id="connection-priority-help" className="block text-xs leading-relaxed text-muted-foreground">{t("priorityHint")}</span>
                        </label>
                    </details>

                    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                        <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        {t("secureHint")}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                        <a
                            href={provider.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0"
                        >
                            {t("docs")}
                            <ExternalLink className="size-3" />
                            <span className="sr-only">({t("external")})</span>
                        </a>
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="ghost" onClick={onClose} disabled={Boolean(saving)}>{t("cancel")}</Button>
                            {provider.supportsVerify && (
                                <Button type="button" variant="secondary" disabled={Boolean(saving)} onClick={() => void persist(true)}>
                                    {saving === "verify" ? <Loader2 className="animate-spin" /> : <ShieldCheck className="size-4" />}
                                    {t("saveAndVerify")}
                                </Button>
                            )}
                            <Button type="submit" disabled={Boolean(saving)}>
                                {saving === "save" && <Loader2 className="animate-spin" />}
                                {t(saving === "save" ? "saving" : "save")}
                            </Button>
                        </div>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
