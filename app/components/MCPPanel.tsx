// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Loader, Tooltip } from "@cloudflare/kumo";
import {
	CheckIcon,
	CopyIcon,
	PlugsIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import api from "~/services/api";

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard API unavailable or permission denied — ignore silently
		}
	};

	return (
		<Tooltip content={copied ? "Copied!" : "Copy"} asChild>
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={
					copied ? (
						<CheckIcon size={12} weight="bold" className="text-kumo-success" />
					) : (
						<CopyIcon size={12} />
					)
				}
				onClick={handleCopy}
				aria-label="Copy to clipboard"
			/>
		</Tooltip>
	);
}

/** Shown until the live catalogue loads (and if the request fails). */
const FALLBACK_TOOLS = [
	{ name: "list_mailboxes", description: "List all available mailboxes" },
	{ name: "list_emails", description: "List emails in a folder" },
	{ name: "get_email", description: "Read a full email with body" },
	{ name: "get_thread", description: "Load a conversation thread" },
	{ name: "search_emails", description: "Search emails by query" },
	{ name: "list_templates", description: "List saved templates" },
	{ name: "get_template", description: "Get one template" },
	{ name: "draft_reply", description: "Draft a reply" },
	{ name: "create_draft", description: "Create a new draft" },
	{ name: "update_draft", description: "Update a draft" },
	{ name: "delete_email", description: "Delete an email" },
	{ name: "send_reply", description: "Send a reply" },
	{ name: "send_email", description: "Send a new email" },
	{ name: "mark_email_read", description: "Mark email as read/unread" },
	{ name: "move_email", description: "Move email to a folder" },
];

export default function MCPPanel() {
	const { data, isLoading } = useQuery({
		queryKey: ["mcp-tools"],
		queryFn: () => api.getMcpTools(),
		staleTime: 5 * 60_000,
	});
	const tools = data?.tools ?? FALLBACK_TOOLS;
	const baseUrl =
		typeof window !== "undefined" ? window.location.origin : "https://your-app.workers.dev";
	const mcpUrl = `${baseUrl}/mcp`;

	return (
		<div className="flex flex-col h-full">
			{/* Content */}
			<div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
				{/* Intro */}
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-kumo-brand/10">
							<PlugsIcon
								size={20}
								weight="duotone"
								className="text-kumo-brand"
							/>
						</div>
						<div>
							<h3 className="text-sm font-semibold text-kumo-default">
								Connect via MCP
							</h3>
							<p className="text-xs text-kumo-subtle">
								Model Context Protocol
							</p>
						</div>
					</div>
					<p className="text-xs text-kumo-subtle leading-relaxed">
						This email agent exposes an MCP server so AI coding
						assistants can manage your inbox directly — read emails,
						search, draft replies, and send messages using natural
						language.
					</p>
				</div>

				{/* MCP URL */}
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-kumo-strong block">
						Server URL
					</label>
					<div className="relative group">
						<div className="absolute right-1.5 top-1/2 -translate-y-1/2">
							<CopyButton text={mcpUrl} />
						</div>
						<div className="bg-kumo-recessed text-kumo-default font-mono text-[11px] px-3 py-2.5 pr-10 rounded-lg border border-kumo-line break-all leading-relaxed">
							{mcpUrl}
						</div>
					</div>
				</div>

				{/* Available tools */}
				<div className="space-y-2">
					<h4 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle px-0.5 flex items-center gap-2">
						Available Tools
						<span className="text-kumo-subtle normal-case tracking-normal font-normal">
							({tools.length})
						</span>
						{isLoading && <Loader size="sm" />}
					</h4>
					<div className="border border-kumo-line rounded-lg divide-y divide-kumo-line">
						{tools.map((tool) => (
							<div
								key={tool.name}
								className="flex items-start gap-2.5 px-3 py-2"
							>
								<WrenchIcon
									size={12}
									weight="bold"
									className="text-kumo-brand shrink-0 mt-0.5"
								/>
								<div className="min-w-0 flex-1">
									<span className="text-xs font-mono font-medium text-kumo-default block">
										{tool.name}
									</span>
									<span className="text-[11px] text-kumo-subtle leading-snug">
										{tool.description}
									</span>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
