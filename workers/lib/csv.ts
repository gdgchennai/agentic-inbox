// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Minimal RFC 4180-ish CSV parser for recipient lists.
 *
 * Handles: UTF-8 BOM, CRLF / LF / CR line endings, quoted fields with `""`
 * escapes and embedded commas / newlines, trailing newline, blank lines.
 * Not a general-purpose parser — no streaming, whole file in memory.
 */

export interface ParsedCsv {
	/** Header names, trimmed, in file order. */
	headers: string[];
	/** One object per data row, keyed by header name. Missing cells → "". */
	rows: Record<string, string>[];
}

/** Split CSV text into a matrix of string cells. */
function toMatrix(text: string): string[][] {
	const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const out: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;

	for (let i = 0; i < src.length; i++) {
		const c = src[i];

		if (inQuotes) {
			if (c === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
			continue;
		}

		if (c === '"') {
			inQuotes = true;
		} else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			// Consume \r\n as one line break.
			if (c === "\r" && src[i + 1] === "\n") i++;
			row.push(field);
			field = "";
			out.push(row);
			row = [];
		} else {
			field += c;
		}
	}
	// Final field / row (no trailing newline).
	if (field !== "" || row.length > 0) {
		row.push(field);
		out.push(row);
	}

	// Drop fully-empty rows.
	return out.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function parseCsv(text: string): ParsedCsv {
	const matrix = toMatrix(text ?? "");
	if (matrix.length === 0) return { headers: [], rows: [] };

	const headers = matrix[0].map((h) => h.trim());
	const rows = matrix.slice(1).map((cells) => {
		const obj: Record<string, string> = {};
		headers.forEach((h, idx) => {
			obj[h] = (cells[idx] ?? "").trim();
		});
		return obj;
	});
	return { headers, rows };
}

/** Reasonable email shape check (not a full RFC validator). */
export function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
