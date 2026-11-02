/**
 * Provider re-export.
 *
 * After the AniList migration this is a thin pass-through to `anilist.ts`.
 * It is kept so existing route imports (`../lib/provider.js`) continue to
 * work without a code-wide find/replace.
 *
 * The spotlight and character-leaderboard helpers live in `anilist-extra.ts`.
 * Routing `getFeaturedAnime` through here means the rotating implementation
 * replaces the old static one everywhere with no changes at the call sites.
 */

export {
  getAnimeList,
  getSeasonAnime,
  searchAnime,
  getGenreOptions,
  getAnimeDetails,
  getCharacterDetails,
  getStudioDetails,
} from './anilist.js'

export { getFeaturedAnime, getTopCharacters, rotationSeed } from './anilist-extra.js'
export type { CharacterGender, RotationPeriod } from './anilist-extra.js'
