// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Worker-side template send helpers.
 *
 * `shared/templates.ts` holds the pure render logic (token substitution).
 * This module adds the parts that need the Worker runtime: loading a
 * template from the mailbox Durable Object, and turning template-managed
 * images into inline CID attachments so they render in every mail client
 * (the app sits behind Cloudflare Access, so hosted image URLs would not
 * load for recipients).
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
	getTemplateAsset: (id: string) => Promise<{
		id: string;
		template_id: string | null;
		filename: string;
		mimetype: string;
		size: number;
		content_id: string;
	} | null>;
}

export interface InlineAttachment {
	content: string; // base64
	filename: string;
	type: string;
	disposition: "inline";
	contentId: string;
}

/** Base64-encode an ArrayBuffer without blowing the call stack on large blobs. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

// Matches an <img> tag and captures its attribute string.
const IMG_TAG_RE = /<img\b([^>]*)>/gi;
const ASSET_ID_ATTR_RE = /\bdata-asset-id\s*=\s*["']([^"']+)["']/i;
// Also recognise assets referenced by their in-app URL.
const ASSET_URL_RE = /\/templates\/assets\/([0-9a-f-]{36})/i;

/**
 * Replace `<img data-asset-id="…">` (or an img whose src points at the
 * in-app `/templates/assets/<id>` route) with `<img src="cid:…">` and
 * return the matching inline attachments.
 */
export async function inlineTemplateAssets(
	env: Env,
	mailboxId: string,
	html: string,
): Promise<{ html: string; attachments: InlineAttachment[] }> {
	if (!html || !html.includes("<img")) return { html, attachments: [] };

	const stub = getMailboxStub(env, mailboxId) as unknown as TemplateStub;
	const attachments: InlineAttachment[] = [];
	const seen = new Set<string>();

	const tags = [...html.matchAll(IMG_TAG_RE)];
	let result = html;

	for (const match of tags) {
		const attrs = match[1];
		const assetId =
			attrs.match(ASSET_ID_ATTR_RE)?.[1] || attrs.match(ASSET_URL_RE)?.[1];
		if (!assetId) continue;

		const asset = await stub.getTemplateAsset(assetId);
		if (!asset) continue;

		if (!seen.has(assetId)) {
			seen.add(assetId);
			const key = `template-assets/${mailboxId}/${assetId}/${asset.filename}`;
			const obj = await env.BUCKET.get(key);
			if (!obj) continue;
			attachments.push({
				content: arrayBufferToBase64(await obj.arrayBuffer()),
				filename: asset.filename,
				type: asset.mimetype,
				disposition: "inline",
				contentId: asset.content_id,
			});
		}

		// Rewrite this specific tag: drop any existing src / data-asset-id,
		// then point src at the cid.
		const rewritten = `<img${attrs
			.replace(/\bsrc\s*=\s*["'][^"']*["']/i, "")
			.replace(ASSET_ID_ATTR_RE, "")
			.trimEnd()} src="cid:${asset.content_id}">`;
		result = result.replace(match[0], rewritten);
	}

	return { html: result, attachments };
}

export interface ResolvedTemplateSend {
	subject: string;
	html: string;
	text: string;
	attachments: InlineAttachment[];
}

/**
 * Load a template, render it with the given placeholder values, and inline
 * its images. Returns `{ error }` if the template does not exist.
 */
export async function resolveTemplateForSend(
	env: Env,
	mailboxId: string,
	templateId: string,
	values: Record<string, string> = {},
): Promise<ResolvedTemplateSend | { error: string }> {
	const stub = getMailboxStub(env, mailboxId) as unknown as TemplateStub;
	const template = await stub.getTemplate(templateId);
	if (!template) return { error: `Template "${templateId}" not found` };

	const { subject, html: renderedHtml } = renderTemplate(template, values);
	const { html, attachments } = await inlineTemplateAssets(env, mailboxId, renderedHtml);

	return { subject, html, text: stripHtmlToText(html), attachments };
}

/**
 * Render a template to subject + HTML without inlining images (asset <img>
 * tags keep their in-app URLs). Used for draft creation, where the body is
 * later edited/sent through the normal send path which does the inlining.
 */
export async function renderTemplateForDraft(
	env: Env,
	mailboxId: string,
	templateId: string,
	values: Record<string, string> = {},
): Promise<{ subject: string; html: string } | { error: string }> {
	const stub = getMailboxStub(env, mailboxId) as unknown as TemplateStub;
	const template = await stub.getTemplate(templateId);
	if (!template) return { error: `Template "${templateId}" not found` };
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
 */
export async function buildSendBody(
	env: Env,
	mailboxId: string,
	body: SendBody,
): Promise<BuiltSendBody | { error: string }> {
	if (!body.template_id) {
		// A body composed/saved from a template still carries <img data-asset-id>
		// (or /templates/assets/ URLs) — inline those so drafts and manual edits
		// deliver images too, not just direct template sends.
		let html = body.html;
		let attachments = body.attachments;
		if (html && (html.includes("data-asset-id") || html.includes("/templates/assets/"))) {
			const inlined = await inlineTemplateAssets(env, mailboxId, html);
			html = inlined.html;
			attachments = [...(body.attachments ?? []), ...inlined.attachments];
		}
		return {
			subject: body.subject ?? "",
			html,
			text: body.text,
			attachments,
			fromTemplate: false,
		};
	}

	const resolved = await resolveTemplateForSend(
		env,
		mailboxId,
		body.template_id,
		body.placeholders ?? {},
	);
	if ("error" in resolved) return resolved;

	return {
		subject: body.subject?.trim() ? body.subject : resolved.subject,
		html: resolved.html,
		text: resolved.text,
		attachments: [...(body.attachments ?? []), ...resolved.attachments],
		fromTemplate: true,
	};
}
