import { MAX_ITEM_PHOTO_BYTES } from "@tandem/doc-schema";

// Turning a camera photo into something small enough to live in the document.
//
// There is no file server in this architecture, so an item's photo is a data
// URL inside the CRDT: it syncs, works offline, forks and merges like every
// other field, and needs no upload, no auth and no cleanup. The price is that
// every device holds it in memory forever, and the whole room is capped
// server-side -- so the downscale here is not an optimisation, it is the
// thing that makes the approach viable at all.
//
// A modern phone photo is 3-6MB. This gets it under ~40KB.

// Enough to tell two similar packets apart at a glance in a list row, which
// is the entire job. Anything larger is spending the household's byte budget
// on detail nobody looks at.
const MAX_EDGE = 320;
const QUALITY = 0.62;

function loadImage(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const image = new Image();
		image.onload = () => {
			URL.revokeObjectURL(url);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("that file didn't look like an image"));
		};
		image.src = url;
	});
}

/**
 * Downscales a captured photo to an inline JPEG data URL.
 *
 * Steps quality down if the first attempt is still too big, and gives up
 * honestly rather than storing something that would break the room.
 */
export async function toItemPhoto(file: File): Promise<string> {
	const image = await loadImage(file);
	const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(image.width * scale));
	canvas.height = Math.max(1, Math.round(image.height * scale));

	const context = canvas.getContext("2d");
	if (!context) throw new Error("this browser wouldn't let us resize the photo");
	context.drawImage(image, 0, 0, canvas.width, canvas.height);

	// JPEG, not PNG: these are photographs, where PNG is several times the
	// size for no visible gain.
	for (const quality of [QUALITY, 0.45, 0.3]) {
		const dataUrl = canvas.toDataURL("image/jpeg", quality);
		if (dataUrl.length <= MAX_ITEM_PHOTO_BYTES) return dataUrl;
	}
	throw new Error("couldn't get that photo small enough — try a simpler shot");
}
