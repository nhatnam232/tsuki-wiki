/**
 * Gửi thông báo Discord (tuỳ chọn) — không bao giờ throw, không log nội dung.
 * Dùng cho rotate-password để owner nhận mật khẩu mới mà không phải đọc log.
 */
export async function notifyDiscord(title: string, content: string): Promise<boolean> {
  const url = process.env.ADMIN_PASSWORD_WEBHOOK;
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // content bị Discord ẩn nếu bọc ||spoiler||
      body: JSON.stringify({ content: `**${title}**\n${content}` }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    process.stderr.write('[webhook] gửi Discord thất bại\n');
    return false;
  }
}
