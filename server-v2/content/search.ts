import express, { Request, Response } from 'express'
import { getGenreOptions, searchAnime } from './provider.js'

const router = express.Router()

router.get('/filters', async (_req: Request, res: Response) => {
  try {
    const genres = await getGenreOptions()
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400')
    res.json({
      success: true,
      data: {
        genres,
        statuses: ['All', 'Ongoing', 'Finished', 'Upcoming'],
        sorts: [
          { value: 'score', label: 'Highest Score' },
          { value: 'popularity', label: 'Most Popular' },
          { value: 'newest', label: 'Newest First' },
        ],
      },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Number.parseInt(req.query.page as string, 10) || 1
    const limit = Number.parseInt(req.query.limit as string, 10) || 20
    const minScore = Number.parseFloat(req.query.min_score as string)
    const maxScore = Number.parseFloat(req.query.max_score as string)

    const result = await searchAnime({
      q: (req.query.q as string) || '',
      genre: req.query.genre as string,
      status: req.query.status as string,
      min_score: Number.isNaN(minScore) ? undefined : minScore,
      max_score: Number.isNaN(maxScore) ? undefined : maxScore,
      sort: req.query.sort as string,
      page,
      limit,
    })

    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400')
    res.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
