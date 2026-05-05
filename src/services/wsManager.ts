import type { WebSocket } from 'ws';
import type { Redis } from 'ioredis';
import { getRedis, getRedisSubscriber } from '../redis/index.js';

/**
 * Generic Redis-fanout WebSocket manager. Subscribes to a Redis channel
 * once per channel; forwards each message to all locally connected sockets.
 */
export class WsChannelManager {
  private localSockets = new Map<string, Set<WebSocket>>();
  private subscribed = new Set<string>();
  private subscriber: Redis | null = null;
  private listener: ((channel: string, msg: string) => void) | null = null;

  constructor(private channelPrefix: (key: string) => string) {}

  private getSubscriber(): Redis {
    if (!this.subscriber) {
      this.subscriber = getRedisSubscriber();
      this.listener = (channel: string, msg: string) => {
        // Channel format: prefix(key)
        // Find the key by reverse lookup
        for (const key of this.localSockets.keys()) {
          if (this.channelPrefix(key) === channel) {
            this.broadcastLocal(key, msg);
            break;
          }
        }
      };
      this.subscriber.on('message', this.listener);
    }
    return this.subscriber;
  }

  async connect(key: string, ws: WebSocket): Promise<void> {
    let set = this.localSockets.get(key);
    if (!set) {
      set = new Set();
      this.localSockets.set(key, set);
    }
    set.add(ws);
    const channel = this.channelPrefix(key);
    if (!this.subscribed.has(channel)) {
      const sub = this.getSubscriber();
      try {
        await sub.subscribe(channel);
      } catch {
        /* ignore subscribe errors in test envs */
      }
      this.subscribed.add(channel);
    }
  }

  async disconnect(key: string, ws: WebSocket): Promise<void> {
    const set = this.localSockets.get(key);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.localSockets.delete(key);
      const channel = this.channelPrefix(key);
      if (this.subscribed.has(channel)) {
        try {
          await this.getSubscriber().unsubscribe(channel);
        } catch {
          /* ignore */
        }
        this.subscribed.delete(channel);
      }
    }
  }

  async publish(key: string, payload: unknown): Promise<void> {
    const r = getRedis();
    const channel = this.channelPrefix(key);
    const msg = JSON.stringify(payload);
    try {
      await r.publish(channel, msg);
    } catch {
      // Fallback for test environments where pub/sub may not deliver — broadcast locally.
      this.broadcastLocal(key, msg);
    }
  }

  private broadcastLocal(key: string, msg: string): void {
    const set = this.localSockets.get(key);
    if (!set) return;
    for (const ws of set) {
      try {
        ws.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  // Test helper / fallback when Redis pub/sub doesn't fan out
  broadcastLocally(key: string, payload: unknown): void {
    this.broadcastLocal(key, JSON.stringify(payload));
  }
}

export const orderTrackManager = new WsChannelManager((orderId) => `order:${orderId}:track`);
export const chatManager = new WsChannelManager((orderId) => `chat:${orderId}`);
