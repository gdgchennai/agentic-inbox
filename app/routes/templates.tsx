// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Banner, Button, Input, Loader, Text, useKumoToastManager } from "@cloudflare/kumo";
import {
	CheckIcon,
	CodeIcon,
	CopyIcon,
	ImageIcon,
	PlusIcon,
	SquaresFourIcon,
	TextAaIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import {
	Suspense,
	lazy,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useParams } from "react-router";
import { extractTokenKeys, type TemplatePlaceholder } from "shared/templates";
import RichTextEditor from "~/components/RichTextEditor";

const EmailBuilder = lazy(() => import("~/components/EmailBuilder"));

type BodyMode = "visual" | "html" | "design";
import {
	useCreateTemplate,
	useDeleteTemplate,
	useTemplates,
	useUpdateTemplate,
} from "~/queries/templates";
import api from "~/services/api";
import type { EmailTemplate } from "~/types";

interface DraftState {
	id?: string;
	name: string;
	subject: string;
	body: string;
	placeholders: TemplatePlaceholder[];
}

const EMPTY_DRAFT: DraftState = {
	name: "",
	subject: "",
	body: "",
	placeholders: [],
};

/** Heuristic: body has markup the WYSIWYG editor would mangle. */
function looksLikeRawHtml(body: string): boolean {
	return /<table|<style|<!--|\bstyle=|<head|<body|<!doctype/i.test(body);
}

function toDraft(t: EmailTemplate): DraftState {
	return {
		id: t.id,
		name: t.name,
		subject: t.subject ?? "",
		body: t.body ?? "",
		placeholders: t.placeholders ?? [],
	};
}

export default function TemplatesRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toast = useKumoToastManager();
	const { data: templates, isLoading } = useTemplates(mailboxId);
	const createMutation = useCreateTemplate();
	const updateMutation = useUpdateTemplate();
	const deleteMutation = useDeleteTemplate();

	const [draft, setDraft] = useState<DraftState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [bodyMode, setBodyMode] = useState<BodyMode>("visual");
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	const [copiedId, setCopiedId] = useState<string | null>(null);
	const copyId = async (id: string) => {
		try {
			await navigator.clipboard.writeText(id);
			setCopiedId(id);
			setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
		} catch {
			toast.add({ title: "Couldn't copy to clipboard", variant: "error" });
		}
	};

	const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
	const htmlImageInputRef = useRef<HTMLInputElement>(null);

	const handleImageUpload = useCallback(
		async (file: File) => {
			if (!mailboxId) throw new Error("No mailbox");
			const res = await api.uploadTemplateAsset(mailboxId, file);
			return { url: res.url, assetId: res.id };
		},
		[mailboxId],
	);

	const detectedTokens = useMemo(() => {
		if (!draft) return [];
		return extractTokenKeys({ subject: draft.subject, body: draft.body });
	}, [draft]);

	const missingTokens = useMemo(() => {
		if (!draft) return [];
		const declared = new Set(draft.placeholders.map((p) => p.key));
		return detectedTokens.filter((k) => !declared.has(k));
	}, [draft, detectedTokens]);

	if (!mailboxId) return null;

	const patch = (p: Partial<DraftState>) =>
		setDraft((d) => (d ? { ...d, ...p } : d));

	const setPlaceholder = (i: number, p: Partial<TemplatePlaceholder>) =>
		setDraft((d) =>
			d
				? {
						...d,
						placeholders: d.placeholders.map((row, idx) =>
							idx === i ? { ...row, ...p } : row,
						),
					}
				: d,
		);

	const addPlaceholder = (key = "") =>
		patch({
			placeholders: [
				...(draft?.placeholders ?? []),
				{ key, label: "", type: "text", default: "" },
			],
		});

	const removePlaceholder = (i: number) =>
		patch({
			placeholders: (draft?.placeholders ?? []).filter((_, idx) => idx !== i),
		});

	const insertHtmlAtCursor = (snippet: string) => {
		const current = draft?.body ?? "";
		const ta = bodyTextareaRef.current;
		const start = ta?.selectionStart ?? current.length;
		const end = ta?.selectionEnd ?? current.length;
		patch({ body: current.slice(0, start) + snippet + current.slice(end) });
		requestAnimationFrame(() => {
			const pos = start + snippet.length;
			ta?.focus();
			ta?.setSelectionRange(pos, pos);
		});
	};

	const handleHtmlImageFile = async (file: File | undefined) => {
		if (!file) return;
		try {
			const { url, assetId } = await handleImageUpload(file);
			insertHtmlAtCursor(`<img src="${url}" data-asset-id="${assetId}" alt="">`);
		} catch {
			toast.add({ title: "Image upload failed", variant: "error" });
		}
	};

	const changeBodyMode = (next: BodyMode) => {
		if (next === bodyMode) return;
		if (next === "visual" && /<table|<style|<!--|\bstyle=/i.test(draft?.body ?? "")) {
			if (
				!window.confirm(
					"The visual (rich text) editor may drop table layouts, inline styles, comments, and other raw HTML it doesn't recognize. Switch anyway?",
				)
			) {
				return;
			}
		}
		setBodyMode(next);
	};

	const modeButton = (mode: BodyMode, label: string, icon: ReactNode) => (
		<Button
			type="button"
			variant={bodyMode === mode ? "secondary" : "ghost"}
			size="xs"
			icon={icon}
			onClick={() => changeBodyMode(mode)}
			disabled={mode === "design" && !mounted}
		>
			{label}
		</Button>
	);

	const handleSave = async () => {
		if (!draft) return;
		if (!draft.name.trim()) {
			setError("Template name is required.");
			return;
		}
		setError(null);
		setIsSaving(true);
		const payload = {
			name: draft.name.trim(),
			subject: draft.subject,
			body: draft.body,
			placeholders: draft.placeholders
				.filter((p) => p.key.trim())
				.map((p) => ({ ...p, key: p.key.trim() })),
		};
		try {
			if (draft.id) {
				await updateMutation.mutateAsync({ mailboxId, id: draft.id, data: payload });
			} else {
				await createMutation.mutateAsync({ mailboxId, data: payload });
			}
			toast.add({ title: "Template saved!" });
			setDraft(null);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to save template.";
			setError(msg);
			toast.add({ title: msg, variant: "error" });
		} finally {
			setIsSaving(false);
		}
	};

	const handleDelete = async (id: string, name: string) => {
		if (!window.confirm(`Delete template "${name}"? This cannot be undone.`)) return;
		try {
			await deleteMutation.mutateAsync({ mailboxId, id });
			toast.add({ title: "Template deleted" });
			if (draft?.id === id) setDraft(null);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to delete template.";
			toast.add({ title: msg, variant: "error" });
		}
	};

	return (
		<div className="w-full px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-lg font-semibold text-kumo-default">Templates</h1>
				{!draft && (
					<Button
						variant="primary"
						size="sm"
						icon={<PlusIcon size={14} />}
						onClick={() => {
							setError(null);
							setBodyMode("visual");
							setDraft({ ...EMPTY_DRAFT });
						}}
					>
						New template
					</Button>
				)}
			</div>

			{draft ? (
				<div className="space-y-5">
					{error && <Banner variant="error" text={error} />}

					<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
						{draft.id && (
							<button
								type="button"
								onClick={() => copyId(draft.id!)}
								title="Copy template ID"
								className="flex items-center gap-1.5 font-mono text-[11px] text-kumo-subtle hover:text-kumo-default"
							>
								<span>ID {draft.id}</span>
								{copiedId === draft.id ? (
									<CheckIcon size={12} weight="bold" className="text-kumo-link" />
								) : (
									<CopyIcon size={12} />
								)}
							</button>
						)}
						<Input
							label="Name"
							value={draft.name}
							onChange={(e) => patch({ name: e.target.value })}
							placeholder="e.g. Monthly newsletter"
						/>
						<Input
							label="Subject"
							value={draft.subject}
							onChange={(e) => patch({ subject: e.target.value })}
							placeholder="Supports {{placeholders}}"
						/>
						<div>
							<div className="flex items-center justify-between mb-1.5">
								<Text size="sm" DANGEROUS_className="font-medium">
									Body
								</Text>
								<div className="flex items-center gap-0.5">
									{modeButton("visual", "Rich text", <TextAaIcon size={12} />)}
									{modeButton("design", "Design", <SquaresFourIcon size={12} />)}
									{modeButton("html", "HTML", <CodeIcon size={12} />)}
								</div>
							</div>

							{bodyMode === "html" ? (
								<>
									<div className="mb-2 flex justify-end">
										<Button
											type="button"
											variant="secondary"
											size="xs"
											icon={<ImageIcon size={12} />}
											onClick={() => htmlImageInputRef.current?.click()}
										>
											Upload image
										</Button>
										<input
											ref={htmlImageInputRef}
											type="file"
											accept="image/*"
											className="hidden"
											onChange={(e) => {
												void handleHtmlImageFile(e.target.files?.[0]);
												e.target.value = "";
											}}
										/>
									</div>
									<textarea
										ref={bodyTextareaRef}
										value={draft.body}
										onChange={(e) => patch({ body: e.target.value })}
										rows={16}
										spellCheck={false}
										placeholder="<html>… paste your raw HTML template here …</html>"
										className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring font-mono leading-relaxed"
									/>
								</>
							) : bodyMode === "design" ? (
								<Suspense
									fallback={
										<div className="flex justify-center py-16">
											<Loader size="lg" />
										</div>
									}
								>
									<EmailBuilder
										value={draft.body}
										onChange={(body) => patch({ body })}
										onImageUpload={handleImageUpload}
									/>
								</Suspense>
							) : (
								<RichTextEditor
									value={draft.body}
									onChange={(body) => patch({ body })}
									onImageUpload={handleImageUpload}
								/>
							)}
							<p className="text-xs text-kumo-subtle mt-1.5">
								Use <code>{"{{name}}"}</code> tokens for placeholders. Uploaded
								images are delivered inline with the email. <strong>Design</strong>{" "}
								is a drag-and-drop builder; <strong>HTML</strong> preserves raw
								markup (tables, inline styles) as-is.
							</p>
						</div>
					</div>

					<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
						<div className="flex items-center justify-between mb-3">
							<span className="text-sm font-medium text-kumo-default">
								Placeholders
							</span>
							<Button
								variant="ghost"
								size="xs"
								icon={<PlusIcon size={12} />}
								onClick={() => addPlaceholder()}
							>
								Add
							</Button>
						</div>

						{missingTokens.length > 0 && (
							<div className="mb-3 text-xs text-kumo-subtle">
								Found in the template but not declared:{" "}
								{missingTokens.map((k) => (
									<button
										key={k}
										type="button"
										onClick={() => addPlaceholder(k)}
										className="mr-1 underline text-kumo-link"
									>
										{`{{${k}}}`}
									</button>
								))}
							</div>
						)}

						{draft.placeholders.length === 0 ? (
							<p className="text-xs text-kumo-subtle">No placeholders defined.</p>
						) : (
							<div className="space-y-2">
								{draft.placeholders.map((p, i) => (
									<div key={i} className="flex flex-wrap items-center gap-2">
										<input
											value={p.key}
											onChange={(e) => setPlaceholder(i, { key: e.target.value })}
											placeholder="key"
											className="w-32 rounded-md border border-kumo-line bg-kumo-recessed px-2 py-1 text-xs"
										/>
										<input
											value={p.label ?? ""}
											onChange={(e) => setPlaceholder(i, { label: e.target.value })}
											placeholder="label (optional)"
											className="w-40 rounded-md border border-kumo-line bg-kumo-recessed px-2 py-1 text-xs"
										/>
										<select
											value={p.type ?? "text"}
											onChange={(e) =>
												setPlaceholder(i, {
													type: e.target.value as "text" | "html",
												})
											}
											className="rounded-md border border-kumo-line bg-kumo-recessed px-2 py-1 text-xs"
										>
											<option value="text">text</option>
											<option value="html">html</option>
										</select>
										<input
											value={p.default ?? ""}
											onChange={(e) => setPlaceholder(i, { default: e.target.value })}
											placeholder="default (optional)"
											className="flex-1 min-w-[8rem] rounded-md border border-kumo-line bg-kumo-recessed px-2 py-1 text-xs"
										/>
										<Button
											variant="ghost"
											shape="square"
											size="xs"
											icon={<TrashIcon size={12} />}
											onClick={() => removePlaceholder(i)}
											aria-label="Remove placeholder"
										/>
									</div>
								))}
							</div>
						)}
					</div>

					<div className="flex justify-end gap-2">
						<Button
							variant="ghost"
							onClick={() => {
								setDraft(null);
								setError(null);
							}}
							disabled={isSaving}
						>
							Cancel
						</Button>
						<Button variant="primary" onClick={handleSave} loading={isSaving}>
							Save template
						</Button>
					</div>
				</div>
			) : isLoading ? (
				<div className="flex justify-center py-20">
					<Loader size="lg" />
				</div>
			) : !templates || templates.length === 0 ? (
				<p className="text-sm text-kumo-subtle">
					No templates yet. Create one to reuse HTML layouts across the app, the
					API, and the AI agent.
				</p>
			) : (
				<div className="space-y-2">
					{templates.map((t) => (
						<div
							key={t.id}
							className="flex items-center justify-between rounded-lg border border-kumo-line bg-kumo-base px-4 py-3"
						>
							<div className="min-w-0">
								<div className="text-sm font-medium text-kumo-default truncate">
									{t.name}
								</div>
								<div className="text-xs text-kumo-subtle truncate">
									{t.subject || "(no subject)"}
								</div>
								<button
									type="button"
									onClick={() => copyId(t.id)}
									title="Copy template ID"
									className="mt-1 flex items-center gap-1 font-mono text-[11px] text-kumo-subtle hover:text-kumo-default max-w-full"
								>
									<span className="truncate">{t.id}</span>
									{copiedId === t.id ? (
										<CheckIcon size={11} weight="bold" className="shrink-0 text-kumo-link" />
									) : (
										<CopyIcon size={11} className="shrink-0" />
									)}
								</button>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{(t.placeholders?.length ?? 0) > 0 && (
									<Badge variant="secondary">
										{t.placeholders.length} placeholder
										{t.placeholders.length === 1 ? "" : "s"}
									</Badge>
								)}
								<Button
									variant="secondary"
									size="xs"
									onClick={() => {
										setError(null);
										setBodyMode(looksLikeRawHtml(t.body ?? "") ? "html" : "visual");
										setDraft(toDraft(t));
									}}
								>
									Edit
								</Button>
								<Button
									variant="ghost"
									shape="square"
									size="xs"
									icon={<TrashIcon size={14} />}
									onClick={() => handleDelete(t.id, t.name)}
									aria-label="Delete template"
								/>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
