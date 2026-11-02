import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Image as ImageIcon,
  Sparkles,
  UserPlus,
} from 'lucide-react'
import WikiLayout from '@/wiki/components/WikiLayout'
import { useWikiText } from '@/wiki/i18n'
import { useLangContext } from '@/providers/LangProvider'

/**
 * Wiki contribution page — supports `/new/character` and `/new/story`.
 *
 * Same shape as WikiEdit but starts from a blank slate. Submitting POSTs to
 * (TODO) `/api/wiki-suggestions` for moderator review. Right now the UI
 * accepts the form, shows a confirmation, and navigates back to the wiki
 * home. When the Supabase backend lands, this becomes the only place users
 * need to know — moderators will pick suggestions up from the admin queue.
 */
export default function WikiNew() {
  const { kind = 'character' } = useParams<{ kind?: 'character' | 'story' }>()
  const navigate = useNavigate()
  const t = useWikiText()
  const { lang } = useLangContext()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [shortBio, setShortBio] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
    editorProps: {
      attributes: {
        class:
          'min-h-[260px] w-full rounded-xl border border-border bg-background p-4 text-sm leading-relaxed text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30',
      },
    },
  })

  /** Auto-derive a URL-safe slug from the name as the user types. */
  const onNameChange = (v: string) => {
    setName(v)
    if (!slug || slug === slugify(name)) {
      setSlug(slugify(v))
    }
  }

  const canSubmit = name.trim() && slug.trim() && shortBio.trim()

  const handleSubmit = () => {
    if (!canSubmit) return
    setSubmitted(true)
    // TODO: POST { kind, name, slug, imageUrl, shortBio, body } to a Supabase
    // moderation queue. For now we just simulate the submission.
    setTimeout(() => navigate('/wiki'), 1400)
  }

  const isCharacter = kind === 'character'

  return (
    <WikiLayout showSearch={false}>
      <div className="mb-4 flex items-center gap-2 text-sm">
        <Link
          to="/wiki"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-text-muted hover:border-primary hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t.backToWikiHome}
        </Link>
        <h1 className="text-lg font-bold text-text">
          {isCharacter
            ? lang === 'vi' ? '➕ Thêm nhân vật mới' : '➕ Add new character'
            : lang === 'vi' ? '➕ Thêm cốt truyện mới' : '➕ Add new story'}
        </h1>
      </div>

      <div className="rounded-3xl border border-border bg-card p-6 shadow-xl">
        <p className="mb-6 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
          <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            {lang === 'vi'
              ? 'Mọi đóng góp sẽ được kiểm duyệt trước khi xuất hiện công khai. Cảm ơn bạn đã làm wiki phong phú hơn!'
              : 'All contributions go through moderation before being published. Thanks for making the wiki richer!'}
          </span>
        </p>

        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
              {isCharacter
                ? lang === 'vi' ? 'Tên nhân vật' : 'Character name'
                : lang === 'vi' ? 'Tên truyện' : 'Story title'}
              <span className="ml-1 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={isCharacter ? 'Frieren' : "Frieren: Beyond Journey's End"}
              maxLength={120}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
              {lang === 'vi' ? 'Slug URL' : 'URL slug'}
              <span className="ml-1 text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="rounded-l-xl border border-r-0 border-border bg-surface px-3 py-3 text-xs font-mono text-text-muted">
                /wiki/{kind}/
              </span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                placeholder={isCharacter ? 'frieren' : 'frieren-beyond'}
                maxLength={60}
                className="flex-1 rounded-r-xl border border-border bg-background px-4 py-3 font-mono text-sm text-text focus:border-primary focus:outline-none"
              />
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              {lang === 'vi'
                ? 'Auto-generate từ tên. Chỉ dùng chữ thường, số, gạch nối.'
                : 'Auto-generated from the name. Lowercase, numbers and dashes only.'}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="h-3 w-3" />
                {isCharacter
                  ? lang === 'vi' ? 'Ảnh đại diện (URL)' : 'Avatar URL'
                  : lang === 'vi' ? 'Ảnh bìa (URL)' : 'Cover URL'}
              </span>
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://s4.anilist.co/..."
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none"
            />
            {imageUrl && (
              <img
                src={imageUrl}
                alt=""
                className="mt-2 h-24 rounded-md border border-border object-cover"
                onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
              />
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
              {lang === 'vi' ? 'Tóm tắt ngắn (1-2 câu)' : 'Short summary (1-2 sentences)'}
              <span className="ml-1 text-red-500">*</span>
            </label>
            <textarea
              value={shortBio}
              onChange={(e) => setShortBio(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder={
                isCharacter
                  ? lang === 'vi'
                    ? 'Vd: Pháp sư Elf trường thọ, từng đồng hành cùng đoàn anh hùng...'
                    : 'E.g. A long-lived elven mage who once accompanied the Hero...'
                  : lang === 'vi'
                    ? 'Vd: Câu chuyện theo chân pháp sư Elf sau khi cuộc chiến...'
                    : 'E.g. The story follows an elven mage after the war against...'
              }
              className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-text-muted">{shortBio.length}/300</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
              {lang === 'vi' ? 'Nội dung chi tiết' : 'Full content'}
            </label>
            <p className="mb-2 text-[11px] text-text-muted">
              {lang === 'vi'
                ? 'Có thể dùng cú pháp [[Tên|slug]] để link sang nhân vật khác. Vd: [[Himmel|himmel]].'
                : 'Use [[Name|slug]] syntax to link to other characters. E.g. [[Himmel|himmel]].'}
            </p>
            <EditorContent editor={editor} />
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <Link
              to="/wiki"
              className="rounded-full border border-border px-4 py-2 text-sm text-text-muted hover:border-primary hover:text-text"
            >
              {t.cancel}
            </Link>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || submitted}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-primary-hover disabled:opacity-50 keep-white-on-light"
            >
              {submitted ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  {t.submitted}
                </>
              ) : (
                <>
                  {isCharacter ? <UserPlus className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                  {t.submitForReview}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </WikiLayout>
  )
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}
