import express, { Request, Response } from 'express'
import { translateText } from './translate-lib.js'

const router = express.Router()

router.post('/', async (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    const targetLang = req.body?.targetLang === 'en' ? 'en' : 'vi'

    if (!text.trim()) {
      return res.status(400).json({ success: false, error: 'Missing text' })
    }

    const result = await translateText(text, targetLang)

    if (!result.available) {
      const reason = 'reason' in result ? result.reason : 'Translation unavailable'
      return res.status(503).json({
        success: false,
        unavailable: true,
        error: reason,
      })
    }

    return res.json({
      success: true,
      data: {
        text: result.translatedText,
      },
    })
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message })
  }
})

export default router
