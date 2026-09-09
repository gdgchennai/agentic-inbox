// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Newsletter } from "~/types";
import { queryKeys } from "./keys";

export function useNewsletters(mailboxId: string | undefined) {
	return useQuery<Newsletter[]>({
		queryKey: mailboxId
			? queryKeys.newsletters.list(mailboxId)
			: ["newsletters", "_disabled"],
		queryFn: () => api.listNewsletters(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useNewsletter(
	mailboxId: string | undefined,
	id: string | undefined,
) {
	return useQuery<Newsletter>({
		queryKey:
			mailboxId && id
				? queryKeys.newsletters.detail(mailboxId, id)
				: ["newsletters", "_disabled"],
		queryFn: () => api.getNewsletter(mailboxId!, id!),
		enabled: !!mailboxId && !!id,
		// Poll only while the job is live.
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			return status === "sending" || status === "scheduled" ? 3000 : false;
		},
	});
}

export function useValidateNewsletterCsv() {
	return useMutation({
		mutationFn: ({
			mailboxId,
			csv,
			templateId,
		}: {
			mailboxId: string;
			csv: string;
			templateId?: string;
		}) => api.validateNewsletterCsv(mailboxId, { csv, template_id: templateId }),
	});
}

export function useCreateNewsletter() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			data,
		}: {
			mailboxId: string;
			data: Parameters<typeof api.createNewsletter>[1];
		}) => api.createNewsletter(mailboxId, data),
		onSuccess: (_d, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.newsletters.list(mailboxId) });
		},
	});
}

/** start / pause / resume / cancel — all take { mailboxId, id }, all invalidate. */
function useNewsletterAction(action: "start" | "pause" | "resume" | "cancel") {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api[`${action}Newsletter`](mailboxId, id),
		onSuccess: (_d, { mailboxId, id }) => {
			qc.invalidateQueries({ queryKey: queryKeys.newsletters.list(mailboxId) });
			qc.invalidateQueries({ queryKey: queryKeys.newsletters.detail(mailboxId, id) });
		},
	});
}

export const useStartNewsletter = () => useNewsletterAction("start");
export const usePauseNewsletter = () => useNewsletterAction("pause");
export const useResumeNewsletter = () => useNewsletterAction("resume");
export const useCancelNewsletter = () => useNewsletterAction("cancel");

export function useDeleteNewsletter() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteNewsletter(mailboxId, id),
		onSuccess: (_d, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.newsletters.list(mailboxId) });
		},
	});
}
