// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Badge,
	Banner,
	Button,
	Input,
	Loader,
	Meter,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import {
	ArrowLeftIcon,
	PaperPlaneTiltIcon,
	PlusIcon,
	TrashIcon,
	UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { extractTokenKeys } from "shared/templates";
import { formatDetailDate } from "shared/dates";
import RichTextEditor from "~/components/RichTextEditor";
import {
	useCancelNewsletter,
	useCreateNewsletter,
	useDeleteNewsletter,
	useNewsletter,
	useNewsletters,
	usePauseNewsletter,
	useResumeNewsletter,
	useStartNewsletter,
	useValidateNewsletterCsv,
} from "~/queries/newsletter";
import { useTemplates } from "~/queries/templates";
import type { NewsletterCsvValidation, NewsletterStatus } from "~/types";

const STATUS_VARIANT: Record<
	NewsletterStatus,
	"primary" | "secondary" | "destructive" | "success"
> = {
	draft: "secondary",
	scheduled: "primary",
	sending: "primary",
	paused: "secondary",
	completed: "success",
	canceled: "secondary",
	failed: "destructive",
};

function StatusBadge({ status }: { status: NewsletterStatus }) {
	return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}

type View = { mode: "list" } | { mode: "new" } | { mode: "detail"; id: string };

export default function NewsletterRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const [view, setView] = useState<View>({ mode: "list" });

	if (!mailboxId) return null;

	if (view.mode === "new") {
		return (
			<Shell>
				<NewNewsletter
					mailboxId={mailboxId}
					onDone={(id) => setView({ mode: "detail", id })}
					onCancel={() => setView({ mode: "list" })}
				/>
			</Shell>
		);
	}
	if (view.mode === "detail") {
		return (
			<Shell>
				<NewsletterDetail
					mailboxId={mailboxId}
					id={view.id}
					onBack={() => setView({ mode: "list" })}
				/>
			</Shell>
		);
	}
	return (
		<Shell>
			<NewsletterList
				mailboxId={mailboxId}
				onNew={() => setView({ mode: "new" })}
				onOpen={(id) => setView({ mode: "detail", id })}
			/>
		</Shell>
	);
}

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<div className="w-full px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
			{children}
		</div>
	);
}

// ── List ─────────────────────────────────────────────────────────

function NewsletterList({
	mailboxId,
	onNew,
	onOpen,
}: {
	mailboxId: string;
	onNew: () => void;
	onOpen: (id: string) => void;
}) {
	const { data: newsletters, isLoading } = useNewsletters(mailboxId);

	return (
		<>
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-lg font-semibold text-kumo-default">Send Newsletter</h1>
				<Button
					variant="primary"
					size="sm"
					icon={<PlusIcon size={14} />}
					onClick={onNew}
				>
					New newsletter
				</Button>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-20">
					<Loader size="lg" />
				</div>
			) : !newsletters || newsletters.length === 0 ? (
				<p className="text-sm text-kumo-subtle">
					No newsletters yet. Upload a CSV of recipients and send a template to
					all of them, now or on a schedule.
				</p>
			) : (
				<div className="space-y-2">
					{newsletters.map((n) => (
						<button
							key={n.id}
							type="button"
							onClick={() => onOpen(n.id)}
							className="flex w-full items-center justify-between rounded-lg border border-kumo-line bg-kumo-base px-4 py-3 text-left hover:bg-kumo-tint"
						>
							<div className="min-w-0">
								<div className="text-sm font-medium text-kumo-default truncate">
									{n.name}
								</div>
								<div className="text-xs text-kumo-subtle">
									{n.sent}/{n.total} sent
									{n.failed > 0 ? ` · ${n.failed} failed` : ""}
									{n.status === "scheduled" && n.scheduled_at
										? ` · ${formatDetailDate(n.scheduled_at)}`
										: ""}
								</div>
							</div>
							<StatusBadge status={n.status} />
						</button>
					))}
				</div>
			)}
		</>
	);
}

// ── New ──────────────────────────────────────────────────────────

function NewNewsletter({
	mailboxId,
	onDone,
	onCancel,
}: {
	mailboxId: string;
	onDone: (id: string) => void;
	onCancel: () => void;
}) {
	const toast = useKumoToastManager();
	const { data: templates } = useTemplates(mailboxId);
	const validateMutation = useValidateNewsletterCsv();
	const createMutation = useCreateNewsletter();
	const startMutation = useStartNewsletter();

	const [name, setName] = useState("");
	const [templateId, setTemplateId] = useState("");
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [fromName, setFromName] = useState("");
	const [replyTo, setReplyTo] = useState("");
	const [csvText, setCsvText] = useState<string | null>(null);
	const [csvName, setCsvName] = useState("");
	const [validation, setValidation] = useState<NewsletterCsvValidation | null>(null);
	const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
	const [scheduledLocal, setScheduledLocal] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const selectedTemplate = useMemo(
		() => templates?.find((t) => t.id === templateId),
		[templates, templateId],
	);
	const requiredKeys = useMemo(() => {
		if (!selectedTemplate) return [] as string[];
		const declared = selectedTemplate.placeholders?.map((p) => p.key) ?? [];
		return [...new Set([...declared, ...extractTokenKeys(selectedTemplate)])];
	}, [selectedTemplate]);

	const runValidation = async (text: string, tid: string) => {
		setError(null);
		try {
			const res = await validateMutation.mutateAsync({
				mailboxId,
				csv: text,
				templateId: tid || undefined,
			});
			setValidation(res);
		} catch (e) {
			setValidation(null);
			setError(e instanceof Error ? e.message : "Could not read the CSV.");
		}
	};

	const handleFile = async (file: File | undefined) => {
		if (!file) return;
		const text = await file.text();
		setCsvText(text);
		setCsvName(file.name);
		await runValidation(text, templateId);
	};

	const handleTemplateChange = async (tid: string) => {
		setTemplateId(tid);
		if (csvText) await runValidation(csvText, tid);
	};

	const canSubmit =
		name.trim() &&
		csvText &&
		validation?.ok &&
		(templateId || body.trim()) &&
		(scheduleMode === "now" || scheduledLocal);

	const handleSubmit = async () => {
		if (!csvText) return;
		setError(null);
		setIsSubmitting(true);
		let scheduled_at: string | undefined;
		if (scheduleMode === "later" && scheduledLocal) {
			const d = new Date(scheduledLocal);
			if (Number.isNaN(d.getTime())) {
				setError("Invalid schedule time.");
				setIsSubmitting(false);
				return;
			}
			scheduled_at = d.toISOString();
		}
		try {
			const { newsletter, skippedInvalid, duplicatesRemoved } =
				await createMutation.mutateAsync({
					mailboxId,
					data: {
						name: name.trim(),
						csv: csvText,
						template_id: templateId || undefined,
						subject: subject.trim() || undefined,
						body: templateId ? undefined : body,
						from_name: fromName.trim() || undefined,
						reply_to: replyTo.trim() || undefined,
						scheduled_at,
					},
				});
			await startMutation.mutateAsync({ mailboxId, id: newsletter.id });
			const skipNote =
				skippedInvalid || duplicatesRemoved
					? ` (${skippedInvalid} invalid, ${duplicatesRemoved} duplicate rows skipped)`
					: "";
			toast.add({
				title: `${scheduled_at ? "Newsletter scheduled" : "Newsletter sending"}${skipNote}`,
			});
			onDone(newsletter.id);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to create newsletter.");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="max-w-3xl space-y-5">
			<button
				type="button"
				onClick={onCancel}
				className="flex items-center gap-1 text-sm text-kumo-subtle hover:text-kumo-default"
			>
				<ArrowLeftIcon size={14} /> Newsletters
			</button>
			<h1 className="text-lg font-semibold text-kumo-default">New newsletter</h1>

			{error && <Banner variant="error" text={error} />}

			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
				<Input
					label="Name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g. October announcement"
				/>

				<div>
					<Text size="sm" DANGEROUS_className="font-medium mb-1 block">
						Template
					</Text>
					<select
						value={templateId}
						onChange={(e) => void handleTemplateChange(e.target.value)}
						className="w-full rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm"
					>
						<option value="">No template — plain message</option>
						{(templates ?? []).map((t) => (
							<option key={t.id} value={t.id}>
								{t.name}
							</option>
						))}
					</select>
					{requiredKeys.length > 0 && (
						<p className="text-xs text-kumo-subtle mt-1.5">
							CSV must have columns:{" "}
							<code>email</code>
							{requiredKeys.map((k) => (
								<span key={k}>
									, <code>{k}</code>
								</span>
							))}
						</p>
					)}
				</div>

				<Input
					label={templateId ? "Subject override (optional)" : "Subject"}
					value={subject}
					onChange={(e) => setSubject(e.target.value)}
					placeholder={templateId ? "Leave blank to use the template subject" : "Supports {{column}} tokens"}
				/>

				{!templateId && (
					<div>
						<Text size="sm" DANGEROUS_className="font-medium mb-1 block">
							Message
						</Text>
						<RichTextEditor value={body} onChange={setBody} />
						<p className="text-xs text-kumo-subtle mt-1.5">
							<code>{"{{column}}"}</code> tokens are replaced with each recipient's
							CSV values.
						</p>
					</div>
				)}

				<details className="text-sm">
					<summary className="cursor-pointer text-kumo-subtle">
						Advanced (from name, reply-to)
					</summary>
					<div className="mt-2 space-y-2">
						<Input
							label="From name"
							size="sm"
							value={fromName}
							onChange={(e) => setFromName(e.target.value)}
							placeholder={mailboxId}
						/>
						<Input
							label="Reply-To"
							size="sm"
							type="email"
							value={replyTo}
							onChange={(e) => setReplyTo(e.target.value)}
						/>
					</div>
				</details>
			</div>

			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
				<div className="flex items-center justify-between">
					<Text size="sm" DANGEROUS_className="font-medium">
						Recipients (CSV)
					</Text>
					<Button
						type="button"
						variant="secondary"
						size="xs"
						icon={<UploadSimpleIcon size={12} />}
						loading={validateMutation.isPending}
						onClick={() => fileRef.current?.click()}
					>
						{csvName || "Upload CSV"}
					</Button>
					<input
						ref={fileRef}
						type="file"
						accept=".csv,text/csv"
						className="hidden"
						onChange={(e) => {
							void handleFile(e.target.files?.[0]);
							e.target.value = "";
						}}
					/>
				</div>

				{validation && (
					<div className="rounded-md border border-kumo-line bg-kumo-recessed p-3 text-xs space-y-1">
						{validation.missingKeys.length > 0 ? (
							<p className="text-kumo-error font-medium">
								Missing required column(s): {validation.missingKeys.join(", ")}
							</p>
						) : (
							<p className="text-kumo-default font-medium">
								{validation.validCount} recipient
								{validation.validCount === 1 ? "" : "s"} ready
							</p>
						)}
						<p className="text-kumo-subtle">
							Columns: {validation.headers.join(", ") || "(none)"}
						</p>
						<p className="text-kumo-subtle">
							{validation.totalRows} rows · {validation.skippedInvalid} invalid
							email{validation.skippedInvalid === 1 ? "" : "s"} skipped ·{" "}
							{validation.duplicatesRemoved} duplicate
							{validation.duplicatesRemoved === 1 ? "" : "s"} removed
						</p>
						{validation.tooManyRecipients && (
							<p className="text-kumo-error">Too many recipients (max 20,000).</p>
						)}
						{validation.invalidSample.length > 0 && (
							<p className="text-kumo-subtle">
								e.g. {validation.invalidSample.slice(0, 3).map((s) => `"${s}"`).join(", ")}
							</p>
						)}
					</div>
				)}
			</div>

			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
				<Text size="sm" DANGEROUS_className="font-medium">
					When
				</Text>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={scheduleMode === "now"}
						onChange={() => setScheduleMode("now")}
					/>
					Send now
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={scheduleMode === "later"}
						onChange={() => setScheduleMode("later")}
					/>
					Schedule
					<input
						type="datetime-local"
						disabled={scheduleMode !== "later"}
						value={scheduledLocal}
						onChange={(e) => setScheduledLocal(e.target.value)}
						className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-sm disabled:opacity-50"
					/>
				</label>
			</div>

			<div className="flex justify-end gap-2">
				<Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
					Cancel
				</Button>
				<Button
					variant="primary"
					icon={<PaperPlaneTiltIcon size={14} />}
					loading={isSubmitting}
					disabled={!canSubmit}
					onClick={handleSubmit}
				>
					{scheduleMode === "later" ? "Schedule" : "Create & send"}
				</Button>
			</div>
		</div>
	);
}

// ── Detail ───────────────────────────────────────────────────────

function NewsletterDetail({
	mailboxId,
	id,
	onBack,
}: {
	mailboxId: string;
	id: string;
	onBack: () => void;
}) {
	const toast = useKumoToastManager();
	const { data: n, isLoading } = useNewsletter(mailboxId, id);

	const pause = usePauseNewsletter();
	const resume = useResumeNewsletter();
	const cancel = useCancelNewsletter();
	const del = useDeleteNewsletter();

	const act = async (
		label: string,
		fn: () => Promise<unknown>,
		back = false,
	) => {
		try {
			await fn();
			toast.add({ title: label });
			if (back) onBack();
		} catch (e) {
			toast.add({
				title: e instanceof Error ? e.message : "Action failed",
				variant: "error",
			});
		}
	};

	if (isLoading || !n) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	const pct = n.total > 0 ? Math.round(((n.sent + n.failed) / n.total) * 100) : 0;
	const terminal = ["completed", "canceled", "failed"].includes(n.status);

	return (
		<div className="max-w-2xl space-y-5">
			<button
				type="button"
				onClick={onBack}
				className="flex items-center gap-1 text-sm text-kumo-subtle hover:text-kumo-default"
			>
				<ArrowLeftIcon size={14} /> Newsletters
			</button>

			<div className="flex items-center justify-between">
				<h1 className="text-lg font-semibold text-kumo-default">{n.name}</h1>
				<StatusBadge status={n.status} />
			</div>

			{n.error && <Banner variant="error" text={n.error} />}

			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
				<Meter
					label="Progress"
					value={pct}
					customValue={`${n.sent + n.failed} / ${n.total}`}
				/>
				<div className="flex gap-4 text-sm text-kumo-subtle">
					<span>{n.sent} sent</span>
					<span>{n.failed} failed</span>
					<span>{n.total - n.sent - n.failed} pending</span>
				</div>
				{n.scheduled_at && n.status === "scheduled" && (
					<p className="text-xs text-kumo-subtle">
						Scheduled for {formatDetailDate(n.scheduled_at)}
					</p>
				)}
				{n.completed_at && (
					<p className="text-xs text-kumo-subtle">
						Finished {formatDetailDate(n.completed_at)}
					</p>
				)}
			</div>

			<div className="flex gap-2">
				{n.status === "sending" && (
					<Button
						variant="secondary"
						size="sm"
						onClick={() =>
							act("Paused", () => pause.mutateAsync({ mailboxId, id }))
						}
					>
						Pause
					</Button>
				)}
				{n.status === "paused" && (
					<Button
						variant="secondary"
						size="sm"
						onClick={() =>
							act("Resumed", () => resume.mutateAsync({ mailboxId, id }))
						}
					>
						Resume
					</Button>
				)}
				{!terminal && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() =>
							act("Canceled", () => cancel.mutateAsync({ mailboxId, id }))
						}
					>
						Cancel
					</Button>
				)}
				{(terminal || n.status === "draft") && (
					<Button
						variant="ghost"
						size="sm"
						icon={<TrashIcon size={14} />}
						onClick={() => {
							if (window.confirm(`Delete "${n.name}"?`)) {
								void act(
									"Deleted",
									() => del.mutateAsync({ mailboxId, id }),
									true,
								);
							}
						}}
					>
						Delete
					</Button>
				)}
			</div>

			{n.failedRecipients && n.failedRecipients.length > 0 && (
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<Text size="sm" DANGEROUS_className="font-medium mb-2 block">
						Failed ({n.failed})
					</Text>
					<div className="space-y-1 text-xs max-h-64 overflow-y-auto">
						{n.failedRecipients.map((r, i) => (
							<div key={i} className="flex justify-between gap-3">
								<span className="text-kumo-default truncate">{r.email}</span>
								<span className="text-kumo-subtle truncate">{r.error}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
