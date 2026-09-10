// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Dialog, Input, Text, Tooltip } from "@cloudflare/kumo";
import { AddressBookIcon, FloppyDiskIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import { useComposeForm } from "~/hooks/useComposeForm";
import { appendAddresses } from "~/lib/utils";
import api from "~/services/api";
import ContactBrowser from "./ContactBrowser";
import RecipientInput from "./RecipientInput";
import RichTextEditor from "./RichTextEditor";
import TemplatePicker from "./TemplatePicker";
import TemplatePreview from "./TemplatePreview";
import { useUIStore } from "~/hooks/useUIStore";

export default function ComposeEmail() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();
	
	const { isComposeModalOpen, closeComposeModal } = useUIStore();

	const {
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		error,
		isSavingDraft,
		isSending,
		formTitle,
		handleSaveDraft,
		handleSend,
		appliedTemplate,
		applyTemplate,
		clearTemplate,
		previewHtml,
	} = useComposeForm(mailboxId, folder);

	const [browseOpen, setBrowseOpen] = useState(false);

	const handleImageUpload = mailboxId
		? async (file: File) => {
				const res = await api.uploadTemplateAsset(mailboxId, file);
				return { url: res.url, assetId: res.id };
			}
		: undefined;

	return (
		<Dialog.Root
			open={isComposeModalOpen}
			onOpenChange={(open) => !open && !isSending && closeComposeModal()}
		>
			<Dialog size="lg" className="p-6 max-h-[85vh] overflow-y-auto">
				<Dialog.Title className="text-lg font-semibold mb-5">
					{formTitle}
				</Dialog.Title>
				<form onSubmit={(e) => handleSend(e, closeComposeModal)} className="space-y-4">
					{error && <Banner variant="error" text={error} />}
					<div className="flex items-end gap-2">
						<div className="flex-1">
							<RecipientInput
								label="To"
								mailboxId={mailboxId}
								placeholder="recipient@example.com, another@example.com"
								value={to}
								onChange={setTo}
								required
							/>
						</div>
						<Tooltip content="Browse contacts" side="bottom" asChild>
							<Button
								type="button"
								variant="ghost"
								shape="square"
								size="sm"
								icon={<AddressBookIcon size={16} />}
								onClick={() => setBrowseOpen(true)}
								aria-label="Browse contacts"
							/>
						</Tooltip>
						{!showCcBcc && (
							<button
								type="button"
								onClick={() => setShowCcBcc(true)}
								className="shrink-0 text-xs text-kumo-link hover:text-kumo-link-hover font-medium h-8"
							>
								CC / BCC
							</button>
						)}
					</div>
					<ContactBrowser
						mailboxId={mailboxId}
						open={browseOpen}
						onOpenChange={setBrowseOpen}
						onAdd={(emails) => setTo(appendAddresses(to, emails))}
					/>
					{showCcBcc && (
						<RecipientInput
							label="CC"
							mailboxId={mailboxId}
							value={cc}
							onChange={setCc}
							placeholder="Separate multiple addresses with commas"
						/>
					)}
					{showCcBcc && (
						<RecipientInput
							label="BCC"
							mailboxId={mailboxId}
							value={bcc}
							onChange={setBcc}
							placeholder="Separate multiple addresses with commas"
						/>
					)}
					<Input
						label="Subject"
						type="text"
						placeholder="Email subject"
						size="sm"
						value={subject}
						onChange={(e) => setSubject(e.target.value)}
						required
					/>

					<TemplatePicker
						mailboxId={mailboxId}
						applyTemplate={applyTemplate}
						appliedTemplateId={appliedTemplate?.id}
						onClear={clearTemplate}
					/>

					<div>
						<Text size="sm" DANGEROUS_className="font-medium mb-1.5 block">
							Message
						</Text>
						{previewHtml ? (
							<TemplatePreview
								html={previewHtml}
								name={appliedTemplate?.name}
								onRemove={appliedTemplate ? clearTemplate : undefined}
							/>
						) : (
							<RichTextEditor
								value={body}
								onChange={setBody}
								onImageUpload={handleImageUpload}
							/>
						)}
					</div>
					<div className="flex justify-between items-center pt-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={closeComposeModal}
							disabled={isSending}
						>
							Discard
						</Button>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								loading={isSavingDraft}
								disabled={isSending}
								icon={<FloppyDiskIcon size={14} />}
								onClick={handleSaveDraft}
							>
								{isSavingDraft ? "Saving..." : "Save as Draft"}
							</Button>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isSending}
								disabled={isSavingDraft || isSending}
								icon={<PaperPlaneTiltIcon size={14} />}
							>
								{isSending ? "Sending..." : "Send"}
							</Button>
						</div>
					</div>
				</form>
			</Dialog>
		</Dialog.Root>
	);
}
