// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Contacts CSV parsing + validation for the address book import.
 * Modeled on `validateNewsletterCsv` (workers/lib/newsletter.ts) minus the
 * template-placeholder logic — a contacts CSV just needs an `email` column.
 */

import { parseCsv, isValidEmail } from "./csv";

export const MAX_CONTACTS = 50_000;

export interface ContactRow {
	email: string;
	name: string;
}

export interface ContactsCsvValidation {
	ok: boolean;
	headers: string[];
	hasEmailColumn: boolean;
	hasNameColumn: boolean;
	totalRows: number;
	validCount: number;
	skippedInvalid: number;
	invalidSample: string[];
	duplicatesRemoved: number;
	tooMany: boolean;
	rows: ContactRow[];
}

export function validateContactsCsv(csv: string): ContactsCsvValidation {
	const { headers, rows } = parseCsv(csv);
	const byLower = new Map(headers.map((h) => [h.toLowerCase(), h]));
	const emailHeader = byLower.get("email");
	const nameHeader = byLower.get("name");

	const seen = new Set<string>();
	const out: ContactRow[] = [];
	const invalidSample: string[] = [];
	let skippedInvalid = 0;
	let duplicatesRemoved = 0;

	if (emailHeader) {
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
			out.push({ email, name: (nameHeader ? row[nameHeader] : "")?.trim() ?? "" });
		}
	}

	const tooMany = out.length > MAX_CONTACTS;
	return {
		ok: !!emailHeader && out.length > 0 && !tooMany,
		headers,
		hasEmailColumn: !!emailHeader,
		hasNameColumn: !!nameHeader,
		totalRows: rows.length,
		validCount: out.length,
		skippedInvalid,
		invalidSample,
		duplicatesRemoved,
		tooMany,
		rows: out,
	};
}
