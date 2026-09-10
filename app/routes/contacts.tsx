// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Banner, Button, Input, Loader, Text, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArrowLeftIcon,
	PlusIcon,
	TrashIcon,
	UploadSimpleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import {
	useAddListMembers,
	useContacts,
	useCreateMailList,
	useDeleteContact,
	useDeleteMailList,
	useImportContacts,
	useMailList,
	useMailLists,
	useRemoveListMember,
	useUpdateMailList,
	useUpsertContact,
} from "~/queries/contacts";
import type { Contact, ContactImportResult } from "~/types";

type View =
	| { tab: "contacts" }
	| { tab: "lists" }
	| { tab: "list"; id: string };

export default function ContactsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const [view, setView] = useState<View>({ tab: "contacts" });
	if (!mailboxId) return null;

	return (
		<div className="w-full px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
			{view.tab !== "list" && (
				<div className="flex items-center gap-1 mb-6">
					<TabButton active={view.tab === "contacts"} onClick={() => setView({ tab: "contacts" })}>
						Contacts
					</TabButton>
					<TabButton active={view.tab === "lists"} onClick={() => setView({ tab: "lists" })}>
						Mail lists
					</TabButton>
				</div>
			)}

			{view.tab === "contacts" && <ContactsTab mailboxId={mailboxId} />}
			{view.tab === "lists" && (
				<MailListsTab mailboxId={mailboxId} onOpen={(id) => setView({ tab: "list", id })} />
			)}
			{view.tab === "list" && (
				<MailListDetailView
					mailboxId={mailboxId}
					id={view.id}
					onBack={() => setView({ tab: "lists" })}
				/>
			)}
		</div>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-md px-3 py-1.5 text-sm font-medium ${
				active
					? "bg-kumo-fill text-kumo-default"
					: "text-kumo-subtle hover:bg-kumo-tint"
			}`}
		>
			{children}
		</button>
	);
}

// ── Contacts tab ─────────────────────────────────────────────────

function ContactsTab({ mailboxId }: { mailboxId: string }) {
	const toast = useKumoToastManager();
	const [query, setQuery] = useState("");
	const { data, isLoading } = useContacts(mailboxId, query);
	const upsert = useUpsertContact();
	const del = useDeleteContact();

	const [adding, setAdding] = useState(false);
	const [newName, setNewName] = useState("");
	const [newEmail, setNewEmail] = useState("");
	const [importing, setImporting] = useState(false);

	const handleAdd = async () => {
		if (!newEmail.trim()) return;
		try {
			await upsert.mutateAsync({ mailboxId, data: { name: newName.trim(), email: newEmail.trim() } });
			setNewName("");
			setNewEmail("");
			setAdding(false);
			toast.add({ title: "Contact saved" });
		} catch (e) {
			toast.add({ title: e instanceof Error ? e.message : "Failed", variant: "error" });
		}
	};

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-2 mb-4">
				<div className="w-64">
					<Input
						size="sm"
						placeholder="Search name or email"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>
				<div className="flex gap-2">
					<Button size="sm" variant="secondary" icon={<PlusIcon size={14} />} onClick={() => setAdding((v) => !v)}>
						Add contact
					</Button>
					<Button size="sm" variant="secondary" icon={<UploadSimpleIcon size={14} />} onClick={() => setImporting(true)}>
						Import CSV
					</Button>
				</div>
			</div>

			{adding && (
				<div className="flex flex-wrap items-end gap-2 mb-4 rounded-lg border border-kumo-line bg-kumo-base p-4">
					<Input size="sm" label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
					<Input size="sm" label="Email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
					<Button size="sm" variant="primary" loading={upsert.isPending} onClick={handleAdd}>
						Save
					</Button>
				</div>
			)}

			{importing && (
				<ImportContactsCard mailboxId={mailboxId} onClose={() => setImporting(false)} />
			)}

			{isLoading ? (
				<div className="flex justify-center py-16"><Loader size="lg" /></div>
			) : !data || data.contacts.length === 0 ? (
				<p className="text-sm text-kumo-subtle">
					{query ? "No contacts match." : "No contacts yet. Add one or import a CSV."}
				</p>
			) : (
				<div className="space-y-1.5">
					<p className="text-xs text-kumo-subtle">{data.total} contact{data.total === 1 ? "" : "s"}</p>
					{data.contacts.map((ct) => (
						<div
							key={ct.id}
							className="flex items-center justify-between rounded-lg border border-kumo-line bg-kumo-base px-4 py-2.5"
						>
							<div className="min-w-0">
								<div className="text-sm text-kumo-default truncate">{ct.name || ct.email}</div>
								{ct.name && <div className="text-xs text-kumo-subtle truncate">{ct.email}</div>}
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{(ct.listCount ?? 0) > 0 && (
									<Badge variant="secondary">in {ct.listCount}</Badge>
								)}
								<Button
									variant="ghost"
									shape="square"
									size="xs"
									icon={<TrashIcon size={14} />}
									aria-label="Delete contact"
									onClick={() => {
										if (window.confirm(`Delete ${ct.name || ct.email}?`)) {
											del.mutate({ mailboxId, id: ct.id });
										}
									}}
								/>
							</div>
						</div>
					))}
				</div>
			)}
		</>
	);
}

function ImportContactsCard({
	mailboxId,
	onClose,
}: {
	mailboxId: string;
	onClose: () => void;
}) {
	const toast = useKumoToastManager();
	const { data: lists } = useMailLists(mailboxId);
	const importMut = useImportContacts();
	const fileRef = useRef<HTMLInputElement>(null);
	const [csv, setCsv] = useState<string | null>(null);
	const [csvName, setCsvName] = useState("");
	const [listIds, setListIds] = useState<string[]>([]);
	const [result, setResult] = useState<ContactImportResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	const run = async () => {
		if (!csv) return;
		setError(null);
		try {
			const r = await importMut.mutateAsync({ mailboxId, data: { csv, list_ids: listIds } });
			setResult(r);
			toast.add({ title: `Imported ${r.created + r.updated} contact${r.created + r.updated === 1 ? "" : "s"}` });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Import failed");
		}
	};

	return (
		<div className="mb-4 rounded-lg border border-kumo-line bg-kumo-base p-4 space-y-3">
			<div className="flex items-center justify-between">
				<Text size="sm" DANGEROUS_className="font-medium">Import contacts from CSV</Text>
				<Button variant="ghost" shape="square" size="xs" icon={<XIcon size={14} />} onClick={onClose} aria-label="Close" />
			</div>
			{error && <Banner variant="error" text={error} />}
			<p className="text-xs text-kumo-subtle">Columns: <code>email</code> (required), <code>name</code>.</p>
			<div className="flex items-center gap-2">
				<Button size="xs" variant="secondary" icon={<UploadSimpleIcon size={12} />} onClick={() => fileRef.current?.click()}>
					{csvName || "Choose file"}
				</Button>
				<input
					ref={fileRef}
					type="file"
					accept=".csv,text/csv"
					className="hidden"
					onChange={async (e) => {
						const f = e.target.files?.[0];
						e.target.value = "";
						if (!f) return;
						setCsv(await f.text());
						setCsvName(f.name);
						setResult(null);
					}}
				/>
			</div>

			{lists && lists.length > 0 && (
				<div>
					<Text size="sm" DANGEROUS_className="text-xs font-medium block mb-1">
						Also add to mail list(s)
					</Text>
					<div className="flex flex-wrap gap-2">
						{lists.map((l) => (
							<label key={l.id} className="flex items-center gap-1.5 text-xs">
								<input
									type="checkbox"
									checked={listIds.includes(l.id)}
									onChange={(e) =>
										setListIds((prev) =>
											e.target.checked ? [...prev, l.id] : prev.filter((x) => x !== l.id),
										)
									}
								/>
								{l.name}
							</label>
						))}
					</div>
				</div>
			)}

			{result ? (
				<div className="rounded-md border border-kumo-line bg-kumo-recessed p-3 text-xs space-y-1">
					<p className="text-kumo-default font-medium">
						{result.created} added · {result.updated} updated
					</p>
					<p className="text-kumo-subtle">
						{result.skippedInvalid} invalid · {result.duplicatesRemoved} duplicate rows skipped
						{result.addedToLists > 0 ? ` · linked to ${result.addedToLists} list(s)` : ""}
					</p>
				</div>
			) : (
				<Button
					size="sm"
					variant="primary"
					disabled={!csv}
					loading={importMut.isPending}
					onClick={run}
				>
					Import
				</Button>
			)}
		</div>
	);
}

// ── Mail lists tab ───────────────────────────────────────────────

function MailListsTab({
	mailboxId,
	onOpen,
}: {
	mailboxId: string;
	onOpen: (id: string) => void;
}) {
	const { data: lists, isLoading } = useMailLists(mailboxId);
	const create = useCreateMailList();
	const del = useDeleteMailList();
	const [name, setName] = useState("");

	return (
		<>
			<div className="flex items-end gap-2 mb-4">
				<Input
					size="sm"
					label="New list"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g. VIP customers"
				/>
				<Button
					size="sm"
					variant="primary"
					disabled={!name.trim()}
					loading={create.isPending}
					onClick={async () => {
						await create.mutateAsync({ mailboxId, name: name.trim() });
						setName("");
					}}
				>
					Create
				</Button>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16"><Loader size="lg" /></div>
			) : !lists || lists.length === 0 ? (
				<p className="text-sm text-kumo-subtle">No mail lists yet.</p>
			) : (
				<div className="space-y-1.5">
					{lists.map((l) => (
						<div
							key={l.id}
							className="flex items-center justify-between rounded-lg border border-kumo-line bg-kumo-base px-4 py-2.5"
						>
							<button
								type="button"
								className="min-w-0 text-left flex-1"
								onClick={() => onOpen(l.id)}
							>
								<span className="text-sm font-medium text-kumo-default">{l.name}</span>
								<span className="text-xs text-kumo-subtle ml-2">
									{l.memberCount ?? 0} member{(l.memberCount ?? 0) === 1 ? "" : "s"}
								</span>
							</button>
							<Button
								variant="ghost"
								shape="square"
								size="xs"
								icon={<TrashIcon size={14} />}
								aria-label="Delete list"
								onClick={() => {
									if (window.confirm(`Delete list "${l.name}"? Contacts are kept.`)) {
										del.mutate({ mailboxId, id: l.id });
									}
								}}
							/>
						</div>
					))}
				</div>
			)}
		</>
	);
}

function MailListDetailView({
	mailboxId,
	id,
	onBack,
}: {
	mailboxId: string;
	id: string;
	onBack: () => void;
}) {
	const { data: list, isLoading } = useMailList(mailboxId, id);
	const rename = useUpdateMailList();
	const removeMember = useRemoveListMember();
	const addMembers = useAddListMembers();

	const [renaming, setRenaming] = useState(false);
	const [newName, setNewName] = useState("");
	const [pickerQuery, setPickerQuery] = useState("");
	const [showPicker, setShowPicker] = useState(false);
	const { data: searchResult } = useContacts(mailboxId, pickerQuery);

	const memberIds = useMemo(
		() => new Set((list?.members ?? []).map((m) => m.id)),
		[list],
	);
	const candidates = (searchResult?.contacts ?? []).filter((ct) => !memberIds.has(ct.id));

	if (isLoading || !list) {
		return <div className="flex justify-center py-16"><Loader size="lg" /></div>;
	}

	return (
		<div className="max-w-2xl">
			<button
				type="button"
				onClick={onBack}
				className="flex items-center gap-1 text-sm text-kumo-subtle hover:text-kumo-default mb-4"
			>
				<ArrowLeftIcon size={14} /> Mail lists
			</button>

			<div className="flex items-center gap-2 mb-4">
				{renaming ? (
					<>
						<Input size="sm" value={newName} onChange={(e) => setNewName(e.target.value)} />
						<Button
							size="xs"
							variant="primary"
							onClick={async () => {
								await rename.mutateAsync({ mailboxId, id, name: newName.trim() || list.name });
								setRenaming(false);
							}}
						>
							Save
						</Button>
					</>
				) : (
					<>
						<h1 className="text-lg font-semibold text-kumo-default">{list.name}</h1>
						<button
							type="button"
							className="text-xs text-kumo-link"
							onClick={() => {
								setNewName(list.name);
								setRenaming(true);
							}}
						>
							rename
						</button>
					</>
				)}
				<span className="text-sm text-kumo-subtle ml-auto">{list.memberCount} members</span>
			</div>

			<Button size="sm" variant="secondary" icon={<PlusIcon size={14} />} onClick={() => setShowPicker((v) => !v)}>
				Add contacts
			</Button>

			{showPicker && (
				<div className="my-3 rounded-lg border border-kumo-line bg-kumo-base p-3 space-y-2">
					<Input
						size="sm"
						placeholder="Search contacts to add"
						value={pickerQuery}
						onChange={(e) => setPickerQuery(e.target.value)}
					/>
					<div className="max-h-56 overflow-y-auto space-y-1">
						{candidates.length === 0 ? (
							<p className="text-xs text-kumo-subtle">No matching contacts.</p>
						) : (
							candidates.map((ct) => (
								<div key={ct.id} className="flex items-center justify-between text-sm">
									<span className="truncate">{ct.name || ct.email}{ct.name ? ` · ${ct.email}` : ""}</span>
									<Button
										size="xs"
										variant="ghost"
										onClick={() =>
											addMembers.mutate({ mailboxId, id, contactIds: [ct.id] })
										}
									>
										Add
									</Button>
								</div>
							))
						)}
					</div>
				</div>
			)}

			<div className="mt-4 space-y-1.5">
				{list.members.length === 0 ? (
					<p className="text-sm text-kumo-subtle">No members yet.</p>
				) : (
					list.members.map((m: Contact) => (
						<div
							key={m.id}
							className="flex items-center justify-between rounded-lg border border-kumo-line bg-kumo-base px-4 py-2"
						>
							<span className="text-sm truncate">
								{m.name || m.email}
								{m.name && <span className="text-kumo-subtle"> · {m.email}</span>}
							</span>
							<Button
								variant="ghost"
								shape="square"
								size="xs"
								icon={<XIcon size={14} />}
								aria-label="Remove from list"
								onClick={() => removeMember.mutate({ mailboxId, id, contactId: m.id })}
							/>
						</div>
					))
				)}
			</div>
		</div>
	);
}
