// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Contact, MailList, MailListDetail } from "~/types";
import { queryKeys } from "./keys";

export function useContacts(mailboxId: string | undefined, query = "") {
	return useQuery<{ contacts: Contact[]; total: number }>({
		queryKey: mailboxId
			? queryKeys.contacts.list(mailboxId, query)
			: ["contacts", "_disabled"],
		queryFn: () =>
			api.listContacts(mailboxId!, query ? { query, limit: "200" } : { limit: "200" }),
		enabled: !!mailboxId,
	});
}

function invalidateContacts(qc: ReturnType<typeof useQueryClient>, mailboxId: string) {
	qc.invalidateQueries({ queryKey: ["contacts", mailboxId] });
	qc.invalidateQueries({ queryKey: ["mail-lists", mailboxId] });
}

export function useUpsertContact() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			data,
		}: {
			mailboxId: string;
			data: { name?: string; email: string };
		}) => api.upsertContact(mailboxId, data),
		onSuccess: (_d, { mailboxId }) => invalidateContacts(qc, mailboxId),
	});
}

export function useUpdateContact() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			data,
		}: {
			mailboxId: string;
			id: string;
			data: { name?: string; email?: string };
		}) => api.updateContact(mailboxId, id, data),
		onSuccess: (_d, { mailboxId }) => invalidateContacts(qc, mailboxId),
	});
}

export function useDeleteContact() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteContact(mailboxId, id),
		onSuccess: (_d, { mailboxId }) => invalidateContacts(qc, mailboxId),
	});
}

export function useImportContacts() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			data,
		}: {
			mailboxId: string;
			data: { csv: string; list_ids?: string[] };
		}) => api.importContacts(mailboxId, data),
		onSuccess: (_d, { mailboxId }) => invalidateContacts(qc, mailboxId),
	});
}

export function useMailLists(mailboxId: string | undefined) {
	return useQuery<MailList[]>({
		queryKey: mailboxId
			? queryKeys.mailLists.list(mailboxId)
			: ["mail-lists", "_disabled"],
		queryFn: () => api.listMailLists(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useMailList(mailboxId: string | undefined, id: string | undefined) {
	return useQuery<MailListDetail>({
		queryKey:
			mailboxId && id
				? queryKeys.mailLists.detail(mailboxId, id)
				: ["mail-lists", "_disabled"],
		queryFn: () => api.getMailList(mailboxId!, id!),
		enabled: !!mailboxId && !!id,
	});
}

function invalidateLists(
	qc: ReturnType<typeof useQueryClient>,
	mailboxId: string,
	id?: string,
) {
	qc.invalidateQueries({ queryKey: queryKeys.mailLists.list(mailboxId) });
	if (id) qc.invalidateQueries({ queryKey: queryKeys.mailLists.detail(mailboxId, id) });
	qc.invalidateQueries({ queryKey: ["contacts", mailboxId] });
}

export function useCreateMailList() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, name }: { mailboxId: string; name: string }) =>
			api.createMailList(mailboxId, { name }),
		onSuccess: (_d, { mailboxId }) => invalidateLists(qc, mailboxId),
	});
}

export function useUpdateMailList() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			name,
		}: {
			mailboxId: string;
			id: string;
			name: string;
		}) => api.updateMailList(mailboxId, id, { name }),
		onSuccess: (_d, { mailboxId, id }) => invalidateLists(qc, mailboxId, id),
	});
}

export function useDeleteMailList() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteMailList(mailboxId, id),
		onSuccess: (_d, { mailboxId }) => invalidateLists(qc, mailboxId),
	});
}

export function useAddListMembers() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			contactIds,
		}: {
			mailboxId: string;
			id: string;
			contactIds: string[];
		}) => api.addListMembers(mailboxId, id, contactIds),
		onSuccess: (_d, { mailboxId, id }) => invalidateLists(qc, mailboxId, id),
	});
}

export function useRemoveListMember() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			contactId,
		}: {
			mailboxId: string;
			id: string;
			contactId: string;
		}) => api.removeListMember(mailboxId, id, contactId),
		onSuccess: (_d, { mailboxId, id }) => invalidateLists(qc, mailboxId, id),
	});
}
