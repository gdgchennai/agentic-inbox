// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared email-template rendering.
 *
 * A template is per-mailbox HTML + subject that may contain `{{placeholder}}`
 * tokens. Each placeholder is declared with a type: `text` values are
 * HTML-escaped before substitution, `html` values are inserted verbatim
 * (small fragments like <p>, <a>, <img> authored by the sender).
 *
 * This module is pure and dependency-free so both the Worker (authoritative
 * render at send time) and the app (live compose preview) can import it,
 * mirroring `shared/folders.ts` and `shared/dates.ts`.
 */

export type PlaceholderType = "text" | "html";

export interface TemplatePlaceholder {
	key: string;
	label?: string;
	type?: PlaceholderType;
	default?: string;
}

export interface EmailTemplate {
	id: string;
	name: string;
	subject: string;
	body: string;
	placeholders: TemplatePlaceholder[];
	created_at: string;
	updated_at: string;
}

/** Escape the five OWASP-recommended HTML special characters. */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Matches `{{ key }}` with optional surrounding whitespace. Key: letters, digits, _, -, . */
const TOKEN_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Substitute `{{key}}` tokens in a single string.
 *
 * Resolution order per token: provided value → placeholder `default` → "".
 * `text` placeholders (the default type) are HTML-escaped; `html` placeholders
 * are inserted as-is.
 */
export function substitutePlaceholders(
	input: string,
	placeholders: TemplatePlaceholder[],
	values: Record<string, string> = {},
): string {
	if (!input) return input;
	const byKey = new Map(placeholders.map((p) => [p.key, p]));

	return input.replace(TOKEN_RE, (_match, key: string) => {
		const def = byKey.get(key);
		const raw = Object.prototype.hasOwnProperty.call(values, key)
			? values[key]
			: (def?.default ?? "");
		const value = raw ?? "";
		return (def?.type ?? "text") === "html" ? value : escapeHtml(value);
	});
}

export interface RenderedTemplate {
	subject: string;
	html: string;
}

/** Render a template's subject and body with the given placeholder values. */
export function renderTemplate(
	template: Pick<EmailTemplate, "subject" | "body" | "placeholders">,
	values: Record<string, string> = {},
): RenderedTemplate {
	const placeholders = template.placeholders ?? [];
	return {
		subject: substitutePlaceholders(template.subject ?? "", placeholders, values),
		html: substitutePlaceholders(template.body ?? "", placeholders, values),
	};
}

/**
 * Collect distinct `{{token}}` keys that appear in a template's subject/body.
 * Used by the compose UI to prompt for values even if a key was never
 * formally declared in `placeholders`.
 */
export function extractTokenKeys(
	template: Pick<EmailTemplate, "subject" | "body">,
): string[] {
	const keys = new Set<string>();
	for (const source of [template.subject ?? "", template.body ?? ""]) {
		for (const m of source.matchAll(TOKEN_RE)) keys.add(m[1]);
	}
	return [...keys];
}
