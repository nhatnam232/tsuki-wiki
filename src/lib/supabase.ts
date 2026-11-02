/**
 * DEPRECATED — Supabase đã bị loại bỏ (backend tự viết: server-v2).
 *
 * File này chỉ còn để các module chưa migrate không vỡ `import`. Mọi thứ thật
 * nằm ở `src/lib/backend.ts`. `supabase` bên dưới là shim NÉM LỖI khi dùng,
 * để lỗi lộ ra ngay thay vì im lặng gọi dịch vụ không tồn tại.
 *
 * ĐỢT SAU cần migrate (còn import `supabase`):
 *   SuggestEditModal, RecommendedForYou, AddToLibraryButton, CommentSection,
 *   QuestsPanel, NotificationsProvider, useAnimeLike, PersonalLibrary,
 *   AdminDashboard, ActivityFeed, CollectionsPage, Profile.
 */
export { ApiError, auth, profiles, mediaUrl, uploadMedia, library, favorites, comments, collections, reactions, reviews, notifications, editSuggestions, compareHistory, quests, activity, connectRealtime, BUCKETS } from './backend'

/** @deprecated Supabase client không còn tồn tại. */
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(
        `[supabase] đã bị loại bỏ — thay "${String(prop)}" bằng helper trong @/lib/backend`,
      )
    },
  },
) as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** @deprecated luôn false: backend mới không dùng Supabase. */
export const isSupabaseConfigured = false
