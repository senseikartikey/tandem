// Registering this device to be rung by a reminder.
//
// Everything here is optional. A reminder is a record in the household
// document, so it reaches the other person the moment they open the app
// whether or not any of this succeeded -- push only shortens the gap when
// their app is closed. Every function below therefore fails soft: no throw
// reaches a caller that was in the middle of writing a reminder.

import { HTTP_BASE } from "$lib/api.js";

const ENDPOINT_KEY = "tandem:push-endpoint";

export type PushState =
	| "unsupported" // no Push API here at all
	| "needs-install" // iOS: only works once added to the Home Screen
	| "blocked" // permission denied
	| "server-off" // this device is willing; the server has no VAPID keys
	| "off" // supported, not yet enabled
	| "on";

// iOS exposes no PushManager in a normal Safari tab -- push exists there only
// for a site added to the Home Screen. Detecting "it could work, but not like
// this" separately from "it can't work here" is the difference between a
// useful sentence and a dead end.
function isStandalone(): boolean {
	return (
		window.matchMedia?.("(display-mode: standalone)").matches ||
		(navigator as { standalone?: boolean }).standalone === true
	);
}

function isIos(): boolean {
	return (
		/iphone|ipad|ipod/i.test(navigator.userAgent) ||
		// iPadOS reports itself as a Mac; the touch points give it away.
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
}

export function pushState(): PushState {
	if (typeof window === "undefined") return "unsupported";
	const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
	if (!hasApi) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
	if (Notification.permission === "denied") return "blocked";
	return localStorage.getItem(ENDPOINT_KEY) ? "on" : "off";
}

export function pushEndpoint(): string | null {
	try {
		return localStorage.getItem(ENDPOINT_KEY);
	} catch {
		return null;
	}
}

// The server's VAPID public key arrives as base64url and the Push API wants
// raw bytes.
function decodeKey(base64Url: string): Uint8Array<ArrayBuffer> {
	const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
	const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
	// Written into an explicitly-allocated ArrayBuffer: the Push API's typings
	// reject the "could be a SharedArrayBuffer" view that Uint8Array.from
	// produces.
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * Asks for notification permission and registers this device for the room.
 *
 * Returns the resulting state rather than throwing: refusing notifications is
 * an ordinary answer, not an error.
 */
export async function enablePush(roomId: string, label: string): Promise<PushState> {
	if (pushState() === "unsupported" || pushState() === "needs-install") return pushState();

	const permission = await Notification.requestPermission();
	if (permission !== "granted") return permission === "denied" ? "blocked" : "off";

	try {
		const keyResponse = await fetch(`${HTTP_BASE}/api/push/key`);
		const { configured, publicKey } = (await keyResponse.json()) as {
			configured: boolean;
			publicKey: string;
		};
		// Distinguished from "off" deliberately: tapping enable, granting
		// permission, and then silently staying off is the kind of dead end
		// that makes people conclude the feature is broken.
		if (!configured || !publicKey) return "server-off";

		const registration = await navigator.serviceWorker.ready;
		// An existing subscription is reused rather than replaced: re-subscribing
		// mints a new endpoint and orphans the old row on the server.
		const subscription =
			(await registration.pushManager.getSubscription()) ??
			(await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: decodeKey(publicKey),
			}));

		const stored = await fetch(`${HTTP_BASE}/api/push/subscribe`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ roomId, label, subscription: subscription.toJSON() }),
		});
		// Checked, not assumed: a browser-side subscription the server never
		// recorded is the exact shape of "notifications are on" that silently
		// never rings.
		if (!stored.ok) return "server-off";
		localStorage.setItem(ENDPOINT_KEY, subscription.endpoint);
		return "on";
	} catch (error) {
		console.warn("[tandem] could not enable push", error);
		return "off";
	}
}

/**
 * Re-registers an existing subscription against the current room and device
 * label.
 *
 * Necessary because a subscription is stored under the label the device had
 * when it subscribed: rename yourself in YourName afterwards and a reminder
 * addressed to the new name would be delivered to nobody, while the app
 * cheerfully showed it as sent. Cheap enough to run on every household open.
 */
export async function refreshPushSubscription(roomId: string, label: string): Promise<void> {
	if (pushState() !== "on") return;
	try {
		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.getSubscription();
		if (!subscription) {
			// The browser dropped it (cleared site data, permission reset).
			// Forgetting locally too keeps the UI honest about being off.
			localStorage.removeItem(ENDPOINT_KEY);
			return;
		}
		localStorage.setItem(ENDPOINT_KEY, subscription.endpoint);
		await fetch(`${HTTP_BASE}/api/push/subscribe`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ roomId, label, subscription: subscription.toJSON() }),
		});
	} catch (error) {
		console.warn("[tandem] could not refresh push subscription", error);
	}
}

export interface ReminderPushRequest {
	roomId: string;
	toLabel: string | null;
	fromLabel: string;
	itemText: string;
	message: string;
	listUrl: string;
	tag: string;
	/** null for "now". */
	sendAt: number | null;
}

/**
 * Rings the other devices. Best-effort by design -- see this file's header.
 */
export async function sendReminderPush(request: ReminderPushRequest): Promise<void> {
	try {
		await fetch(`${HTTP_BASE}/api/push/remind`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				roomId: request.roomId,
				toLabel: request.toLabel,
				fromLabel: request.fromLabel,
				title: `${request.fromLabel} needs: ${request.itemText}`,
				body: request.message || "tap to open the list",
				url: request.listUrl,
				tag: request.tag,
				fromEndpoint: pushEndpoint(),
				sendAt: request.sendAt,
			}),
		});
	} catch (error) {
		console.warn("[tandem] reminder push not delivered", error);
	}
}
