// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Read-only render of an email body (a rendered template, or a raw-HTML
 * draft). Shown in the composer instead of the rich-text editor when the
 * body is full email HTML the editor would mangle.
 *
 * `sandbox="allow-same-origin"` (no `allow-scripts`) keeps image requests to
 * `/api/v1/.../templates/assets/...` authenticated while blocking script
 * execution from the previewed HTML.
 */

interface TemplatePreviewProps {
	html: string;
	name?: string;
	onRemove?: () => void;
}

export default function TemplatePreview({ html, name, onRemove }: TemplatePreviewProps) {
	return (
		<div className="rounded-lg border border-kumo-line overflow-hidden">
			<div className="flex items-center justify-between gap-2 bg-kumo-recessed border-b border-kumo-line px-3 py-2 text-xs text-kumo-subtle">
				<span>
					{name ? (
						<>
							Template <strong>{name}</strong> — preview, sent exactly as shown
						</>
					) : (
						"HTML preview — sent exactly as shown"
					)}
				</span>
				{onRemove && (
					<button
						type="button"
						onClick={onRemove}
						className="shrink-0 text-kumo-link hover:text-kumo-link-hover font-medium"
					>
						Remove
					</button>
				)}
			</div>
			<iframe
				title="Email preview"
				srcDoc={html}
				sandbox="allow-same-origin"
				className="block w-full h-[440px] border-0 bg-white"
			/>
		</div>
	);
}
