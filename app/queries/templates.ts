// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { EmailTemplate } from "~/types";
import { queryKeys } from "./keys";

export function useTemplates(mailboxId: string | undefined) {
	return useQuery<EmailTemplate[]>({
		queryKey: mailboxId
			? queryKeys.templates.list(mailboxId)
			: ["templates", "_disabled"],
		queryFn: () => api.listTemplates(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useTemplate(mailboxId: string | undefined, id: string | undefined) {
	return useQuery<EmailTemplate>({
		queryKey:
			mailboxId && id
				? queryKeys.templates.detail(mailboxId, id)
				: ["templates", "_disabled"],
		queryFn: () => api.getTemplate(mailboxId!, id!),
		enabled: !!mailboxId && !!id,
	});
}

export function useCreateTemplate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			data,
		}: {
			mailboxId: string;
			data: Partial<EmailTemplate> & { name: string };
		}) => api.createTemplate(mailboxId, data),
		onSuccess: (_d, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.templates.list(mailboxId) });
		},
	});
}

export function useUpdateTemplate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			data,
		}: {
			mailboxId: string;
			id: string;
			data: Partial<EmailTemplate>;
		}) => api.updateTemplate(mailboxId, id, data),
		onSuccess: (_d, { mailboxId, id }) => {
			qc.invalidateQueries({ queryKey: queryKeys.templates.list(mailboxId) });
			qc.invalidateQueries({ queryKey: queryKeys.templates.detail(mailboxId, id) });
		},
	});
}

export function useDeleteTemplate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteTemplate(mailboxId, id),
		onSuccess: (_d, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.templates.list(mailboxId) });
		},
	});
}
