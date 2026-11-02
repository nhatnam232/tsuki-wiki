/** Helper tạo `profiles` row tương ứng 1 user (thay trigger handle_new_user của Supabase). */
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/index';

const USERNAME_MAX = 24;

/** Sinh username duy nhất từ phần trước `@` của email. */
export function uniqueUsername(db: Db, base: string): string {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, USERNAME_MAX) || 'user';

  const exists = (candidate: string): boolean =>
    Boolean(db.prepare('select 1 from profiles where username = ?').get(candidate));

  if (!exists(clean)) return clean;
  for (let i = 0; i < 5; i += 1) {
    const candidate = `${clean}-${randomBytes(2).toString('hex')}`;
    if (!exists(candidate)) return candidate;
  }
  return `${clean}-${randomBytes(4).toString('hex')}`;
}

export interface EnsureProfileInput {
  userId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

/** Idempotent: chỉ tạo nếu chưa có, không ghi đè dữ liệu người dùng đã sửa. */
export function ensureProfile(db: Db, input: EnsureProfileInput): void {
  const existing = db.prepare('select 1 from profiles where id = ?').get(input.userId);
  if (existing) return;

  const username = uniqueUsername(db, input.email.split('@')[0] ?? 'user');
  db.prepare(
    'insert into profiles (id, username, display_name, avatar_url) values (?, ?, ?, ?)'
  ).run(input.userId, username, input.displayName ?? username, input.avatarUrl ?? null);
}
