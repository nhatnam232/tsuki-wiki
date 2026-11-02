import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLangContext } from '@/providers/LangProvider'

/**
 * Google OAuth callback: server-v2 đã exchange code, tạo session và set cookie
 * HttpOnly trước khi redirect về đây → frontend không cần xử lý gì.
 */
export default function AuthCallback() {
  const { t } = useLangContext()
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/', { replace: true })
  }, [navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-gray-300">
      {t.authSigningIn}
    </div>
  )
}
