// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Worker-side template send helpers.
 *
 * `shared/templates.ts` holds the pure render logic (token substitution).
 * This module loads a template from the mailbox Durable Object and rewrites
 * its `<img>` tags to **hosted** URLs on the public `/assets/t/...` route
 * (exempt from Cloudflare Access — see workers/app.ts), so recipients' mail
 * clients can load the images. CID/inline attachments were tried first but
 * Cloudflare's Email Service delivers them as plain attachments, not
 * `multipart/related`, so `cid:` references never resolved.
 */

import { renderTemplate, type TemplatePlaceholder } from "../../shared/templates";
import { getMailboxStub, stripHtmlToText } from "./email-helpers";
import type { Env } from "../types";

interface TemplateStub {
	getTemplate: (id: string) => Promise<{
		id: string;
		name: string;
		subject: string;
		body: string;
		placeholders: TemplatePlaceholder[];
	} | null>;
}

// Matches an <img> tag and captures its attribute string.
const IMG_TAG_RE = /<img\b([^>]*)>/gi;
const ASSET_ID_ATTR_RE = /\bdata-asset-id\s*=\s*["']([^"']+)["']/i;
// Also recognise assets referenced by their in-app (Access-gated) URL.
const ASSET_URL_RE = /\/templates\/assets\/([0-9a-f-]{36})/i;

const PUBLIC_ASSET_RE = /\/assets\/t\//;

/**
 * Rewrite template-managed images (`<img data-asset-id="…">`, or an img whose
 * src points at the in-app `/templates/assets/<id>` route) to an absolute URL
 * on the public `/assets/t/<mailbox>/<assetId>` route.
 *
 * `baseUrl` must be the deployment's public origin (e.g.
 * `https://mail.example.com`); a relative URL is left if it is empty, which
 * only happens for MCP sends with no `PUBLIC_URL` configured.
 */
export function hostTemplateAssets(
	mailboxId: string,
	html: string,
	baseUrl: string,
): string {
	if (!html || !html.includes("<img")) return html;

	const prefix = `${baseUrl.replace(/\/+$/, "")}/assets/t/${encodeURIComponent(mailboxId)}/`;
	const rewrites: Array<{ from: string; to: string }> = [];

	for (const match of html.matchAll(IMG_TAG_RE)) {
		const attrs = match[1];
		if (PUBLIC_ASSET_RE.test(attrs)) continue; // already hosted
		const assetId =
			attrs.match(ASSET_ID_ATTR_RE)?.[1] || attrs.match(ASSET_URL_RE)?.[1];
		if (!assetId) continue;

		const rewritten = `<img${attrs
			.replace(/\bsrc\s*=\s*["'][^"']*["']/i, "")
			.replace(ASSET_ID_ATTR_RE, "")
			.replace(/\s+$/, "")} src="${prefix}${assetId}">`;
		rewrites.push({ from: match[0], to: rewritten });
	}

	let result = html;
	for (const { from, to } of rewrites) result = result.split(from).join(to);
	return result;
}

export interface ResolvedTemplateSend {
	subject: string;
	html: string;
	text: string;
}

/**
 * Load a template, render it with the given placeholder values, and point its
 * images at the public asset route. Returns `{ error }` if the template does
 * not exist.
 */
export async function resolveTemplateForSend(
	env: Env,
	mailboxId: string,
	templateId: string,
	values: Record<string, string>,
	baseUrl: string,
): Promise<ResolvedTemplateSend | { error: string }> {
	const stub = getMailboxStub(env, mailboxId) as unknown as TemplateStub;
	const template = await stub.getTemplate(templateId);
	if (!template) {
		return { error: `Template "${templateId}" not found in mailbox "${mailboxId}"` };
	}

	const { subject, html: renderedHtml } = renderTemplate(template, values);
	const html = hostTemplateAssets(mailboxId, renderedHtml, baseUrl);
	return { subject, html, text: stripHtmlToText(html) };
}

/**
 * Render a template to subject + HTML, keeping the in-app `/templates/assets`
 * image URLs. Used for draft creation — the draft is later sent through the
 * normal send path, which swaps those for public URLs.
 */
export async function renderTemplateForDraft(
	env: Env,
	mailboxId: string,
	templateId: string,
	values: Record<string, string> = {},
): Promise<{ subject: string; html: string } | { error: string }> {
	const stub = getMailboxStub(env, mailboxId) as unknown as TemplateStub;
	const template = await stub.getTemplate(templateId);
	if (!template) {
		return { error: `Template "${templateId}" not found in mailbox "${mailboxId}"` };
	}
	return renderTemplate(template, values);
}

interface RequestAttachment {
	content: string;
	filename: string;
	type: string;
	disposition: "attachment" | "inline";
	contentId?: string;
}

export interface SendBody {
	subject?: string;
	html?: string;
	text?: string;
	attachments?: RequestAttachment[];
	template_id?: string;
	placeholders?: Record<string, string>;
}

export interface BuiltSendBody {
	subject: string;
	html?: string;
	text?: string;
	attachments?: RequestAttachment[];
	/** True when a template was applied — callers should skip AI draft verification. */
	fromTemplate: boolean;
}

/**
 * Merge a send/reply/forward request with an optional selected template.
 * A non-empty request `subject` always wins; the template owns the body.
 * `baseUrl` is the deployment's public origin (for hosting template images).
 */
export async function buildSendBody(
	env: Env,
	mailboxId: string,
	body: SendBody,
	baseUrl: string,
): Promise<BuiltSendBody | { error: string }> {
	if (!body.template_id) {
		// A body composed/saved from a template still carries <img data-asset-id>
		// (or /templates/assets/ URLs) — host those so drafts and manual edits
		// deliver images too, not just direct template sends.
		let html = body.html;
		if (html && (html.includes("data-asset-id") || html.includes("/templates/assets/"))) {
			html = hostTemplateAssets(mailboxId, html, baseUrl);
		}
		return {
			subject: body.subject ?? "",
			html,
			text: body.text,
			attachments: body.attachments,
			fromTemplate: false,
		};
	}

	const resolved = await resolveTemplateForSend(
		env,
		mailboxId,
		body.template_id,
		body.placeholders ?? {},
		baseUrl,
	);
	if ("error" in resolved) return resolved;

	return {
		subject: body.subject?.trim() ? body.subject : resolved.subject,
		html: resolved.html,
		text: resolved.text,
		attachments: body.attachments,
		fromTemplate: true,
	};
}
