// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type {
	Contact,
	ContactImportResult,
	Email,
	EmailTemplate,
	Folder,
	Mailbox,
	MailList,
	MailListDetail,
	Newsletter,
	NewsletterCsvValidation,
	TemplateAssetUpload,
} from "~/types";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super((body.error as string) || `Request failed: ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

async function request<T>(
	url: string,
	options: RequestInit = {},
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	// Combine caller signal (e.g. TanStack Query abort) with our timeout signal
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			...options,
			signal,
			headers: {
				"Content-Type": "application/json",
				...(options.headers as Record<string, string>),
			},
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new ApiError(res.status, body as Record<string, unknown>);
		}

		if (res.status === 204) return undefined as T;

		const contentType = res.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			return res.json() as Promise<T>;
		}
		return res.blob() as unknown as T;
	} finally {
		clearTimeout(timeout);
	}
}

function get<T>(url: string, opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal }) {
	const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
	return request<T>(`${url}${query}`, {
		method: "GET",
		signal: opts?.signal,
		...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
	});
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) {
	return request<T>(url, {
		method: "POST",
		signal: opts?.signal,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function put<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PUT",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string) {
	return request<T>(url, { method: "DELETE" });
}

// ---------- Typed response shapes ----------

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
}

// ---------- API client ----------

const api = {
	// Config
	getConfig: () =>
		get<{ domains: string[]; emailAddresses: string[] }>("/api/v1/config"),

	// Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	createMailbox: (email: string, name: string, settings?: unknown) =>
		post<Mailbox>("/api/v1/mailboxes", { email, name, settings }),
	getMailbox: (mailboxId: string) =>
		get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
	updateMailbox: (mailboxId: string, settings: unknown) =>
		put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),
	deleteMailbox: (mailboxId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}`),

	// Emails
	listEmails: (mailboxId: string, params: Record<string, string>, opts?: { signal?: AbortSignal }) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, { params, signal: opts?.signal }),
	sendEmail: (mailboxId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	updateEmail: (mailboxId: string, id: string, data: unknown) =>
		put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
	deleteEmail: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
	moveEmail: (mailboxId: string, id: string, folderId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, { folderId }),
	getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
	markThreadRead: (mailboxId: string, threadId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
	getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
		get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, { responseType: "blob" }),
	saveDraft: (
		mailboxId: string,
		draft: {
			to?: string;
			cc?: string;
			bcc?: string;
			subject?: string;
			body?: string;
			in_reply_to?: string;
			thread_id?: string;
			draft_id?: string;
			template_id?: string;
			placeholders?: Record<string, string>;
		},
	) => post<{ draft_id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
	replyToEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
	forwardEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

	// Folders
	listFolders: (mailboxId: string) =>
		get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),
	createFolder: (mailboxId: string, name: string) =>
		post<Folder>(`/api/v1/mailboxes/${mailboxId}/folders`, { name }),
	updateFolder: (mailboxId: string, id: string, name: string) =>
		put<Folder>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`, { name }),
	deleteFolder: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`),

	// Search
	searchEmails: (mailboxId: string, params: Record<string, string>) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),

	// Templates
	listTemplates: (mailboxId: string) =>
		get<EmailTemplate[]>(`/api/v1/mailboxes/${mailboxId}/templates`),
	getTemplate: (mailboxId: string, id: string) =>
		get<EmailTemplate>(`/api/v1/mailboxes/${mailboxId}/templates/${id}`),
	createTemplate: (mailboxId: string, data: Partial<EmailTemplate> & { name: string }) =>
		post<EmailTemplate>(`/api/v1/mailboxes/${mailboxId}/templates`, data),
	updateTemplate: (mailboxId: string, id: string, data: Partial<EmailTemplate>) =>
		put<EmailTemplate>(`/api/v1/mailboxes/${mailboxId}/templates/${id}`, data),
	deleteTemplate: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/templates/${id}`),
	uploadTemplateAsset: async (
		mailboxId: string,
		file: File,
	): Promise<TemplateAssetUpload> => {
		const content = await fileToBase64(file);
		return post<TemplateAssetUpload>(
			`/api/v1/mailboxes/${mailboxId}/templates/assets`,
			{ content, filename: file.name, type: file.type || "application/octet-stream" },
		);
	},

	// MCP
	getMcpTools: () =>
		get<{ tools: { name: string; description: string }[] }>("/api/v1/mcp/tools"),

	// Contacts & Mail Lists
	listContacts: (mailboxId: string, params?: Record<string, string>) =>
		get<{ contacts: Contact[]; total: number }>(
			`/api/v1/mailboxes/${mailboxId}/contacts`,
			{ params },
		),
	upsertContact: (mailboxId: string, data: { name?: string; email: string }) =>
		post<Contact & { created: boolean }>(
			`/api/v1/mailboxes/${mailboxId}/contacts`,
			data,
		),
	updateContact: (
		mailboxId: string,
		id: string,
		data: { name?: string; email?: string },
	) => put<Contact>(`/api/v1/mailboxes/${mailboxId}/contacts/${id}`, data),
	deleteContact: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/contacts/${id}`),
	importContacts: (
		mailboxId: string,
		data: { csv: string; list_ids?: string[] },
	) =>
		post<ContactImportResult>(
			`/api/v1/mailboxes/${mailboxId}/contacts/import`,
			data,
		),
	listMailLists: (mailboxId: string) =>
		get<MailList[]>(`/api/v1/mailboxes/${mailboxId}/mail-lists`),
	getMailList: (mailboxId: string, id: string) =>
		get<MailListDetail>(`/api/v1/mailboxes/${mailboxId}/mail-lists/${id}`),
	createMailList: (mailboxId: string, data: { name: string }) =>
		post<MailListDetail>(`/api/v1/mailboxes/${mailboxId}/mail-lists`, data),
	updateMailList: (mailboxId: string, id: string, data: { name: string }) =>
		put<MailListDetail>(`/api/v1/mailboxes/${mailboxId}/mail-lists/${id}`, data),
	deleteMailList: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/mail-lists/${id}`),
	addListMembers: (mailboxId: string, id: string, contactIds: string[]) =>
		post<MailListDetail>(
			`/api/v1/mailboxes/${mailboxId}/mail-lists/${id}/members`,
			{ contact_ids: contactIds },
		),
	removeListMember: (mailboxId: string, id: string, contactId: string) =>
		del<void>(
			`/api/v1/mailboxes/${mailboxId}/mail-lists/${id}/members/${contactId}`,
		),

	// Newsletters
	listNewsletters: (mailboxId: string) =>
		get<Newsletter[]>(`/api/v1/mailboxes/${mailboxId}/newsletters`),
	getNewsletter: (mailboxId: string, id: string) =>
		get<Newsletter>(`/api/v1/mailboxes/${mailboxId}/newsletters/${id}`),
	validateNewsletterCsv: (
		mailboxId: string,
		data: { csv?: string; mail_list_ids?: string[]; template_id?: string },
	) =>
		post<NewsletterCsvValidation>(
			`/api/v1/mailboxes/${mailboxId}/newsletters/validate`,
			data,
		),
	createNewsletter: (
		mailboxId: string,
		data: {
			name: string;
			csv?: string;
			mail_list_ids?: string[];
			fixed_placeholders?: Record<string, string>;
			template_id?: string;
			subject?: string;
			body?: string;
			from_name?: string;
			reply_to?: string;
			scheduled_at?: string;
		},
	) =>
		post<{ newsletter: Newsletter; skippedInvalid: number; duplicatesRemoved: number }>(
			`/api/v1/mailboxes/${mailboxId}/newsletters`,
			data,
		),
	startNewsletter: (mailboxId: string, id: string) =>
		post<Newsletter>(`/api/v1/mailboxes/${mailboxId}/newsletters/${id}/start`),
	pauseNewsletter: (mailboxId: string, id: string) =>
		post<{ status: string }>(`/api/v1/mailboxes/${mailboxId}/newsletters/${id}/pause`),
	resumeNewsletter: (mailboxId: string, id: string) =>
		post<{ status: string }>(`/api/v1/mailboxes/${mailboxId}/newsletters/${id}/resume`),
	cancelNewsletter: (mailboxId: string, id: string) =>
		post<{ status: string }>(`/api/v1/mailboxes/${mailboxId}/newsletters/${id}/cancel`),
	deleteNewsletter: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/newsletters/${id}`),
};

/** Read a File as a base64 string (no data: prefix). */
function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

export default api;
