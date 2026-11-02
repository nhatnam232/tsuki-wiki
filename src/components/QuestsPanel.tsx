import { useEffect, useState } from 'react'
import { CheckCircle2, Lock, Trophy } from 'lucide-react'
import { API_READY, quests as questsApi } from '@/lib/backend'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'
import { BADGES, type BadgeId } from '@/lib/badges'

type Quest = {
  id: string
  title: string
  description: string
  badge_reward: BadgeId | null
  target_value: number
  category: string
}

type Progress = {
  quest_id: string
  progress: number
  completed_at: string | null
}

/**
 * "Quests / Achievement" panel rendered inside Profile so users see their
 * active goals + progress bars. Reads from the `quests` + `user_quest_progress`
 * tables that v8 introduces.
 */
export default function QuestsPanel() {
  const { user } = useAuth()
  const { lang } = useLangContext()
  const [quests, setQuests] = useState<Quest[]>([])
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !API_READY) {
      setLoading(false)
      return
    }
    let cancelled = false

    ;(async () => {
      setLoading(true)
      const [qRes, pRes] = await Promise.all([questsApi.list(), questsApi.progress()])
      if (cancelled) return
      setQuests((qRes.items ?? []) as Quest[])
      const map = new Map<string, Progress>()
      for (const row of (pRes.items ?? []) as Progress[]) {
        map.set(row.quest_id, row)
      }
      setProgress(map)
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [user])

  if (!user) return null

  const groups = groupBy(quests, (q) => q.category)

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
          <Trophy className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-text">
            {lang === 'vi' ? 'Nhiệm vụ & thành tựu' : 'Quests & Achievements'}
          </h2>
          <p className="text-xs text-text-muted">
            {lang === 'vi' ? 'Hoàn thành để mở khoá huy hiệu mới' : 'Complete them to unlock new badges'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-background/40" />
          ))}
        </div>
      ) : quests.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-background/40 px-4 py-6 text-center text-sm text-text-muted">
          {lang === 'vi' ? 'Chưa có nhiệm vụ nào.' : 'No quests available.'}
        </p>
      ) : (
        <div className="space-y-5">
          {Object.entries(groups).map(([category, list]) => (
            <div key={category}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                {labelCategory(category, lang)}
              </p>
              <ul className="space-y-2">
                {list.map((quest) => (
                  <QuestRow key={quest.id} quest={quest} progress={progress.get(quest.id)} lang={lang} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function QuestRow({ quest, progress, lang }: { quest: Quest; progress?: Progress; lang: 'vi' | 'en' }) {
  const value = progress?.progress ?? 0
  const completed = !!progress?.completed_at
  const pct = Math.min(100, Math.round((value / quest.target_value) * 100))

  const badge = quest.badge_reward ? BADGES[quest.badge_reward] : null
  const BadgeIcon = badge?.icon

  return (
    <li className="rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
            completed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-surface text-text-muted'
          }`}
          title={completed ? 'Completed!' : 'In progress'}
        >
          {completed ? <CheckCircle2 className="h-4 w-4" /> : BadgeIcon ? <BadgeIcon className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text">{quest.title}</h3>
            <span className="flex-shrink-0 text-xs font-medium text-text-muted">
              {value}/{quest.target_value}
            </span>
          </div>
          <p className="text-xs text-text-muted">{quest.description}</p>
          {/* Progress bar */}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
            <div
              className={`h-full rounded-full transition-all ${
                completed ? 'bg-gradient-to-r from-emerald-500 to-emerald-300' : 'bg-gradient-to-r from-primary to-primary-hover'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {badge && (
            <p className="mt-1.5 text-[11px] text-text-muted">
              {lang === 'vi' ? 'Thưởng' : 'Reward'}:{' '}
              <span className="font-medium text-primary">
                {lang === 'vi' ? badge.labelVi : badge.labelEn}
              </span>
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

function groupBy<T>(arr: T[], by: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const x of arr) {
    const k = by(x)
    if (!out[k]) out[k] = []
    out[k].push(x)
  }
  return out
}

function labelCategory(c: string, lang: 'vi' | 'en'): string {
  const map: Record<string, [string, string]> = {
    seasonal: ['Theo mùa', 'Seasonal'],
    social:   ['Xã hội', 'Social'],
    curator:  ['Curator', 'Curator'],
    general:  ['Chung', 'General'],
  }
  const [vi, en] = map[c] ?? [c, c]
  return lang === 'vi' ? vi : en
}
