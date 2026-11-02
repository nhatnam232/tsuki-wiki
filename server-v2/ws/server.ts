/**
 * WebSocket realtime — Phase 2 slice.
 *
 * GET /api/ws?topics=comments:anime:21,notifications:<uid>,activity
 *  - Upgrade từ CHÍNH http server của Express (không mở port riêng).
 *  - Auth: cookie `tsuki_at` (KHÔNG nhận token qua query) → verify JWT + session active.
 *  - Thiếu/sai auth, topic lạ, vượt 5 kết nối/IP → close 1008.
 *  - Chỉ server đẩy event; mọi message từ client bị bỏ qua.
 *  - Ping/pong 30s, dọn kết nối chết.
 */
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Db } from '../db/index';
import { readCookie } from '../auth/cookies';
import { ACCESS_COOKIE, getSessionById, isActive } from '../auth/session';
import { verifyAccessToken } from '../crypto/jwt';

const MAX_CONNECTIONS_PER_IP = 5;
const PING_INTERVAL_MS = 30_000;
const PUBLIC_TOPICS = new Set(['activity']);
const ROOM_RE = /^(comments:(anime|character):\d+|notifications:[0-9a-f-]{16,}|activity)$/;

export interface WsEvent {
  type: string;
  room: string;
  payload: Record<string, unknown>;
}

interface Client { socket: WebSocket; rooms: Set<string>; ip: string; userId: string | null; alive: boolean }

const clients = new Set<Client>();
const byIp = new Map<string, number>();
let wss: WebSocketServer | null = null;

export function validateTopics(raw: string | undefined, userId: string): string[] | null {
  const topics = (raw ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  if (topics.length === 0) return null;
  for (const topic of topics) {
    if (!ROOM_RE.test(topic)) return null;
    if (topic.startsWith('notifications:') && topic !== `notifications:${userId}`) return null;
  }
  return topics;
}

function authFromRequest(db: Db, req: IncomingMessage): { userId: string } | null {
  const token = readCookie(req.headers.cookie, ACCESS_COOKIE);
  if (!token) return null;
  const result = verifyAccessToken(token);
  if (!result.valid) return null;
  const session = getSessionById(db, result.payload.sid);
  if (!session || !isActive(session) || session.user_id !== result.payload.sub) return null;
  return { userId: result.payload.sub };
}

export function attachWebSocket(server: Server, db: Db): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const ip = (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
      const auth = authFromRequest(db, req);
      const topics = auth ? validateTopics(url.searchParams.get('topics') ?? undefined, auth.userId) : null;

      // Upgrade xong rồi close 1008 (policy violation) — đúng yêu cầu acceptance.
      const reject = (reason: string): void => {
        wss!.handleUpgrade(req, socket, head, (ws) => ws.close(1008, reason));
      };
      if (!auth) return reject('unauthorized');
      if (!topics) return reject('invalid_topic');
      if ((byIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) return reject('too_many_connections');

      wss!.handleUpgrade(req, socket, head, (ws) => {
        const client: Client = { socket: ws, rooms: new Set(topics), ip, userId: auth.userId, alive: true };
        clients.add(client);
        byIp.set(ip, (byIp.get(ip) ?? 0) + 1);

        ws.on('pong', () => { client.alive = true; });
        // Chỉ server đẩy event: bỏ qua mọi message từ client.
        ws.on('message', () => undefined);
        ws.on('close', () => {
          clients.delete(client);
          byIp.set(ip, Math.max(0, (byIp.get(ip) ?? 1) - 1));
        });
        ws.on('error', () => ws.terminate());
      });
    })();
  });

  const pinger = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) { client.socket.terminate(); clients.delete(client); continue; }
      client.alive = false;
      try { client.socket.ping(); } catch { client.socket.terminate(); }
    }
  }, PING_INTERVAL_MS);
  pinger.unref();

  return wss;
}

function emit(room: string, type: string, payload: Record<string, unknown>): number {
  const event: WsEvent = { type, room, payload };
  const data = JSON.stringify(event);
  let sent = 0;
  for (const client of clients) {
    if (!client.rooms.has(room)) continue;
    if (client.socket.readyState === 1) { client.socket.send(data); sent += 1; }
  }
  return sent;
}

export const commentsRoom = (entityType: string, entityId: number | string): string =>
  `comments:${entityType}:${entityId}`;

export const broadcastComment = (entityType: string, entityId: number | string, action: 'new' | 'update' | 'delete', payload: Record<string, unknown>): number =>
  emit(commentsRoom(entityType, entityId), `comment:${action}`, payload);

export const broadcastNotification = (userId: string, payload: Record<string, unknown>): number =>
  emit(`notifications:${userId}`, 'notification:new', payload);

export const broadcastActivity = (payload: Record<string, unknown>): number =>
  emit('activity', 'activity:new', payload);

export function closeWebSocket(): void {
  for (const client of clients) client.socket.terminate();
  clients.clear();
  byIp.clear();
  wss?.close();
  wss = null;
}

export function connectionCount(): number {
  return clients.size;
}

void PUBLIC_TOPICS;
