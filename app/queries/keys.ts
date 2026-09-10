// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Centralised query key factories for cache invalidation. */
export const queryKeys = {
	mailboxes: {
		all: ["mailboxes"] as const,
		detail: (id: string) => ["mailboxes", id] as const,
	},
	emails: {
		list: (mailboxId: string, params: Record<string, string>) =>
			["emails", mailboxId, params] as const,
		detail: (mailboxId: string, emailId: string) =>
			["emails", mailboxId, emailId] as const,
		thread: (mailboxId: string, threadId: string) =>
			["emails", mailboxId, "thread", threadId] as const,
	},
	folders: {
		list: (mailboxId: string) => ["folders", mailboxId] as const,
	},
	search: {
		results: (mailboxId: string, query: string, page: number) =>
			["search", mailboxId, query, page] as const,
	},
	templates: {
		list: (mailboxId: string) => ["templates", mailboxId] as const,
		detail: (mailboxId: string, id: string) => ["templates", mailboxId, id] as const,
	},
	newsletters: {
		list: (mailboxId: string) => ["newsletters", mailboxId] as const,
		detail: (mailboxId: string, id: string) => ["newsletters", mailboxId, id] as const,
	},
	contacts: {
		list: (mailboxId: string, query: string) =>
			["contacts", mailboxId, query] as const,
	},
	mailLists: {
		list: (mailboxId: string) => ["mail-lists", mailboxId] as const,
		detail: (mailboxId: string, id: string) => ["mail-lists", mailboxId, id] as const,
	},
	config: ["config"] as const,
};
