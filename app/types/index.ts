// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface SignatureSettings {
	enabled: boolean;
	text: string;
	html?: string;
}

export interface MailboxSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string };
	signature?: SignatureSettings;
	autoReply?: { enabled: boolean; subject: string; message: string };
	agentSystemPrompt?: string;
}

export interface Mailbox {
	id: string;
	email: string;
	name: string;
	settings?: MailboxSettings;
}

export interface Email {
	id: string;
	thread_id?: string | null;
	folder_id?: string | null;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string;
	bcc?: string;
	date: string;
	read: boolean;
	starred: boolean;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: Attachment[];
	snippet?: string | null;
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
}

export interface Attachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string;
	disposition?: string;
}

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
}

export type { TemplatePlaceholder, EmailTemplate } from "shared/templates";

export interface TemplateAssetUpload {
	id: string;
	contentId: string;
	url: string;
}

export type NewsletterStatus =
	| "draft"
	| "scheduled"
	| "sending"
	| "paused"
	| "completed"
	| "canceled"
	| "failed";

export interface Newsletter {
	id: string;
	name: string;
	status: NewsletterStatus;
	template_id: string | null;
	subject: string | null;
	body: string | null;
	from_name: string | null;
	reply_to: string | null;
	total: number;
	sent: number;
	failed: number;
	scheduled_at: string | null;
	started_at: string | null;
	completed_at: string | null;
	error: string | null;
	created_at: string;
	updated_at: string;
	failedRecipients?: { email: string; error: string | null }[];
}

export interface NewsletterCsvValidation {
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
}
