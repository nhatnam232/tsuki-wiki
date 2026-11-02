import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, PencilLine, X } from 'lucide-react'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'
import { useToast } from '@/providers/ToastProvider'
import { API_READY, editSuggestions } from '@/lib/backend'

type Props = {
  open: boolean
  onClose: () => void
  anime: { id: number; title: string; trailer_url?: string | null; synopsis?: string | null }
}

const FIELDS: Array<{ key: 'trailer_url' | 'synopsis' | 'studio_name'; labelEn: string; labelVi: string }> = [
  { key: 'trailer_url', labelEn: 'Trailer URL',  labelVi: 'URL trailer' },
  { key: 'synopsis',    labelEn: 'Synopsis',     labelVi: 'Tóm tắt' },
  { key: 'studio_name', labelEn: 'Studio name',  labelVi: 'Tên studio' },
]

/**
 * "Suggest an edit" modal — opens from AnimeDetail.
 *
 * Server-side trigger (`auto_approve_trusted_edit`) automatically promotes
 * suggestions from trusted users (`active`/`top_fan`/`mod`+) so they go straight
 * into the audit log. New users land in the moderator queue.
 */
export default function SuggestEditModal({ open, onClose, anime }: Props) {
  const { lang, t } = useLangContext()
  const { user, profile } = useAuth()
  const toast = useToast()
  const [field, setField] = useState<typeof FIELDS[number]['key']>('trailer_url')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')

  // Reset state when re-opened
  useEffect(() => {
    if (open) {
      setField('trailer_url')
      setValue('')
      setReason('')
    }
  }, [open])

  const submit = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('not signed in')
      if (!API_READY) throw new Error('API not configured')
      const before =
        field === 'trailer_url' ? anime.trailer_url ?? '' :
        field === 'synopsis'    ? anime.synopsis ?? '' :
        ''
      await editSuggestions.create({
        anime_id: anime.id,
        field,
        content_before: before || null,
        content_after: value.trim(),
        reason: reason.trim() || null,
      })
    },
    onSuccess: () => {
      const trusted = (profile?.badges ?? []).some((b) =>
        ['active', 'top_fan', 'mod', 'admin', 'owner'].includes(b),
      )
      toast.success(
        lang === 'vi'
          ? trusted ? 'Đề xuất đã được áp dụng tự động' : 'Đã gửi đề xuất, chờ duyệt'
          : trusted ? 'Edit auto-approved!' : 'Suggestion sent for review',
      )
      onClose()
    },
    onError: (err: any) => {
      toast.error(lang === 'vi' ? 'Gửi thất bại' : 'Submit failed', err.message)
    },
  })

  if (!open) return null

  const fieldLabel = FIELDS.find((f) => f.key === field)?.[lang === 'vi' ? 'labelVi' : 'labelEn']

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-text-muted hover:text-text"
          aria-label={t.close}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15">
            <PencilLine className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text">
              {lang === 'vi' ? 'Đề xuất chỉnh sửa' : 'Suggest an edit'}
            </h2>
            <p className="text-xs text-text-muted">{anime.title}</p>
          </div>
        </div>

        {!user ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            {lang === 'vi'
              ? 'Bạn cần đăng nhập để gửi đề xuất.'
              : 'Please sign in to submit a suggestion.'}
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-text-muted">
              {lang === 'vi' ? 'Trường cần sửa' : 'Field to edit'}
            </label>
            <select
              value={field}
              onChange={(e) => setField(e.target.value as any)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            >
              {FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {lang === 'vi' ? f.labelVi : f.labelEn}
                </option>
              ))}
            </select>

            <label className="block text-xs font-medium text-text-muted">
              {lang === 'vi' ? 'Giá trị mới' : 'New value'} ({fieldLabel})
            </label>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
              placeholder={
                field === 'trailer_url'
                  ? 'https://www.youtube.com/watch?v=...'
                  : ''
              }
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            />

            <label className="block text-xs font-medium text-text-muted">
              {lang === 'vi' ? 'Lý do (tuỳ chọn)' : 'Reason (optional)'}
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder={
                lang === 'vi'
                  ? 'VD: Trailer cũ bị YouTube gỡ'
                  : 'e.g. Old trailer was removed by YouTube'
              }
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            />

            <button
              type="button"
              disabled={submit.isPending || !value.trim()}
              onClick={() => void submit.mutateAsync()}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2 text-sm font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary-hover disabled:opacity-50"
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
              {lang === 'vi' ? 'Gửi đề xuất' : 'Submit suggestion'}
            </button>

            <p className="text-center text-[11px] text-text-muted">
              {lang === 'vi'
                ? 'Người dùng tin cậy (Active+) được áp dụng tự động. Người mới chờ Mod duyệt.'
                : 'Trusted (Active+) users get auto-approved. Newer users wait for moderator review.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
