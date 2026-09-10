// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Modal contact picker for the composer's "To" field. Search + multi-select,
 * then "Add" appends the chosen addresses to the recipient string.
 */

import { Button, Dialog, Input, Loader } from "@cloudflare/kumo";
import { useState } from "react";
import { useContacts } from "~/queries/contacts";

interface ContactBrowserProps {
	mailboxId: string | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdd: (emails: string[]) => void;
}

export default function ContactBrowser({
	mailboxId,
	open,
	onOpenChange,
	onAdd,
}: ContactBrowserProps) {
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const { data, isLoading } = useContacts(open ? mailboxId : undefined, query);

	const toggle = (email: string) =>
		setPicked((prev) => {
			const next = new Set(prev);
			next.has(email) ? next.delete(email) : next.add(email);
			return next;
		});

	const close = () => {
		setPicked(new Set());
		setQuery("");
		onOpenChange(false);
	};

	return (
		<Dialog.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
			<Dialog size="sm" className="p-5">
				<Dialog.Title className="text-base font-semibold mb-3">
					Add contacts
				</Dialog.Title>
				<div className="mb-2">
					<Input
						size="sm"
						placeholder="Search name or email"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>
				<div className="max-h-72 overflow-y-auto border border-kumo-line rounded-md divide-y divide-kumo-line">
					{isLoading ? (
						<div className="flex justify-center py-8">
							<Loader size="base" />
						</div>
					) : !data || data.contacts.length === 0 ? (
						<p className="px-3 py-4 text-xs text-kumo-subtle">No contacts.</p>
					) : (
						data.contacts.map((c) => (
							<label
								key={c.id}
								className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-kumo-tint"
							>
								<input
									type="checkbox"
									checked={picked.has(c.email)}
									onChange={() => toggle(c.email)}
								/>
								<span className="min-w-0 truncate">
									{c.name || c.email}
									{c.name && <span className="text-kumo-subtle"> · {c.email}</span>}
								</span>
							</label>
						))
					)}
				</div>
				<div className="flex justify-end gap-2 mt-4">
					<Button variant="ghost" size="sm" onClick={close}>
						Cancel
					</Button>
					<Button
						variant="primary"
						size="sm"
						disabled={picked.size === 0}
						onClick={() => {
							onAdd([...picked]);
							close();
						}}
					>
						Add {picked.size || ""}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
