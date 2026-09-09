// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Template selector for the composer. Lists the mailbox's saved templates,
 * prompts for any `{{placeholder}}` values, and renders the template into
 * the subject + body via the shared `renderTemplate`. Images keep their
 * `data-asset-id` so the Worker inlines them as CID attachments on send.
 */

import { Button, Text } from "@cloudflare/kumo";
import { useMemo, useState } from "react";
import { extractTokenKeys, renderTemplate } from "shared/templates";
import { useTemplates } from "~/queries/templates";

interface TemplatePickerProps {
	mailboxId: string | undefined;
	subject: string;
	setSubject: (v: string) => void;
	body: string;
	setBody: (v: string) => void;
}

export default function TemplatePicker({
	mailboxId,
	subject,
	setSubject,
	body,
	setBody,
}: TemplatePickerProps) {
	const { data: templates } = useTemplates(mailboxId);
	const [templateId, setTemplateId] = useState("");
	const [values, setValues] = useState<Record<string, string>>({});

	const selected = useMemo(
		() => templates?.find((t) => t.id === templateId),
		[templates, templateId],
	);

	const keys = useMemo(() => {
		if (!selected) return [] as string[];
		const declared = selected.placeholders?.map((p) => p.key) ?? [];
		return [...new Set([...declared, ...extractTokenKeys(selected)])];
	}, [selected]);

	if (!templates || templates.length === 0) return null;

	const apply = () => {
		if (!selected) return;
		const rendered = renderTemplate(selected, values);
		if (rendered.subject && !subject.trim()) setSubject(rendered.subject);
		setBody(rendered.html + (body || ""));
	};

	return (
		<div className="rounded-lg border border-kumo-line bg-kumo-recessed p-3 space-y-2">
			<div className="flex items-center gap-2">
				<Text size="sm" DANGEROUS_className="font-medium">
					Template
				</Text>
				<select
					value={templateId}
					onChange={(e) => {
						setTemplateId(e.target.value);
						setValues({});
					}}
					className="flex-1 rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-sm"
				>
					<option value="">None</option>
					{templates.map((t) => (
						<option key={t.id} value={t.id}>
							{t.name}
						</option>
					))}
				</select>
				<Button
					type="button"
					variant="secondary"
					size="xs"
					disabled={!selected}
					onClick={apply}
				>
					Insert
				</Button>
			</div>
			{keys.map((key) => {
				const def = selected?.placeholders?.find((p) => p.key === key);
				return (
					<label key={key} className="block">
						<span className="text-xs text-kumo-subtle">{def?.label || key}</span>
						<input
							value={values[key] ?? ""}
							onChange={(e) =>
								setValues((v) => ({ ...v, [key]: e.target.value }))
							}
							placeholder={def?.default || `{{${key}}}`}
							className="mt-0.5 w-full rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-xs"
						/>
					</label>
				);
			})}
		</div>
	);
}
