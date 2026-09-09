// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Template selector for the composer. Lists the mailbox's saved templates,
 * collects `{{placeholder}}` values, and hands them to the compose form via
 * `applyTemplate`. The form then sends `template_id` + `placeholders` to the
 * API, which renders the template server-side (layout + images preserved) —
 * the composer never runs template HTML through the rich-text editor.
 */

import { Button, Text } from "@cloudflare/kumo";
import { useMemo, useState } from "react";
import { extractTokenKeys, type EmailTemplate } from "shared/templates";
import { useTemplates } from "~/queries/templates";

interface TemplatePickerProps {
	mailboxId: string | undefined;
	applyTemplate: (template: EmailTemplate, values: Record<string, string>) => void;
	appliedTemplateId?: string;
	onClear: () => void;
}

export default function TemplatePicker({
	mailboxId,
	applyTemplate,
	appliedTemplateId,
	onClear,
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

	const appliedName = templates.find((t) => t.id === appliedTemplateId)?.name;

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
					onClick={() => selected && applyTemplate(selected, values)}
				>
					{appliedTemplateId && appliedTemplateId === templateId ? "Update" : "Insert"}
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

			{appliedTemplateId && (
				<div className="flex items-center justify-between text-xs text-kumo-subtle pt-1">
					<span>
						Applied: <strong>{appliedName}</strong> — sent as designed
					</span>
					<button
						type="button"
						onClick={onClear}
						className="text-kumo-link hover:text-kumo-link-hover font-medium"
					>
						Remove
					</button>
				</div>
			)}
		</div>
	);
}
