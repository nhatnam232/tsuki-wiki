/**
 * Gán badge `owner` cho 1 email (one-time, thay RPC `bootstrap_owner` của Supabase).
 *
 *   npx tsx scripts/bootstrap-owner.ts owner@example.com
 *
 * Idempotent. Không expose qua HTTP — chỉ chạy tay trên server.
 */
import { openDb } from '../db/index';
import { parseBadges } from '../middleware/requireAuth';
import { nowIso } from '../lib/time';

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  process.stderr.write('Dùng: npx tsx scripts/bootstrap-owner.ts <email>\n');
  process.exit(2);
}

const db = openDb();
const user = db
  .prepare('select id, email from users where lower(email) = ? limit 1')
  .get(email) as { id: string; email: string } | undefined;

if (!user) {
  process.stderr.write(`Không tìm thấy user với email: ${email}\n`);
  process.exit(1);
}

const profile = db.prepare('select badges from profiles where id = ?').get(user.id) as
  | { badges: string }
  | undefined;

if (!profile) {
  process.stderr.write(`User ${email} chưa có profiles row (lỗi dữ liệu?)\n`);
  process.exit(1);
}

const badges = parseBadges(profile.badges);
if (badges.includes('owner')) {
  process.stdout.write(`User ${email} đã có badge owner — không đổi.\n`);
  process.exit(0);
}

badges.push('owner');
db.prepare('update profiles set badges = ?, updated_at = ? where id = ?').run(
  JSON.stringify(badges),
  nowIso(),
  user.id
);
process.stdout.write(`Đã gán badge owner cho ${email} (badges=${JSON.stringify(badges)})\n`);
db.close();
