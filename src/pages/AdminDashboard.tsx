import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardList, Loader2, ShieldCheck, X } from 'lucide-react'
import Layout from '@/components/Layout'
import Breadcrumbs from '@/components/Breadcrumbs'
import SEO from '@/components/SEO'
import ReloadLink from '@/components/ReloadLink'
import AdminPasswordGate from '@/components/AdminPasswordGate'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'
import { useToast } from '@/providers/ToastProvider'
import { API_READY, editSuggestions } from '@/lib/backend'
import { isModerator } from '@/lib/badges'
import { queryKeys } from '@/lib/queryClient'

type Suggestion = {
  id: string
  user_id: string
  anime_id: number
  field: string
  content_before: string | null
  content_after: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved'
  created_at: string
}

/**
 * Mod / Admin / Owner dashboard.
 * - Lists pending edit suggestions (anime_edit_suggestions table)
 * - Approve / Reject calls Postgres functions which double-check role
 *   (so even a sneaky API call from a regular user is blocked)
 * - Optimistic remove from list on click → instant feedback.
 *
 * UI is intentionally minimal — power users want speed, not eye-candy.
 */
export default function AdminDashboard() {
  return (
    <Layout>
      <AdminPasswordGate>
        <AdminDashboardInner />
      </AdminPasswordGate>
    </Layout>
  )
}

function AdminDashboardInner() {
  const { lang } = useLangContext()
  const { profile, loading } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [reasonByRow, setReasonByRow] = useState<Record<string, string>>({})

  const allowed = isModerator(profile)

  const pendingQ = useQuery({
    queryKey: queryKeys.pendingEdits(),
    enabled: allowed && API_READY,
    staleTime: 30_000,
    queryFn: async (): Promise<Suggestion[]> => {
      const res = await editSuggestions.pending()
      return ((res.items ?? []) as unknown as Suggestion[])
    },
  })

  const review = useMutation({
    mutationFn: async ({
      id,
      action,
      note,
    }: {
      id: string
      action: 'approve' | 'reject'
      note?: string
    }) => {
      // server-v2 enforce quyền mod/owner + ghi audit_logs phía server.
      await editSuggestions.review(id, action === 'approve' ? 'approved' : 'rejected', note)
    },
    onMutate: async ({ id }) => {
      const key = queryKeys.pendingEdits()
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Suggestion[]>(key) ?? []
      qc.setQueryData<Suggestion[]>(key, prev.filter((s) => s.id !== id))
      return { prev, key }
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev)
      toast.error(lang === 'vi' ? 'Thao tác thất bại' : 'Action failed', err.message)
    },
    onSuccess: (_data, vars) => {
      toast.success(
        vars.action === 'approve'
          ? lang === 'vi' ? 'Đã duyệt' : 'Approved'
          : lang === 'vi' ? 'Đã từ chối' : 'Rejected',
      )
    },
  })

  if (loading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-16">
        <div className="h-32 animate-pulse rounded-2xl border border-border bg-card" />
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-20 text-center">
        <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-text-muted/50" />
        <h1 className="mb-2 text-2xl font-bold text-text">
          {lang === 'vi' ? 'Khu vực chỉ dành cho Mod' : 'Moderators only'}
        </h1>
        <p className="mb-6 text-sm text-text-muted">
          {lang === 'vi'
            ? 'Bạn cần vai trò Mod, Admin hoặc Owner để truy cập trang này.'
            : 'You need the Mod, Admin or Owner role to access this page.'}
        </p>
        <ReloadLink
          to="/"
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          {lang === 'vi' ? 'Về trang chủ' : 'Back home'}
        </ReloadLink>
      </div>
    )
  }

  const items = pendingQ.data ?? []

  return (
    <>
      <SEO
        title={lang === 'vi' ? 'Quản trị' : 'Admin'}
        noIndex
      />

      <div className="container mx-auto max-w-5xl px-4 py-8">
        <Breadcrumbs
          crumbs={[{ name: lang === 'vi' ? 'Quản trị' : 'Admin' }]}
        />

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
            <ClipboardList className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-text">
              {lang === 'vi' ? 'Bảng điều khiển Mod' : 'Mod Dashboard'}
            </h1>
            <p className="text-sm text-text-muted">
              {lang === 'vi'
                ? 'Duyệt các đề xuất chỉnh sửa anime đang chờ.'
                : 'Review pending anime edit suggestions.'}
            </p>
          </div>
        </div>

        {pendingQ.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
            <Check className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
            <h3 className="text-lg font-bold text-text">
              {lang === 'vi' ? 'Không có gì chờ duyệt!' : 'Inbox zero — nothing to review!'}
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              {lang === 'vi'
                ? 'Người dùng được tin cậy có thể chỉnh sửa trực tiếp.'
                : 'Trusted users can edit directly without your approval.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((s) => (
              <li
                key={s.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300">
                    {lang === 'vi' ? 'Đang chờ' : 'Pending'}
                  </span>
                  <span>
                    <ReloadLink to={`/anime/${s.anime_id}`} className="text-primary hover:underline">
                      Anime #{s.anime_id}
                    </ReloadLink>
                  </span>
                  <span>·</span>
                  <span className="font-mono text-[11px]">{s.field}</span>
                  <span className="ml-auto">
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-widest text-text-muted">
                      {lang === 'vi' ? 'Trước' : 'Before'}
                    </p>
                    <p className="rounded-xl border border-border bg-background/40 p-3 text-sm text-text-muted">
                      {s.content_before ?? <em>(empty)</em>}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-widest text-text-muted">
                      {lang === 'vi' ? 'Sau' : 'After'}
                    </p>
                    <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-text">
                      {s.content_after}
                    </p>
                  </div>
                </div>

                {s.reason && (
                  <p className="mt-2 text-xs italic text-text-muted">
                    "{s.reason}"
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    placeholder={lang === 'vi' ? 'Ghi chú duyệt (tuỳ chọn)' : 'Reviewer note (optional)'}
                    value={reasonByRow[s.id] ?? ''}
                    onChange={(e) =>
                      setReasonByRow((prev) => ({ ...prev, [s.id]: e.target.value }))
                    }
                    className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-text focus:border-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() =>
                      void review.mutateAsync({
                        id: s.id,
                        action: 'reject',
                        note: reasonByRow[s.id] || undefined,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
                  >
                    {review.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    {lang === 'vi' ? 'Từ chối' : 'Reject'}
                  </button>
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() =>
                      void review.mutateAsync({
                        id: s.id,
                        action: 'approve',
                        note: reasonByRow[s.id] || undefined,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                  >
                    {review.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {lang === 'vi' ? 'Duyệt' : 'Approve'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
