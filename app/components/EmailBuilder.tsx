// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Drag-and-drop email template builder (GrapesJS + newsletter preset).
 *
 * Lazy-loaded and client-only — GrapesJS touches `document` on init.
 * Emits inlined, email-safe HTML (via the preset's juice-backed
 * `gjs-get-inlined-html` command) into the same `body` field the other
 * editor modes use. Images dropped/added here upload to R2 through
 * `onImageUpload`; the resulting `/templates/assets/<id>` URL is what the
 * Worker's send path recognizes and inlines as a CID attachment.
 */

import "grapesjs/dist/css/grapes.min.css";
import grapesjs, { type Editor } from "grapesjs";
import presetNewsletter from "grapesjs-preset-newsletter";
import { useEffect, useRef } from "react";

interface EmailBuilderProps {
	value: string;
	onChange: (html: string) => void;
	onImageUpload: (file: File) => Promise<{ url: string; assetId: string }>;
}

export default function EmailBuilder({
	value,
	onChange,
	onImageUpload,
}: EmailBuilderProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const onChangeRef = useRef(onChange);
	const onImageUploadRef = useRef(onImageUpload);
	const initialValueRef = useRef(value);
	onChangeRef.current = onChange;
	onImageUploadRef.current = onImageUpload;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const editor: Editor = grapesjs.init({
			container,
			height: "560px",
			width: "auto",
			fromElement: false,
			storageManager: false,
			plugins: [
				(ed: Editor) =>
					presetNewsletter(ed, {
						modalTitleImport: "Import / paste HTML",
					}),
			],
			assetManager: {
				autoAdd: false,
				uploadFile: async (e: unknown) => {
					const ev = e as {
						dataTransfer?: { files?: FileList };
						target?: { files?: FileList };
					};
					const files = Array.from(
						ev.dataTransfer?.files ?? ev.target?.files ?? [],
					);
					for (const file of files) {
						try {
							const { url } = await onImageUploadRef.current(file);
							editor.AssetManager.add({ src: url, name: file.name });
						} catch {
							/* upstream surfaces the error */
						}
					}
				},
			},
		});

		editor.setComponents(initialValueRef.current || "");

		let timer: ReturnType<typeof setTimeout> | undefined;
		const emit = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				let html: string;
				try {
					html = editor.runCommand("gjs-get-inlined-html") as string;
				} catch {
					html = `<style>${editor.getCss()}</style>${editor.getHtml()}`;
				}
				onChangeRef.current(html || editor.getHtml());
			}, 300);
		};
		editor.on("update", emit);

		return () => {
			clearTimeout(timer);
			editor.destroy();
		};
	}, []);

	return (
		<div className="rounded-lg border border-kumo-line overflow-hidden">
			<div ref={containerRef} />
		</div>
	);
}
