// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared types and Zod schemas for email data.
 *
 * Types (from email-types.ts): used by the agent, MCP server, and route
 * handlers to avoid `as any` casting.
 *
 * Zod schemas: used across route handlers to eliminate duplication.
 */
import { z } from "zod";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailMetadata {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	read: boolean;
	starred: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	folder_id?: string | null;
	snippet?: string | null;
}

export interface EmailFull extends EmailMetadata {
	body?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const RecipientFieldSchema = z.union([
	z.string().email(),
	z.array(z.string().email()).min(1),
]);

export const ErrorResponseSchema = z.object({
	error: z.string(),
});

/**
 * Optional template selection for send/reply/forward. When `template_id` is
 * set, the server renders the template (subject + body) with `placeholders`
 * and inlines its images; any request-supplied `html`/`text` is ignored for
 * the body, though a non-empty request `subject` still wins.
 */
export const TemplateSendFieldsSchema = {
	template_id: z.string().optional(),
	placeholders: z.record(z.string()).optional(),
};

export const SendEmailRequestSchema = z
	.object({
		to: RecipientFieldSchema,
		cc: RecipientFieldSchema.optional(),
		bcc: RecipientFieldSchema.optional(),
		from: z.union([
			z.string().email(),
			z.object({ email: z.string().email(), name: z.string() }),
		]),
		subject: z.string().optional(),
		html: z.string().optional(),
		text: z.string().optional(),
		attachments: z
			.array(
				z.object({
					content: z.string(), // base64 encoded
					filename: z.string(),
					type: z.string(),
					disposition: z.enum(["attachment", "inline"]),
					contentId: z.string().optional(),
				}),
			)
			.optional(),
		in_reply_to: z.string().optional(),
		references: z.array(z.string()).optional(),
		thread_id: z.string().optional(),
		...TemplateSendFieldsSchema,
	})
	.refine((data) => data.html || data.text || data.template_id, {
		message: "Provide 'html', 'text', or 'template_id'",
	});

const PlaceholderDefSchema = z.object({
	key: z.string().min(1),
	label: z.string().optional(),
	type: z.enum(["text", "html"]).optional(),
	default: z.string().optional(),
});

export const TemplateBodySchema = z.object({
	name: z.string().min(1),
	subject: z.string().optional(),
	body: z.string().optional(),
	placeholders: z.array(PlaceholderDefSchema).optional(),
	assetIds: z.array(z.string()).optional(),
});

export const TemplateUpdateSchema = TemplateBodySchema.partial();

export const TemplateAssetBodySchema = z.object({
	content: z.string(), // base64 encoded
	filename: z.string().min(1),
	type: z.string().min(1),
});

export const SendEmailResponseSchema = z.object({
	id: z.string(),
	status: z.string(),
});

// ── Contacts & Mail Lists ────────────────────────────────────────

export const ContactBodySchema = z.object({
	name: z.string().optional(),
	email: z.string().email(),
});

export const ContactImportSchema = z.object({
	csv: z.string().min(1),
	list_ids: z.array(z.string()).optional(),
});

export const MailListBodySchema = z.object({ name: z.string().min(1) });

export const MailListMembersSchema = z.object({
	contact_ids: z.array(z.string()).min(1),
});

// ── Newsletters ──────────────────────────────────────────────────

const oneRecipientSource = (d: { csv?: string; mail_list_ids?: string[] }) => {
	const hasCsv = !!d.csv;
	const hasLists = !!d.mail_list_ids && d.mail_list_ids.length > 0;
	return hasCsv !== hasLists; // exactly one
};

export const NewsletterValidateSchema = z
	.object({
		csv: z.string().optional(),
		mail_list_ids: z.array(z.string()).optional(),
		template_id: z.string().optional(),
	})
	.refine(oneRecipientSource, {
		message: "Provide either 'csv' or 'mail_list_ids'",
	});

export const NewsletterCreateSchema = z
	.object({
		name: z.string().min(1),
		csv: z.string().optional(),
		mail_list_ids: z.array(z.string()).optional(),
		fixed_placeholders: z.record(z.string()).optional(),
		template_id: z.string().optional(),
		subject: z.string().optional(),
		body: z.string().optional(),
		from_name: z.string().optional(),
		reply_to: z.string().email().optional(),
		// ISO datetime; omitted / past = send on start
		scheduled_at: z.string().datetime().optional(),
	})
	.refine(oneRecipientSource, {
		message: "Provide either 'csv' or 'mail_list_ids'",
	})
	.refine((d) => d.template_id || d.body, {
		message: "Provide a 'template_id' or a 'body'",
	});
