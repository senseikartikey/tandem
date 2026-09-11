// Rendering a list as an image you can send to someone.
//
// The point is the person who will never install anything: a parent, a
// housemate who "just wants the list on WhatsApp". An invite link asks them
// to join something; a picture asks nothing. It also happens to be the only
// share that works in every chat app on earth.
//
// Drawn on a canvas rather than screenshotted so the output is designed --
// readable at thumbnail size in a chat, in the app's own colours, with the
// URL on it for anyone who does decide to join.

export interface ListImageInput {
	householdName: string;
	listName: string;
	items: { text: string; checked: boolean }[];
}

const WIDTH = 1000;
const PADDING = 64;
const ROW_HEIGHT = 68;
// Baseline of the first item, measured from the top of the card.
const FIRST_ROW = 232;
// Space below the last row, and the footer line's own height. The canvas is
// sized from these rather than from a fixed header+footer guess, which is
// what let a one-item list draw its row straight through the footer.
const ROWS_TO_FOOTER = 76;
const FOOTER_TO_EDGE = 44;
// Past this the text is unreadable in a chat thumbnail anyway, and the
// remainder is summarised as a count instead.
const MAX_ROWS = 18;

const INK = "#111111";
const PAPER = "#ffe566";
const CARD = "#fffdf2";
const CORAL = "#e8635a";

// The display face is a web font; without waiting, the first render silently
// falls back to Arial and the image looks like a different product.
async function ensureFonts(): Promise<void> {
	if (!document.fonts) return;
	try {
		await Promise.all([
			document.fonts.load('400 64px "Archivo Black"'),
			document.fonts.load('500 30px "JetBrains Mono"'),
			document.fonts.load('600 34px "Space Grotesk"'),
		]);
		await document.fonts.ready;
	} catch {
		// Fall through and draw with whatever is available.
	}
}

function roundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.arcTo(x + width, y, x + width, y + height, radius);
	ctx.arcTo(x + width, y + height, x, y + height, radius);
	ctx.arcTo(x, y + height, x, y, radius);
	ctx.arcTo(x, y, x + width, y, radius);
	ctx.closePath();
}

export async function renderListImage(input: ListImageInput): Promise<Blob> {
	await ensureFonts();

	const shown = input.items.slice(0, MAX_ROWS);
	const overflow = input.items.length - shown.length;
	const rows = shown.length + (overflow > 0 ? 1 : 0);

	// Bottom-up: the last row decides where the footer goes, the footer
	// decides how tall the card is, and the card decides the canvas.
	const lastRowBaseline = FIRST_ROW + Math.max(0, rows - 1) * ROW_HEIGHT;
	const footerBaseline = lastRowBaseline + ROWS_TO_FOOTER;
	const cardH = footerBaseline + FOOTER_TO_EDGE;
	const height = cardH + PADDING * 2 + 34;

	const canvas = document.createElement("canvas");
	canvas.width = WIDTH;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("this browser wouldn't let us draw the image");

	ctx.fillStyle = PAPER;
	ctx.fillRect(0, 0, WIDTH, height);

	// The card, with the offset shadow the whole app is built on.
	const cardX = PADDING;
	const cardY = PADDING;
	const cardW = WIDTH - PADDING * 2;
	ctx.fillStyle = INK;
	roundedRect(ctx, cardX + 14, cardY + 14, cardW, cardH, 28);
	ctx.fill();
	ctx.fillStyle = CARD;
	roundedRect(ctx, cardX, cardY, cardW, cardH, 28);
	ctx.fill();
	ctx.lineWidth = 6;
	ctx.strokeStyle = INK;
	ctx.stroke();

	const left = cardX + 48;

	ctx.fillStyle = INK;
	ctx.font = '500 28px "JetBrains Mono", monospace';
	ctx.fillText(`— ${input.householdName.toLowerCase()}`, left, cardY + 74);

	ctx.font = '400 76px "Archivo Black", Arial Black, sans-serif';
	const title = input.listName.toLowerCase();
	// One line only: a long list name should shrink, not wrap into the items.
	let titleSize = 76;
	while (ctx.measureText(title).width > cardW - 96 && titleSize > 40) {
		titleSize -= 4;
		ctx.font = `400 ${titleSize}px "Archivo Black", Arial Black, sans-serif`;
	}
	ctx.fillText(title, left, cardY + 160);

	let y = cardY + FIRST_ROW;
	for (const item of shown) {
		// The box: filled and ticked, or empty and waiting.
		ctx.lineWidth = 4;
		ctx.strokeStyle = INK;
		ctx.fillStyle = item.checked ? "#4ecdc4" : CARD;
		roundedRect(ctx, left, y - 26, 34, 34, 10);
		ctx.fill();
		ctx.stroke();
		if (item.checked) {
			ctx.beginPath();
			ctx.lineWidth = 5;
			ctx.moveTo(left + 8, y - 10);
			ctx.lineTo(left + 15, y - 2);
			ctx.lineTo(left + 26, y - 18);
			ctx.stroke();
		}

		ctx.fillStyle = item.checked ? "#8a8a80" : INK;
		ctx.font = '600 34px "Space Grotesk", system-ui, sans-serif';
		let text = item.text;
		while (ctx.measureText(text).width > cardW - 160 && text.length > 4) {
			text = `${text.slice(0, -2)}…`;
		}
		ctx.fillText(text, left + 56, y);

		if (item.checked) {
			// Struck through, so a shared list reads as progress rather than
			// just a list of things.
			const width = ctx.measureText(text).width;
			ctx.beginPath();
			ctx.lineWidth = 3;
			ctx.strokeStyle = "#8a8a80";
			ctx.moveTo(left + 56, y - 10);
			ctx.lineTo(left + 56 + width, y - 10);
			ctx.stroke();
		}
		y += ROW_HEIGHT;
	}

	if (overflow > 0) {
		ctx.fillStyle = "#6a6a60";
		ctx.font = '500 30px "JetBrains Mono", monospace';
		ctx.fillText(`+ ${overflow} more`, left + 56, y);
	}

	ctx.font = '500 26px "JetBrains Mono", monospace';
	const madeWith = "made with tandem ";
	ctx.fillStyle = INK;
	ctx.fillText(madeWith, left, cardY + footerBaseline);
	ctx.fillStyle = CORAL;
	// Measured rather than a fixed offset: the mono face may not be the one
	// that loaded, and a guessed x overlaps the moment metrics differ.
	ctx.fillText("tandem-lists.vercel.app", left + ctx.measureText(madeWith).width, cardY + footerBaseline);

	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("couldn't turn the list into an image"))),
			"image/png",
		);
	});
}

export type ShareOutcome = "shared" | "downloaded" | "cancelled" | "failed";

/**
 * Hands the image to the system share sheet, falling back to a download.
 *
 * The fallback matters: desktop browsers largely can't share files, and a
 * saved PNG still gets dragged into a chat window.
 */
export async function shareListImage(blob: Blob, listName: string): Promise<ShareOutcome> {
	const fileName = `${listName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "list"}.png`;
	const file = new File([blob], fileName, { type: "image/png" });

	if (navigator.canShare?.({ files: [file] })) {
		try {
			await navigator.share({ files: [file], title: listName });
			return "shared";
		} catch (error) {
			// Dismissing the share sheet is a choice, not a failure -- saying
			// "couldn't share" for it would be a lie.
			if (error instanceof Error && error.name === "AbortError") return "cancelled";
		}
	}

	try {
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = fileName;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
		return "downloaded";
	} catch {
		return "failed";
	}
}
