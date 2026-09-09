// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Newsletter CSV validation + recipient extraction, shared by the
 * `/newsletters/validate` (dry run) and `/newsletters` (create) routes.
 */

import {
	extractTokenKeys,
	type TemplatePlaceholder,
} from "../../shared/templates";
import { parseCsv, isValidEmail } from "./csv";

export const MAX_NEWSLETTER_RECIPIENTS = 20_000;

interface TemplateLike {
	subject: string;
	body: string;
	placeholders: TemplatePlaceholder[];
}

/** Column names a CSV must contain for this template: declared keys ∪ tokens in subject/body. */
export function requiredTemplateKeys(template: TemplateLike): string[] {
	const declared = (template.placeholders ?? []).map((p) => p.key);
	return [...new Set([...declared, ...extractTokenKeys(template)])];
}

export interface NewsletterRecipientRow {
	email: string;
	/** Only the columns matching `keys`, keyed exactly as in `keys`. */
	vars: Record<string, string>;
}

export interface CsvValidation {
	ok: boolean;
	headers: string[];
	requiredKeys: string[];
	missingKeys: string[];
	totalRows: number;
	validCount: number;
	skippedInvalid: number;
	invalidSample: string[];
	duplicatesRemoved: number;
	tooManyRecipients: boolean;
	recipients: NewsletterRecipientRow[];
}

/**
 * Parse + validate a recipient CSV against a set of required placeholder keys.
 * `keys` is empty for a plain (no-template) newsletter — then any column can be
 * used as a `{{token}}` and only `email` is required.
 */
export function validateNewsletterCsv(
	csv: string,
	keys: string[],
): CsvValidation {
	const { headers, rows } = parseCsv(csv);

	// Case-insensitive header lookup → canonical name used in the file.
	const headerByLower = new Map(headers.map((h) => [h.toLowerCase(), h]));
	const emailHeader = headerByLower.get("email");

	const missingKeys: string[] = [];
	if (!emailHeader) missingKeys.push("email");
	for (const k of keys) {
		if (!headerByLower.has(k.toLowerCase())) missingKeys.push(k);
	}

	// Which columns feed each recipient's `vars`. For a plain newsletter, every
	// non-email column is available as a token.
	const varHeaders = keys.length
		? keys
				.map((k) => headerByLower.get(k.toLowerCase()))
				.filter((h): h is string => !!h)
		: headers.filter((h) => h.toLowerCase() !== "email");

	const seen = new Set<string>();
	const recipients: NewsletterRecipientRow[] = [];
	const invalidSample: string[] = [];
	let skippedInvalid = 0;
	let duplicatesRemoved = 0;

	if (emailHeader && missingKeys.length === 0) {
		for (const row of rows) {
			const email = (row[emailHeader] ?? "").trim().toLowerCase();
			if (!isValidEmail(email)) {
				skippedInvalid++;
				if (invalidSample.length < 10) invalidSample.push(row[emailHeader] ?? "");
				continue;
			}
			if (seen.has(email)) {
				duplicatesRemoved++;
				continue;
			}
			seen.add(email);
			const vars: Record<string, string> = {};
			for (const h of varHeaders) {
				// key vars by the requested key casing when we have a template
				const outKey = keys.find((k) => k.toLowerCase() === h.toLowerCase()) ?? h;
				vars[outKey] = row[h] ?? "";
			}
			recipients.push({ email, vars });
		}
	}

	const tooMany = recipients.length > MAX_NEWSLETTER_RECIPIENTS;

	return {
		ok: missingKeys.length === 0 && recipients.length > 0 && !tooMany,
		headers,
		requiredKeys: keys.length ? ["email", ...keys] : ["email"],
		missingKeys,
		totalRows: rows.length,
		validCount: recipients.length,
		skippedInvalid,
		invalidSample,
		duplicatesRemoved,
		tooManyRecipients: tooMany,
		recipients,
	};
}
