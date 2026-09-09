// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared tool business logic for the Agent and MCP server.
 *
 * Each function takes an `env: Env` (or a DO stub) and tool-specific params,
 * performs the business logic (DO calls, data fetching, formatting), and
 * returns a plain object. The Agent and MCP server wrap these results in
 * their own response formats.
 *
 * Functions that already exist in email-helpers.ts (getFullEmail, getFullThread)
 * are reused directly — this module covers the remaining shared operations.
 */

import type { EmailFull } from "./schemas";
import {
	getMailboxStub,
	getFullEmail,
	getFullThread,
	buildQuotedReplyBlock,
	textToHtml,
	listMailboxes,
	generateMessageId,
	buildReferencesChain,
	buildThreadingHeaders,
} from "./email-helpers";
import { verifyDraft } from "./ai";
import {
	resolveTemplateForSend,
	renderTemplateForDraft,
	type InlineAttachment,
} from "./templates";
import { sendEmail } from "../email-sender";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";

// ── Type casts for DO methods not on the base stub type ────────────
type MailboxSearchStub = {
	searchEmails: (options: {
		query: string;
		folder?: string;
	}) => Promise<unknown>;
};

type RateLimitStub = {
	checkSendRateLimit: () => Promise<string | null>;
};

type TemplateListStub = {
	listTemplates: () => Promise<unknown[]>;
	getTemplate: (id: string) => Promise<unknown | null>;
};

// ── list_templates / get_template ─────────────────────────────────

export async function toolListTemplates(env: Env, mailboxId: string) {
	const stub = getMailboxStub(env, mailboxId) as unknown as TemplateListStub;
	return stub.listTemplates();
}

export async function toolGetTemplate(
	env: Env,
	mailboxId: string,
	templateId: string,
) {
	const stub = getMailboxStub(env, mailboxId) as unknown as TemplateListStub;
	const tpl = await stub.getTemplate(templateId);
	return tpl ?? { error: "Template not found" };
}

interface TemplateParams {
	templateId?: string;
	placeholders?: Record<string, string>;
}

/**
 * Resolve the outgoing body for a tool call. When `templateId` is set the
 * template is rendered (with images inlined) and AI draft verification is
 * skipped — verifyDraft flattens HTML to text and would destroy the layout.
 * Otherwise the plain body is run through verifyDraft as before.
 */
async function resolveToolBody(
	env: Env,
	mailboxId: string,
	rawBody: string,
	tpl: TemplateParams,
): Promise<
	| { html: string; templateSubject?: string; attachments: InlineAttachment[] }
	| { error: string }
> {
	if (tpl.templateId) {
		const resolved = await resolveTemplateForSend(
			env,
			mailboxId,
			tpl.templateId,
			tpl.placeholders ?? {},
		);
		if ("error" in resolved) return resolved;
		return {
			html: resolved.html,
			templateSubject: resolved.subject,
			attachments: resolved.attachments,
		};
	}
	const sanitized = await verifyDraft(env.AI, rawBody);
	if (!sanitized) {
		return { error: "Draft verification failed — please try again." };
	}
	return { html: sanitized, attachments: [] };
}

// ── list_mailboxes ─────────────────────────────────────────────────

export async function toolListMailboxes(env: Env) {
	return listMailboxes(env.BUCKET);
}

// ── list_emails ────────────────────────────────────────────────────

export async function toolListEmails(
	env: Env,
	mailboxId: string,
	params: { folder: string; limit: number; page: number },
) {
	const stub = getMailboxStub(env, mailboxId);
	return stub.getEmails({
		folder: params.folder,
		limit: params.limit,
		page: params.page,
		sortColumn: "date",
		sortDirection: "DESC",
	});
}

// ── get_email ──────────────────────────────────────────────────────

export async function toolGetEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	const email = await getFullEmail(stub, emailId);
	if (!email) return { error: "Email not found" };
	return email;
}

// ── get_thread ─────────────────────────────────────────────────────

export async function toolGetThread(
	env: Env,
	mailboxId: string,
	threadId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	return getFullThread(stub, threadId);
}

// ── search_emails ──────────────────────────────────────────────────

export async function toolSearchEmails(
	env: Env,
	mailboxId: string,
	params: { query: string; folder?: string },
) {
	const stub = getMailboxStub(env, mailboxId);
	return (stub as unknown as MailboxSearchStub).searchEmails({
		query: params.query,
		folder: params.folder,
	});
}

// ── draft_reply ────────────────────────────────────────────────────

/**
 * Shared draft-reply logic.
 *
 * @param bodyInput - The reply body text. Can be plain text or HTML.
 * @param options.isPlainText - If true, body is treated as plain text and
 *   converted to HTML. If false, body is treated as HTML.
 * @param options.runVerifyDraft - If true, runs AI verifyDraft on the body.
 *   The agent and MCP both do this, but the agent does it on plain text
 *   while MCP does it on HTML.
 */
export async function toolDraftReply(
	env: Env,
	mailboxId: string,
	params: {
		originalEmailId: string;
		to: string;
		subject: string;
		body?: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
		templateId?: string;
		placeholders?: Record<string, string>;
	},
): Promise<
	| { status: "draft_saved"; draftId: string; message: string; draft: Record<string, string> }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	let processedBody = (params.body ?? "").trim();
	let subject = params.subject;

	if (params.templateId) {
		// Template body is trusted, pre-authored HTML — skip verify + text conversion.
		const rendered = await renderTemplateForDraft(
			env,
			mailboxId,
			params.templateId,
			params.placeholders ?? {},
		);
		if ("error" in rendered) return { error: rendered.error };
		processedBody = rendered.html;
		if (!subject?.trim()) subject = rendered.subject;
	} else {
		// Verify/sanitize if requested
		if (params.runVerifyDraft) {
			const sanitized = await verifyDraft(env.AI, processedBody);
			if (!sanitized) {
				return { error: "Draft verification failed — body could not be verified. Please try again." };
			}
			processedBody = sanitized;
		}
		// Convert plain text to HTML if needed
		if (params.isPlainText) {
			processedBody = textToHtml(processedBody);
		}
	}

	const draftId = crypto.randomUUID();

	// Get the original email for thread_id and quoted text
	const original = (await stub.getEmail(params.originalEmailId)) as EmailFull | null;
	const threadId = original?.thread_id || params.originalEmailId;

	// Append quoted original message
	const quotedBlock = original
		? buildQuotedReplyBlock({
				date: original.date,
				sender: original.sender || params.to,
				body: original.body ?? undefined,
			})
		: "";
	const bodyHtml = processedBody + quotedBlock;

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject,
			sender: mailboxId.toLowerCase(),
			recipient: params.to.toLowerCase(),
			date: new Date().toISOString(),
			body: bodyHtml,
			in_reply_to: params.originalEmailId,
			email_references: null,
			thread_id: threadId,
		},
		[],
	);

	return {
		status: "draft_saved",
		draftId,
		message: "Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			originalEmailId: params.originalEmailId,
			to: params.to,
			subject,
			body: params.isPlainText && !params.templateId ? (params.body ?? "").trim() : bodyHtml,
		},
	};
}

// ── draft_email (new email, not a reply) ───────────────────────────

export async function toolDraftEmail(
	env: Env,
	mailboxId: string,
	params: {
		to: string;
		subject: string;
		body?: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
		/** Optional in_reply_to for create_draft style */
		in_reply_to?: string;
		/** Optional thread_id for create_draft style */
		thread_id?: string;
		templateId?: string;
		placeholders?: Record<string, string>;
	},
): Promise<
	| { status: string; draftId: string; threadId?: string; message: string; draft?: Record<string, string> }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	let processedBody = (params.body ?? "").trim();
	let subject = params.subject;

	if (params.templateId) {
		const rendered = await renderTemplateForDraft(
			env,
			mailboxId,
			params.templateId,
			params.placeholders ?? {},
		);
		if ("error" in rendered) return { error: rendered.error };
		processedBody = rendered.html;
		if (!subject?.trim()) subject = rendered.subject;
	} else {
		if (params.runVerifyDraft) {
			const sanitized = await verifyDraft(env.AI, processedBody);
			if (!sanitized) {
				return { error: "Draft verification failed — body could not be verified. Please try again." };
			}
			processedBody = sanitized;
		}
		if (params.isPlainText) {
			processedBody = textToHtml(processedBody);
		}
	}

	const draftId = crypto.randomUUID();

	// Resolve thread ID
	let resolvedThreadId = params.thread_id;
	if (!resolvedThreadId && params.in_reply_to) {
		const original = (await stub.getEmail(params.in_reply_to)) as EmailFull | null;
		resolvedThreadId = original?.thread_id || params.in_reply_to;
	}
	if (!resolvedThreadId) {
		resolvedThreadId = draftId;
	}

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject,
			sender: mailboxId.toLowerCase(),
			recipient: (params.to || "").toLowerCase(),
			date: new Date().toISOString(),
			body: processedBody,
			in_reply_to: params.in_reply_to || null,
			email_references: null,
			thread_id: resolvedThreadId,
		},
		[],
	);

	return {
		status: "draft_saved",
		draftId,
		threadId: resolvedThreadId,
		message: "Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			to: params.to,
			subject,
			body: params.isPlainText && !params.templateId ? (params.body ?? "").trim() : processedBody,
		},
	};
}

// ── update_draft ───────────────────────────────────────────────────

export async function toolUpdateDraft(
	env: Env,
	mailboxId: string,
	params: {
		draftId: string;
		to?: string;
		subject?: string;
		bodyHtml?: string;
	},
): Promise<
	| { status: string; newDraftId: string; oldDraftId: string; message: string }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	const oldDraft = (await stub.getEmail(params.draftId)) as EmailFull | null;
	if (!oldDraft) {
		return { error: "Draft not found" };
	}

	// Verify the body BEFORE deleting the old draft to prevent data loss
	const newDraftId = crypto.randomUUID();
	const rawBody = params.bodyHtml ?? oldDraft.body ?? "";
	const verifiedBody = await verifyDraft(env.AI, rawBody);

	if (!verifiedBody) {
		return { error: "Draft verification failed — keeping existing draft unchanged. Please try again." };
	}

	await stub.deleteEmail(params.draftId);
	await stub.createEmail(
		Folders.DRAFT,
		{
			id: newDraftId,
			subject: params.subject ?? oldDraft.subject,
			sender: mailboxId.toLowerCase(),
			recipient: (params.to ?? oldDraft.recipient).toLowerCase(),
			date: new Date().toISOString(),
			body: verifiedBody,
			in_reply_to: oldDraft.in_reply_to || null,
			email_references: oldDraft.email_references || null,
			thread_id: oldDraft.thread_id || newDraftId,
		},
		[],
	);

	return {
		status: "draft_updated",
		newDraftId,
		oldDraftId: params.draftId,
		message: "Draft updated in Drafts folder.",
	};
}

// ── mark_email_read ────────────────────────────────────────────────

export async function toolMarkEmailRead(
	env: Env,
	mailboxId: string,
	emailId: string,
	read: boolean,
) {
	const stub = getMailboxStub(env, mailboxId);
	await stub.updateEmail(emailId, { read });
	return { status: "updated", emailId, read };
}

// ── move_email ─────────────────────────────────────────────────────

export async function toolMoveEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
	folderId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	const success = await stub.moveEmail(emailId, folderId);
	if (success) {
		return { status: "moved", emailId, folder: folderId };
	}
	return { error: "Failed to move email" };
}

// ── discard_draft ──────────────────────────────────────────────────

export async function toolDiscardDraft(
	env: Env,
	mailboxId: string,
	draftId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	const email = (await stub.getEmail(draftId)) as { folder_id?: string } | null;
	if (!email) {
		return { error: "Draft not found" };
	}
	if (email.folder_id !== Folders.DRAFT) {
		return { error: "Cannot discard: email is not a draft" };
	}
	await stub.deleteEmail(draftId);
	return { status: "discarded", draftId };
}

// ── delete_email ───────────────────────────────────────────────────

export async function toolDeleteEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	const result = await stub.deleteEmail(emailId);
	if (result === null) {
		return { error: "Email not found", emailId };
	}
	return { status: "deleted", emailId };
}

// ── send_reply ─────────────────────────────────────────────────────

export async function toolSendReply(
	env: Env,
	mailboxId: string,
	params: {
		originalEmailId: string;
		to: string;
		subject?: string;
		bodyHtml?: string;
		templateId?: string;
		placeholders?: Record<string, string>;
	},
): Promise<
	| { status: "sent"; messageId: string; message: string }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	// Check send rate limit
	const rateLimitError = await (stub as unknown as RateLimitStub).checkSendRateLimit();
	if (rateLimitError) {
		return { error: rateLimitError };
	}

	const originalEmail = (await stub.getEmail(params.originalEmailId)) as EmailFull | null;
	if (!originalEmail) {
		return { error: "Original email not found" };
	}

	const { originalMsgId, references, threadId } = buildReferencesChain(originalEmail);
	const fromDomain = mailboxId.split("@")[1];
	if (!fromDomain) throw new Error("Invalid mailbox email address");
	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	// Resolve the body (template render, or AI-verified plain body) and append
	// the quoted original message.
	const resolvedBody = await resolveToolBody(env, mailboxId, params.bodyHtml ?? "", params);
	if ("error" in resolvedBody) return { error: resolvedBody.error };
	const subject = params.subject?.trim()
		? params.subject
		: (resolvedBody.templateSubject ?? params.subject ?? "");
	const quotedBlock = buildQuotedReplyBlock({
		date: originalEmail.date,
		sender: originalEmail.sender || params.to,
		body: originalEmail.body ?? undefined,
	});
	const fullBodyHtml = resolvedBody.html + quotedBlock;

	try {
		await sendEmail(env.EMAIL, {
			to: params.to,
			from: mailboxId,
			subject,
			html: fullBodyHtml,
			headers: buildThreadingHeaders(originalMsgId, references),
			...(resolvedBody.attachments.length
				? { attachments: resolvedBody.attachments }
				: {}),
		});
	} catch (e) {
		console.error("Email send failed:", (e as Error).message);
		return { error: `Failed to send reply: ${(e as Error).message}` };
	}

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject,
			sender: mailboxId.toLowerCase(),
			recipient: params.to.toLowerCase(),
			date: new Date().toISOString(),
			body: fullBodyHtml,
			in_reply_to: originalMsgId,
			email_references:
				references.length > 0 ? JSON.stringify(references) : null,
			thread_id: threadId,
			message_id: outgoingMessageId,
		},
		[],
	);

	return { status: "sent", messageId, message: `Reply sent to ${params.to}` };
}

// ── send_email ─────────────────────────────────────────────────────

export async function toolSendEmail(
	env: Env,
	mailboxId: string,
	params: {
		to: string;
		subject?: string;
		bodyHtml?: string;
		templateId?: string;
		placeholders?: Record<string, string>;
	},
): Promise<
	| { status: "sent"; messageId: string; message: string }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	// Check send rate limit
	const rateLimitError = await (stub as unknown as RateLimitStub).checkSendRateLimit();
	if (rateLimitError) {
		return { error: rateLimitError };
	}

	const fromDomain = mailboxId.split("@")[1];
	if (!fromDomain) throw new Error("Invalid mailbox email address");
	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const resolvedBody = await resolveToolBody(env, mailboxId, params.bodyHtml ?? "", params);
	if ("error" in resolvedBody) return { error: resolvedBody.error };
	const subject = params.subject?.trim()
		? params.subject
		: (resolvedBody.templateSubject ?? params.subject ?? "");

	try {
		await sendEmail(env.EMAIL, {
			to: params.to,
			from: mailboxId,
			subject,
			html: resolvedBody.html,
			...(resolvedBody.attachments.length
				? { attachments: resolvedBody.attachments }
				: {}),
		});
	} catch (e) {
		console.error("Email send failed:", (e as Error).message);
		return { error: `Failed to send email: ${(e as Error).message}` };
	}

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject,
			sender: mailboxId.toLowerCase(),
			recipient: params.to.toLowerCase(),
			date: new Date().toISOString(),
			body: resolvedBody.html,
			in_reply_to: null,
			email_references: null,
			thread_id: messageId,
			message_id: outgoingMessageId,
		},
		[],
	);

	return { status: "sent", messageId, message: `Email sent to ${params.to}` };
}
