import express, { Request, Response } from 'express'
import { getStudioDetails } from './provider.js'

const router = express.Router()

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10)
    const data = await getStudioDetails(id)

    if (!data) {
      return res.status(404).json({ success: false, error: 'Studio not found' })
    }

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=604800')
    return res.json({
      success: true,
      data,
    })
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message })
  }
})

export default router
