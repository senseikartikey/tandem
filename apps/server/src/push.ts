import { createClient } from "@libsql/client";
import webpush, { type PushSubscription } from "web-push";

// Push delivery for reminders.
//
// The reminder itself is a record in the household's CRDT (see doc-schema);
// this module is only the *doorbell* for it. That split is deliberate: a
// reminder must survive push being unsupported, denied, expired, or simply
// undelivered, and it does -- the other device shows it the moment the app is
// opened either way. Nothing here is on the critical path of anything.
//
// Consequences worth knowing:
//   - Subscriptions are per browser+device, not per person. One housemate
//     with a phone and a laptop is two rows.
//   - Device labels are self-chosen and not unique, so targeting a label
//     means "every device currently calling itself that".
//   - On iOS, a subscription only exists at all once the site has been added
//     to the Home Screen. Safari tabs cannot receive push. That's Apple's
//     rule; the client explains it rather than silently failing.

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** mailto: or https: URL identifying the sender, per the VAPID spec. */
  subject: string;
}

export interface ReminderPush {
  roomId: string;
  /** null targets everyone in the room except the sender's own device. */
  toLabel: string | null;
  fromLabel: string;
  title: string;
  body: string;
  /** Deep link opened when the notification is tapped. */
  url: string;
  /** Collapses repeat nudges about the same item into one notification. */
  tag: string;
  /** Endpoint of the sender's own device, never notified. */
  fromEndpoint?: string | null;
  /** Epoch ms. Anything in the future is queued rather than sent now. */
  sendAt?: number | null;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
}

export interface PushService {
  configured: boolean;
  publicKey: string;
  subscribe(roomId: string, label: string, subscription: PushSubscription): Promise<void>;
  unsubscribe(endpoint: string): Promise<void>;
  send(reminder: ReminderPush): Promise<{ queued: boolean; sent: number }>;
  /** Pushes to one known endpoint, so a device can prove its own setup works. */
  sendTest(endpoint: string): Promise<boolean>;
  /** Sends anything whose time has come. Safe to call on any schedule. */
  flushDue(now?: number): Promise<number>;
  /** Stops the scheduler and releases the database handle. */
  stop(): Promise<void>;
}

// The scheduler ticks rather than sleeping until the next due time, because
// the process this runs in is expected to be stopped and restarted freely
// (a free-tier host that sleeps when idle). Every tick re-reads from the
// database, so a restart loses nothing and a long sleep just means the
// backlog goes out on the next wake.
const TICK_MS = 30_000;

export interface PushServiceOptions {
  dbUrl: string;
  dbAuthToken?: string;
  /** Null when VAPID keys aren't configured: everything degrades to no-op. */
  config: PushConfig | null;
}

export async function createPushService(options: PushServiceOptions): Promise<PushService> {
  const { config } = options;
  // Its own connection rather than sharing the room store's: this table is
  // unrelated to room state, and libSQL clients are cheap handles, not pools
  // worth threading through the codebase to save.
  const client = createClient({ url: options.dbUrl, authToken: options.dbAuthToken });
  await client.execute(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      label TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  await client.execute(
    `CREATE INDEX IF NOT EXISTS push_subscriptions_room ON push_subscriptions (room_id)`,
  );
  await client.execute(`
    CREATE TABLE IF NOT EXISTS scheduled_pushes (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      to_label TEXT,
      from_label TEXT NOT NULL,
      from_endpoint TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT NOT NULL,
      tag TEXT NOT NULL,
      send_at INTEGER NOT NULL
    )
  `);
  await client.execute(
    `CREATE INDEX IF NOT EXISTS scheduled_pushes_due ON scheduled_pushes (send_at)`,
  );

  if (config) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  }

  async function recipients(
    roomId: string,
    toLabel: string | null,
    fromEndpoint: string | null | undefined,
  ): Promise<SubscriptionRow[]> {
    const result = await client.execute({
      sql: `SELECT endpoint, p256dh, auth, label FROM push_subscriptions WHERE room_id = ?`,
      args: [roomId],
    });
    return result.rows
      .map((row) => ({
        endpoint: row.endpoint as string,
        p256dh: row.p256dh as string,
        auth: row.auth as string,
        label: row.label as string,
      }))
      .filter((row) => row.endpoint !== fromEndpoint)
      .filter((row) => toLabel === null || row.label === toLabel);
  }

  async function deliver(reminder: ReminderPush): Promise<number> {
    if (!config) return 0;
    const targets = await recipients(reminder.roomId, reminder.toLabel, reminder.fromEndpoint);
    const payload = JSON.stringify({
      title: reminder.title,
      body: reminder.body,
      url: reminder.url,
      tag: reminder.tag,
    });

    let sent = 0;
    await Promise.all(
      targets.map(async (target) => {
        try {
          await webpush.sendNotification(
            { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
            payload,
            { TTL: 60 * 60 * 24 },
          );
          sent++;
        } catch (error) {
          // 404/410 mean the browser threw the subscription away (app
          // uninstalled, permission revoked, push service rotated it).
          // Keeping it would mean retrying a dead endpoint forever.
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await client.execute({
              sql: `DELETE FROM push_subscriptions WHERE endpoint = ?`,
              args: [target.endpoint],
            });
          } else {
            console.error("push delivery failed:", status ?? error);
          }
        }
      }),
    );
    return sent;
  }

  async function flushDue(now = Date.now()): Promise<number> {
    const due = await client.execute({
      sql: `SELECT * FROM scheduled_pushes WHERE send_at <= ? LIMIT 100`,
      args: [now],
    });
    let sent = 0;
    for (const row of due.rows) {
      // Deleted before sending, not after: a delivery that throws is not
      // worth re-nagging about on the next tick, and a duplicate reminder is
      // more annoying than a missed one.
      await client.execute({
        sql: `DELETE FROM scheduled_pushes WHERE id = ?`,
        args: [row.id as string],
      });
      sent += await deliver({
        roomId: row.room_id as string,
        toLabel: (row.to_label as string | null) ?? null,
        fromLabel: row.from_label as string,
        fromEndpoint: (row.from_endpoint as string | null) ?? null,
        title: row.title as string,
        body: row.body as string,
        url: row.url as string,
        tag: row.tag as string,
      });
    }
    return sent;
  }

  const timer = setInterval(() => {
    void flushDue().catch((error) => console.error("scheduled push flush failed:", error));
  }, TICK_MS);
  // Never hold the process open for the sake of the scheduler.
  timer.unref?.();

  // A restart is also a wake-up: send whatever came due while we were down.
  void flushDue().catch(() => {});

  return {
    configured: config !== null,
    publicKey: config?.publicKey ?? "",

    async subscribe(roomId, label, subscription): Promise<void> {
      await client.execute({
        sql: `INSERT INTO push_subscriptions (endpoint, room_id, label, p256dh, auth, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET
                room_id = excluded.room_id,
                label = excluded.label,
                p256dh = excluded.p256dh,
                auth = excluded.auth`,
        args: [
          subscription.endpoint,
          roomId,
          label,
          subscription.keys.p256dh,
          subscription.keys.auth,
          Date.now(),
        ],
      });
    },

    async unsubscribe(endpoint): Promise<void> {
      await client.execute({
        sql: `DELETE FROM push_subscriptions WHERE endpoint = ?`,
        args: [endpoint],
      });
    },

    async send(reminder): Promise<{ queued: boolean; sent: number }> {
      if (reminder.sendAt && reminder.sendAt > Date.now() + 1_000) {
        await client.execute({
          sql: `INSERT INTO scheduled_pushes
                (id, room_id, to_label, from_label, from_endpoint, title, body, url, tag, send_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            crypto.randomUUID(),
            reminder.roomId,
            reminder.toLabel,
            reminder.fromLabel,
            reminder.fromEndpoint ?? null,
            reminder.title,
            reminder.body,
            reminder.url,
            reminder.tag,
            reminder.sendAt,
          ],
        });
        return { queued: true, sent: 0 };
      }
      return { queued: false, sent: await deliver(reminder) };
    },

    async sendTest(endpoint): Promise<boolean> {
      if (!config) return false;
      const result = await client.execute({
        sql: `SELECT p256dh, auth FROM push_subscriptions WHERE endpoint = ?`,
        args: [endpoint],
      });
      const row = result.rows[0];
      if (!row) return false;
      try {
        await webpush.sendNotification(
          {
            endpoint,
            keys: { p256dh: row.p256dh as string, auth: row.auth as string },
          },
          JSON.stringify({
            title: "tandem reminders are on",
            body: "this is what a nudge from your household looks like",
            url: "/",
            tag: "tandem-test",
          }),
          { TTL: 60 },
        );
        return true;
      } catch (error) {
        console.error("test push failed:", (error as { statusCode?: number }).statusCode ?? error);
        return false;
      }
    },

    flushDue,

    async stop(): Promise<void> {
      clearInterval(timer);
      client.close();
    },
  };
}
