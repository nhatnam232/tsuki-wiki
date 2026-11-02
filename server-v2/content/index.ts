/**
 * Content API (AniList/Jikan proxying + translation) ported from the legacy
 * `server/` Express app. These paths are what the frontend's `src/lib/api.ts`
 * calls, so they must exist on the self-hosted backend too.
 */
import type { Express } from 'express';
import animeRoutes from './anime';
import characterRoutes from './character';
import studioRoutes from './studio';
import searchRoutes from './search';
import seasonRoutes from './season';
import scheduleRoutes from './schedule';
import imageRoutes from './image';
import translateRoutes from './translate';
import wikiImportRoutes from './wiki-import';

export function mountContentRoutes(app: Express): void {
  app.use('/api/anime', animeRoutes);
  app.use('/api/character', characterRoutes);
  app.use('/api/studio', studioRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/season', seasonRoutes);
  app.use('/api/schedule', scheduleRoutes);
  app.use('/api/image', imageRoutes);
  app.use('/api/translate', translateRoutes);
  app.use('/api/wiki-import', wikiImportRoutes);
}
