// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * A recipient (To / CC / BCC) text field with contact type-ahead. The user
 * still types a comma-separated list; as they type the last segment, matching
 * contacts drop down and clicking one rewrites that segment to the address.
 */

import { Input } from "@cloudflare/kumo";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import type { Contact } from "~/types";

interface RecipientInputProps {
	value: string;
	onChange: (value: string) => void;
	mailboxId: string | undefined;
	/** Pass to render Kumo's built-in label; omit when the parent renders its own. */
	label?: string;
	placeholder?: string;
	required?: boolean;
	size?: "sm";
}

/** Split a comma list into [prefix segments joined, activeSegment]. */
function splitActive(value: string): [string, string] {
	const idx = value.lastIndexOf(",");
	if (idx === -1) return ["", value.trimStart()];
	return [value.slice(0, idx + 1), value.slice(idx + 1).trimStart()];
}

export default function RecipientInput({
	value,
	onChange,
	mailboxId,
	label,
	placeholder,
	required,
	size = "sm",
}: RecipientInputProps) {
	const [focused, setFocused] = useState(false);
	const [debounced, setDebounced] = useState("");
	const wrapRef = useRef<HTMLDivElement>(null);

	const [, active] = splitActive(value);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(active.trim()), 180);
		return () => clearTimeout(t);
	}, [active]);

	const { data } = useQuery({
		queryKey: ["contact-suggest", mailboxId, debounced],
		queryFn: () =>
			api.listContacts(mailboxId!, { query: debounced, limit: "6" }),
		enabled: !!mailboxId && focused && debounced.length >= 2,
		staleTime: 30_000,
	});

	const already = new Set(
		value
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean),
	);
	const suggestions = (data?.contacts ?? []).filter(
		(c) => !already.has(c.email.toLowerCase()),
	);
	const open = focused && suggestions.length > 0;

	const pick = (c: Contact) => {
		const [prefix] = splitActive(value);
		const next = `${prefix ? `${prefix} ` : ""}${c.email}, `;
		onChange(next.replace(/^\s*,\s*/, ""));
	};

	return (
		<div
			ref={wrapRef}
			className="relative"
			onBlur={(e) => {
				if (!wrapRef.current?.contains(e.relatedTarget as Node)) setFocused(false);
			}}
		>
			<Input
				{...(label ? { label } : {})}
				type="text"
				size={size}
				placeholder={placeholder}
				required={required}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onFocus={() => setFocused(true)}
			/>
			{open && (
				<div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-kumo-line bg-kumo-base shadow-lg">
					{suggestions.map((c) => (
						<button
							key={c.id}
							type="button"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => pick(c)}
							className="flex w-full flex-col items-start px-3 py-1.5 text-left text-xs hover:bg-kumo-tint"
						>
							<span className="text-kumo-default">{c.name || c.email}</span>
							{c.name && <span className="text-kumo-subtle">{c.email}</span>}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
