// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const folders = sqliteTable("folders", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	is_deletable: integer("is_deletable").notNull().default(1),
});

export const emails = sqliteTable("emails", {
	id: text("id").primaryKey(),
	folder_id: text("folder_id")
		.notNull()
		.references(() => folders.id, { onDelete: "cascade" }),
	subject: text("subject"),
	sender: text("sender"),
	recipient: text("recipient"),
	cc: text("cc"),
	bcc: text("bcc"),
	date: text("date"),
	read: integer("read").default(0),
	starred: integer("starred").default(0),
	body: text("body"),
	in_reply_to: text("in_reply_to"),
	email_references: text("email_references"),
	thread_id: text("thread_id"),
	message_id: text("message_id"),
	raw_headers: text("raw_headers"),
});

export const attachments = sqliteTable("attachments", {
	id: text("id").primaryKey(),
	email_id: text("email_id")
		.notNull()
		.references(() => emails.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	mimetype: text("mimetype").notNull(),
	size: integer("size").notNull(),
	content_id: text("content_id"),
	disposition: text("disposition"),
});

export const templates = sqliteTable("templates", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	subject: text("subject").notNull().default(""),
	body: text("body").notNull().default(""),
	// JSON-encoded TemplatePlaceholder[] (see shared/templates.ts)
	placeholders: text("placeholders").notNull().default("[]"),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
});

export const templateAssets = sqliteTable("template_assets", {
	id: text("id").primaryKey(),
	template_id: text("template_id"),
	filename: text("filename").notNull(),
	mimetype: text("mimetype").notNull(),
	size: integer("size").notNull(),
	content_id: text("content_id").notNull(),
	created_at: text("created_at").notNull(),
});

/** A bulk "Send Newsletter" job (see workers/lib/newsletter.ts). */
export const newsletters = sqliteTable("newsletters", {
	id: text("id").primaryKey(),
	// the mailbox address this DO belongs to (constant per DO, stored for the alarm)
	mailbox_id: text("mailbox_id").notNull(),
	name: text("name").notNull(),
	// draft | scheduled | sending | paused | completed | canceled | failed
	status: text("status").notNull().default("draft"),
	template_id: text("template_id"),
	subject: text("subject"),
	body: text("body"),
	from_name: text("from_name"),
	reply_to: text("reply_to"),
	total: integer("total").notNull().default(0),
	sent: integer("sent").notNull().default(0),
	failed: integer("failed").notNull().default(0),
	scheduled_at: text("scheduled_at"),
	started_at: text("started_at"),
	completed_at: text("completed_at"),
	error: text("error"),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
});

export const newsletterRecipients = sqliteTable("newsletter_recipients", {
	id: text("id").primaryKey(),
	newsletter_id: text("newsletter_id").notNull(),
	email: text("email").notNull(),
	// JSON: { placeholderKey: value } — only columns matching template placeholders
	vars: text("vars").notNull().default("{}"),
	status: text("status").notNull().default("pending"), // pending | sent | failed
	error: text("error"),
	sent_at: text("sent_at"),
});

/** Reusable address-book entry (see workers/lib/contacts.ts). Unique per email. */
export const contacts = sqliteTable("contacts", {
	id: text("id").primaryKey(),
	email: text("email").notNull(),
	name: text("name").notNull().default(""),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
});

/** A named group of contacts, usable as a newsletter recipient source. */
export const mailLists = sqliteTable("mail_lists", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
});

/** Contact ⇄ mail list many-to-many. */
export const mailListMembers = sqliteTable("mail_list_members", {
	mail_list_id: text("mail_list_id").notNull(),
	contact_id: text("contact_id").notNull(),
});
