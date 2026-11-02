export type Lang = 'vi' | 'en'

export type Translation = {
  searchPlaceholder: string
  home: string
  browse: string
  profile: string
  signIn: string
  signOut: string
  switchToVietnamese: string
  switchToEnglish: string
  language: string
  chooseLanguage: string
  currentLanguage: string
  vietnamese: string
  english: string
  languageChangedTo: (language: string) => string

  topAnime: string
  topAnimeByScore: string
  topAnimeCategory: (category: string) => string
  homeSubtitle: string
  viewDetails: string
  topRanked: string
  openSearch: string
  openSearchResults: string
  featuredSpotlight: string
  exploreByGenre: string
  routeTransitionLabel: string

  animeNotFound: string
  characterNotFound: string
  studioNotFound: string
  returnHome: string
  returnToHome: string

  synopsis: string
  background: string
  trailer: string
  communityStats: string
  watching: string
  completed: string
  onHold: string
  dropped: string
  planToWatch: string
  scoreDistribution: string
  opEdThemes: string
  openings: string
  endings: string
  whereToWatch: string
  characters: string
  charactersAndVoiceCast: string
  searchCharacter: string
  findCharacter: string
  clearSearch: string
  noCharFound: string
  noCharacterFound: string
  relations: string
  youMayAlsoLike: string
  like: string
  liked: string
  englishTitle: string
  japaneseTitle: string
  japaneseName: string
  synonyms: string
  status: string
  episodes: string
  duration: string
  season: string
  broadcast: string
  studio: string
  aired: string
  type: string
  source: string
  rating: string
  producers: string
  licensors: string
  demographics: string
  rank: string
  popularity: string
  members: string
  favorites: string
  scoreLabel: string
  votes: (count: string) => string
  unknown: string
  none: string
  main: string
  supporting: string
  cv: string
  episodesShort: string
  autoTranslation: string
  autoTranslationActive: string
  autoTranslationLoading: string
  autoTranslationUnavailable: string
  translateNow: string
  showOriginal: string
  translatedToVietnamese: string
  originalTextFallback: string

  searchResults: string
  searchResultsFor: (query: string) => string
  noResults: string
  noAnimeFound: string
  tryDifferent: string
  tryAdjusting: string
  filters: string
  searchFilters: string
  keyword: string
  keywordPlaceholder: string
  genre: string
  sortBy: string
  minScore: string
  maxScore: string
  applyFilters: string
  apply: string
  clearFilters: string
  clear: string
  clearAllFilters: string
  foundResults: (count: number) => string
  foundResultsInGenre: (count: number, genre: string) => string
  browseAnime: string
  previous: string
  next: string
  page: (current: number, total: number) => string
  all: string
  loadMore: string

  sortHighestScore: string
  sortMostPopular: string
  sortNewestFirst: string

  statusAll: string
  statusOngoing: string
  statusFinished: string
  statusUpcoming: string

  comments: string
  commentPlaceholder: string
  replyPlaceholder: string
  post: string
  reply: string
  delete: string
  signInToComment: string
  noComments: string
  loadingComments: string
  commentsDisabled: string
  anonymous: string
  justNow: string
  minutesAgo: (count: number) => string
  hoursAgo: (count: number) => string
  daysAgo: (count: number) => string

  loadError: string
  loadErrorMessage: string
  retry: string

  information: string
  nicknames: string
  biography: string
  appearsIn: string
  mainCharacter: string
  supportingCharacter: string

  totalAnime: string
  established: string
  animeProducedBy: (name: string) => string
  studios: string

  editProfile: string
  displayName: string
  username: string
  saveChanges: string
  changeAvatar: string
  yourProfile: string
  profileSubtitle: string
  backHome: string
  email: string
  joined: string
  usernameHint: string
  profileUpdated: string
  avatarUpdated: string
  updateProfileHint: string
  profileUnavailable: string
  profileOverview: string
  favoriteLibrary: string
  memberIdentity: string
  accountStatus: string
  accountStatusActive: string
  profileCompletion: string
  recentAvatarTip: string
  publicPresence: string

  pageNotFound: string
  pageNotFoundSubtitle: string
  backToHome: string

  close: string
  checkInbox: string
  checkInboxMessage: (email: string) => string
  gotIt: string
  welcomeBack: string
  createAccount: string
  authSigninSubtitle: string
  authSignupSubtitle: string
  authSigningIn: string
  authNotConfigured: string
  continueWithGoogle: string
  orEmail: string
  passwordPlaceholder: string
  googleSignInFailed: string
  createAccountAction: string
  noAccount: string
  alreadyHaveAccount: string
  signUp: string

  footerTagline: string
  unofficialIndex: string

  // ─── Theme ─────────────────────────────────────────────────────────────────
  theme: string
  themeLight: string
  themeDark: string
  themeSystem: string
  switchToLightMode: string
  switchToDarkMode: string

  // ─── Navigation ────────────────────────────────────────────────────────────
  exploreMenu: string
  exploreMenuHint: string
  scheduleNav: string
  libraryNav: string
  rankingNav: string
  seasonNav: string
  myLibrary: string

  // ─── Notifications ─────────────────────────────────────────────────────────
  notifications: string
  noNotifications: string
  notificationHint: string
  notificationNewEpisode: (animeTitle: string, episode: number) => string
  markAllRead: string
  viewAll: string

  // ─── Spotify mini player ───────────────────────────────────────────────────
  spotifyMiniLabel: string
  spotifyOpenFull: string
  spotifyClose: string

  // ─── Comments features ────────────────────────────────────────────────────
  spoilerWarning: string
  spoilerHide: string
  spoilerShow: string
  insertBold: string
  insertItalic: string
  insertSpoiler: string
  formattingHint: string
  noCommentsTitle: string
  beTheFirstToComment: string
  reportConfirm: string
  reportSent: string
  adminDelete: string
  adminLabel: string
  ownerLabel: string
  modLabel: string

  // ─── Profile cover ─────────────────────────────────────────────────────────
  changeCover: string
  removeCover: string
  coverHint: string
  coverUploaded: string

  // ─── Library activity tabs ────────────────────────────────────────────────
  activityWatching: string
  activityCompleted: string
  activityPlanToWatch: string
  activityDropped: string
  activityOnHold: string
  activityFavorites: string
  activityLibrary: string

  // ─── Season ───────────────────────────────────────────────────────────────
  seasonWinter: string
  seasonSpring: string
  seasonSummer: string
  seasonFall: string

  // Misc
  backToProfile: string
  loadMoreActivity: string
  noActivityForStatus: (status: string) => string
}


const en: Translation = {
  searchPlaceholder: 'Search anime titles...',
  home: 'Home',
  browse: 'Browse',
  profile: 'Profile',
  signIn: 'Sign In',
  signOut: 'Sign Out',
  switchToVietnamese: 'Switch to Vietnamese',
  switchToEnglish: 'Switch to English',
  language: 'Language',
  chooseLanguage: 'Choose language',
  currentLanguage: 'Current language',
  vietnamese: 'Vietnamese',
  english: 'English',
  languageChangedTo: (language: string) => `Language changed to ${language}`,

  topAnime: 'Top Anime by Score',
  topAnimeByScore: 'Top Anime by Score',
  topAnimeCategory: (category: string) => `Top ${category} Anime`,
  homeSubtitle: 'Real titles, posters, scores, and studio data curated for anime fans.',
  viewDetails: 'View Details',
  topRanked: 'Top Ranked',
  openSearch: 'Open Search Results',
  openSearchResults: 'Open Search Results',
  featuredSpotlight: 'Featured spotlight',
  exploreByGenre: 'Explore by genre',
  routeTransitionLabel: 'Page transition',

  animeNotFound: 'Anime not found',
  characterNotFound: 'Character not found',
  studioNotFound: 'Studio not found',
  returnHome: 'Return to Home',
  returnToHome: 'Return to Home',

  synopsis: 'Synopsis',
  background: 'Background',
  trailer: 'Trailer',
  communityStats: 'Community Stats',
  watching: 'Watching',
  completed: 'Completed',
  onHold: 'On Hold',
  dropped: 'Dropped',
  planToWatch: 'Plan to Watch',
  scoreDistribution: 'Score distribution',
  opEdThemes: 'OP / ED Themes',
  openings: 'Openings',
  endings: 'Endings',
  whereToWatch: 'Where to Watch',
  characters: 'Characters & Voice Cast',
  charactersAndVoiceCast: 'Characters & Voice Cast',
  searchCharacter: 'Search character...',
  findCharacter: 'Search character...',
  clearSearch: 'Clear search',
  noCharFound: 'No characters found',
  noCharacterFound: 'No characters found',
  relations: 'Relations',
  youMayAlsoLike: 'You May Also Like',
  like: 'Like',
  liked: 'Liked',
  englishTitle: 'English Title',
  japaneseTitle: 'Japanese Title',
  japaneseName: 'Japanese Name',
  synonyms: 'Synonyms',
  status: 'Status',
  episodes: 'Episodes',
  duration: 'Duration',
  season: 'Season',
  broadcast: 'Broadcast',
  studio: 'Studio',
  aired: 'Aired',
  type: 'Type',
  source: 'Source',
  rating: 'Rating',
  producers: 'Producers',
  licensors: 'Licensors',
  demographics: 'Demographics',
  rank: 'Rank',
  popularity: 'Popularity',
  members: 'Members',
  favorites: 'Favorites',
  scoreLabel: 'Score',
  votes: (count: string) => `${count} votes`,
  unknown: 'Unknown',
  none: 'None',
  main: 'Main',
  supporting: 'Supporting',
  cv: 'Voice',
  episodesShort: 'eps',
  autoTranslation: 'Auto translation',
  autoTranslationActive: 'Showing Vietnamese auto-translation',
  autoTranslationLoading: 'Translating to Vietnamese...',
  autoTranslationUnavailable: 'Automatic translation is not configured yet. Showing original text.',
  translateNow: 'Translate to Vietnamese',
  showOriginal: 'Show original',
  translatedToVietnamese: 'Vietnamese translation',
  originalTextFallback: 'Original text',

  searchResults: 'Search Results',
  searchResultsFor: (query: string) => `Search Results for "${query}"`,
  noResults: 'No results found',
  noAnimeFound: 'No anime found',
  tryDifferent: 'Try different keywords or filters',
  tryAdjusting: 'Try adjusting the keyword, genre, status, or score range.',
  filters: 'Filters',
  searchFilters: 'Search Filters',
  keyword: 'Keyword',
  keywordPlaceholder: 'Title or franchise',
  genre: 'Genre',
  sortBy: 'Sort By',
  minScore: 'Min Score',
  maxScore: 'Max Score',
  applyFilters: 'Apply Filters',
  apply: 'Apply',
  clearFilters: 'Clear Filters',
  clear: 'Clear',
  clearAllFilters: 'Clear All Filters',
  foundResults: (count: number) => `Found ${count} results`,
  foundResultsInGenre: (count: number, genre: string) => `Found ${count} results in ${genre}`,
  browseAnime: 'Browse Anime',
  previous: 'Previous',
  next: 'Next',
  page: (current: number, total: number) => `Page ${current} of ${total}`,
  all: 'All',
  loadMore: 'Load More',

  sortHighestScore: 'Highest Score',
  sortMostPopular: 'Most Popular',
  sortNewestFirst: 'Newest First',

  statusAll: 'All',
  statusOngoing: 'Ongoing',
  statusFinished: 'Finished',
  statusUpcoming: 'Upcoming',

  comments: 'Comments',
  commentPlaceholder: 'Share your thoughts...',
  replyPlaceholder: 'Write a reply...',
  post: 'Post',
  reply: 'Reply',
  delete: 'Delete',
  signInToComment: 'Sign in to join the discussion.',
  noComments: 'No comments yet. Be the first!',
  loadingComments: 'Loading comments...',
  commentsDisabled: 'Comments are disabled because Supabase is not configured.',
  anonymous: 'Anon',
  justNow: 'just now',
  minutesAgo: (count: number) => `${count}m ago`,
  hoursAgo: (count: number) => `${count}h ago`,
  daysAgo: (count: number) => `${count}d ago`,

  loadError: 'Unable to load data. Please try again.',
  loadErrorMessage: 'Unable to load data. Please try again.',
  retry: 'Retry',

  information: 'Information',
  nicknames: 'Nicknames',
  biography: 'Biography',
  appearsIn: 'Appears In',
  mainCharacter: 'Main Character',
  supportingCharacter: 'Supporting Character',

  totalAnime: 'Total Anime',
  established: 'Established',
  animeProducedBy: (name: string) => `Anime produced by ${name}`,
  studios: 'Studios',

  editProfile: 'Edit Profile',
  displayName: 'Display Name',
  username: 'Username',
  saveChanges: 'Save Changes',
  changeAvatar: 'Change Avatar',
  yourProfile: 'Your profile',
  profileSubtitle: 'Sign in to edit your display name, avatar, and account details.',
  backHome: 'Back home',
  email: 'Email',
  joined: 'Joined',
  usernameHint: 'Letters, numbers, and underscores work best.',
  profileUpdated: 'Profile updated.',
  avatarUpdated: 'Avatar updated.',
  updateProfileHint: 'Update the identity other fans will see when you post comments or save favorites.',
  profileUnavailable: 'Supabase auth is not configured, so the profile page is currently unavailable.',
  profileOverview: 'Profile overview',
  favoriteLibrary: 'Favorite library',
  memberIdentity: 'Member identity',
  accountStatus: 'Account status',
  accountStatusActive: 'Active',
  profileCompletion: 'Profile completion',
  recentAvatarTip: 'Use a clear square image so your avatar stays sharp everywhere.',
  publicPresence: 'This is how your profile appears when you comment or save anime.',

  pageNotFound: 'Page Not Found',
  pageNotFoundSubtitle: 'The page you are looking for does not exist, may have moved, or the link is invalid.',
  backToHome: 'Back to Home',

  close: 'Close',
  checkInbox: 'Check your inbox',
  checkInboxMessage: (email: string) =>
    `We sent a confirmation link to ${email}. Click it to activate your account.`,
  gotIt: 'Got it',
  welcomeBack: 'Welcome back',
  createAccount: 'Create an account',
  authSigninSubtitle: 'Sign in to like anime and join the discussion.',
  authSignupSubtitle: 'Join Anime Wiki to save favorites and leave comments.',
  authSigningIn: 'Signing you in...',
  authNotConfigured: 'Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  continueWithGoogle: 'Continue with Google',
  orEmail: 'or email',
  passwordPlaceholder: 'Password (min 6 chars)',
  googleSignInFailed: 'Google sign-in failed',
  createAccountAction: 'Create account',
  noAccount: 'No account?',
  alreadyHaveAccount: 'Already have an account?',
  signUp: 'Sign up',

  footerTagline: 'Your curated anime companion for titles, synopses, scores, characters, and studios.',
  unofficialIndex: 'An unofficial anime index.',

  theme: 'Theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  switchToLightMode: 'Switch to light mode',
  switchToDarkMode: 'Switch to dark mode',

  exploreMenu: 'Explore',
  exploreMenuHint: 'Quickly jump to seasonal, schedule, ranking, library',
  scheduleNav: 'Schedule',
  libraryNav: 'Library',
  rankingNav: 'Ranking',
  seasonNav: 'Seasonal',
  myLibrary: 'My Library',

  notifications: 'Notifications',
  noNotifications: 'No notifications yet',
  notificationHint: 'You will be notified when anime in your library has new episodes.',
  notificationNewEpisode: (animeTitle: string, episode: number) =>
    `New episode #${episode} of "${animeTitle}" is now available!`,
  markAllRead: 'Mark all as read',
  viewAll: 'View all',

  spotifyMiniLabel: 'Now playing on Spotify',
  spotifyOpenFull: 'Expand player',
  spotifyClose: 'Close mini player',

  spoilerWarning: 'Spoiler — click to reveal',
  spoilerHide: 'Hide spoiler',
  spoilerShow: 'Show spoiler',
  insertBold: 'Bold',
  insertItalic: 'Italic',
  insertSpoiler: 'Spoiler',
  formattingHint: 'Supports **bold**, *italic*, ~~strike~~, and ||spoiler|| tags',
  noCommentsTitle: 'The discussion is just getting started',
  beTheFirstToComment: 'Be the first to share your thoughts about this anime!',
  reportConfirm: 'Report this comment to moderators?',
  reportSent: 'Thanks — moderators will review this comment.',
  adminDelete: 'Delete (admin)',
  adminLabel: 'Admin',
  ownerLabel: 'Owner',
  modLabel: 'Mod',

  changeCover: 'Change cover',
  removeCover: 'Remove cover',
  coverHint: 'Recommended size: 1500×500. Max 5 MB.',
  coverUploaded: 'Cover photo updated.',

  activityWatching: 'Watching',
  activityCompleted: 'Completed',
  activityPlanToWatch: 'Plan to Watch',
  activityDropped: 'Dropped',
  activityOnHold: 'On Hold',
  activityFavorites: 'Favorites',
  activityLibrary: 'Library',

  seasonWinter: 'Winter',
  seasonSpring: 'Spring',
  seasonSummer: 'Summer',
  seasonFall: 'Fall',

  backToProfile: 'Back to profile',
  loadMoreActivity: 'Load more',
  noActivityForStatus: (status: string) => `No anime in "${status}" yet`,
}

const vi: Translation = {

  searchPlaceholder: 'Tìm kiếm tên anime...',
  home: 'Trang chủ',
  browse: 'Duyệt anime',
  profile: 'Hồ sơ',
  signIn: 'Đăng nhập',
  signOut: 'Đăng xuất',
  switchToVietnamese: 'Chuyển sang tiếng Việt',
  switchToEnglish: 'Chuyển sang tiếng Anh',
  language: 'Ngôn ngữ',
  chooseLanguage: 'Chọn ngôn ngữ',
  currentLanguage: 'Ngôn ngữ hiện tại',
  vietnamese: 'Tiếng Việt',
  english: 'English',
  languageChangedTo: (language: string) => `Đã chuyển sang ${language}`,

  topAnime: 'Anime nổi bật theo điểm số',
  topAnimeByScore: 'Anime nổi bật theo điểm số',
  topAnimeCategory: (category: string) => `Anime ${category} nổi bật`,
  homeSubtitle: 'Tựa phim, poster, điểm số và thông tin studio được trình bày gọn gàng cho fan anime.',
  viewDetails: 'Xem chi tiết',
  topRanked: 'Xếp hạng cao',
  openSearch: 'Mở trang tìm kiếm',
  openSearchResults: 'Mở trang tìm kiếm',
  featuredSpotlight: 'Tâm điểm nổi bật',
  exploreByGenre: 'Khám phá theo thể loại',
  routeTransitionLabel: 'Chuyển trang',

  animeNotFound: 'Không tìm thấy anime',
  characterNotFound: 'Không tìm thấy nhân vật',
  studioNotFound: 'Không tìm thấy studio',
  returnHome: 'Về trang chủ',
  returnToHome: 'Về trang chủ',

  synopsis: 'Tóm tắt',
  background: 'Bối cảnh',
  trailer: 'Trailer',
  communityStats: 'Thống kê cộng đồng',
  watching: 'Đang xem',
  completed: 'Đã hoàn thành',
  onHold: 'Tạm dừng',
  dropped: 'Bỏ dở',
  planToWatch: 'Dự định xem',
  scoreDistribution: 'Phân bố điểm số',
  opEdThemes: 'Nhạc mở đầu / kết thúc',
  openings: 'Mở đầu',
  endings: 'Kết thúc',
  whereToWatch: 'Xem ở đâu',
  characters: 'Nhân vật và lồng tiếng',
  charactersAndVoiceCast: 'Nhân vật và lồng tiếng',
  searchCharacter: 'Tìm nhân vật...',
  findCharacter: 'Tìm nhân vật...',
  clearSearch: 'Xóa tìm kiếm',
  noCharFound: 'Không tìm thấy nhân vật phù hợp',
  noCharacterFound: 'Không tìm thấy nhân vật',
  relations: 'Tác phẩm liên quan',
  youMayAlsoLike: 'Có thể bạn cũng thích',
  like: 'Yêu thích',
  liked: 'Đã thích',
  englishTitle: 'Tên tiếng Anh',
  japaneseTitle: 'Tên tiếng Nhật',
  japaneseName: 'Tên tiếng Nhật',
  synonyms: 'Tên khác',
  status: 'Trạng thái',
  episodes: 'Số tập',
  duration: 'Thời lượng',
  season: 'Mùa',
  broadcast: 'Lịch phát sóng',
  studio: 'Studio',
  aired: 'Phát hành',
  type: 'Loại',
  source: 'Nguồn gốc',
  rating: 'Phân loại',
  producers: 'Nhà sản xuất',
  licensors: 'Đơn vị phát hành',
  demographics: 'Đối tượng',
  rank: 'Hạng',
  popularity: 'Độ phổ biến',
  members: 'Thành viên',
  favorites: 'Lượt yêu thích',
  scoreLabel: 'Điểm',
  votes: (count: string) => `${count} lượt đánh giá`,
  unknown: 'Không rõ',
  none: 'Không có',
  main: 'Chính',
  supporting: 'Phụ',
  cv: 'Lồng tiếng',
  episodesShort: 'tập',
  autoTranslation: 'Dịch tự động',
  autoTranslationActive: 'Đang hiển thị bản dịch tiếng Việt tự động',
  autoTranslationLoading: 'Đang dịch sang tiếng Việt...',
  autoTranslationUnavailable: 'Chưa cấu hình dịch tự động. Tạm hiển thị nội dung gốc.',
  translateNow: 'Dịch sang tiếng Việt',
  showOriginal: 'Xem bản gốc',
  translatedToVietnamese: 'Bản dịch tiếng Việt',
  originalTextFallback: 'Nội dung gốc',

  searchResults: 'Kết quả tìm kiếm',
  searchResultsFor: (query: string) => `Kết quả tìm kiếm cho "${query}"`,
  noResults: 'Không có kết quả',
  noAnimeFound: 'Không tìm thấy anime',
  tryDifferent: 'Thử từ khóa hoặc bộ lọc khác',
  tryAdjusting: 'Hãy thử đổi từ khóa, thể loại, trạng thái hoặc khoảng điểm.',
  filters: 'Bộ lọc',
  searchFilters: 'Bộ lọc tìm kiếm',
  keyword: 'Từ khóa',
  keywordPlaceholder: 'Tên anime hoặc franchise',
  genre: 'Thể loại',
  sortBy: 'Sắp xếp',
  minScore: 'Điểm tối thiểu',
  maxScore: 'Điểm tối đa',
  applyFilters: 'Áp dụng',
  apply: 'Áp dụng',
  clearFilters: 'Xóa bộ lọc',
  clear: 'Xóa',
  clearAllFilters: 'Xóa toàn bộ bộ lọc',
  foundResults: (count: number) => `Tìm thấy ${count} kết quả`,
  foundResultsInGenre: (count: number, genre: string) => `Tìm thấy ${count} kết quả trong ${genre}`,
  browseAnime: 'Khám phá anime',
  previous: 'Trang trước',
  next: 'Trang sau',
  page: (current: number, total: number) => `Trang ${current} / ${total}`,
  all: 'Tất cả',
  loadMore: 'Tải thêm',

  sortHighestScore: 'Điểm cao nhất',
  sortMostPopular: 'Phổ biến nhất',
  sortNewestFirst: 'Mới nhất',

  statusAll: 'Tất cả',
  statusOngoing: 'Đang chiếu',
  statusFinished: 'Đã hoàn thành',
  statusUpcoming: 'Sắp chiếu',

  comments: 'Bình luận',
  commentPlaceholder: 'Chia sẻ cảm nghĩ của bạn...',
  replyPlaceholder: 'Viết phản hồi...',
  post: 'Đăng',
  reply: 'Trả lời',
  delete: 'Xóa',
  signInToComment: 'Đăng nhập để tham gia thảo luận.',
  noComments: 'Chưa có bình luận nào. Hãy mở đầu cuộc trò chuyện.',
  loadingComments: 'Đang tải bình luận...',
  commentsDisabled: 'Bình luận đang tắt vì Supabase chưa được cấu hình.',
  anonymous: 'Ẩn danh',
  justNow: 'vừa xong',
  minutesAgo: (count: number) => `${count} phút trước`,
  hoursAgo: (count: number) => `${count} giờ trước`,
  daysAgo: (count: number) => `${count} ngày trước`,

  loadError: 'Không thể tải dữ liệu. Vui lòng thử lại.',
  loadErrorMessage: 'Không thể tải dữ liệu. Vui lòng thử lại.',
  retry: 'Thử lại',

  information: 'Thông tin',
  nicknames: 'Biệt danh',
  biography: 'Tiểu sử',
  appearsIn: 'Xuất hiện trong',
  mainCharacter: 'Nhân vật chính',
  supportingCharacter: 'Nhân vật phụ',

  totalAnime: 'Tổng anime',
  established: 'Thành lập',
  animeProducedBy: (name: string) => `Anime do ${name} sản xuất`,
  studios: 'Studio',

  editProfile: 'Chỉnh sửa hồ sơ',
  displayName: 'Tên hiển thị',
  username: 'Tên người dùng',
  saveChanges: 'Lưu thay đổi',
  changeAvatar: 'Đổi ảnh đại diện',
  yourProfile: 'Hồ sơ của bạn',
  profileSubtitle: 'Đăng nhập để chỉnh sửa tên hiển thị, ảnh đại diện và thông tin tài khoản.',
  backHome: 'Về trang chủ',
  email: 'Email',
  joined: 'Ngày tham gia',
  usernameHint: 'Nên dùng chữ cái, số và dấu gạch dưới.',
  profileUpdated: 'Đã cập nhật hồ sơ.',
  avatarUpdated: 'Đã cập nhật ảnh đại diện.',
  updateProfileHint: 'Cập nhật danh tính mà người khác sẽ nhìn thấy khi bạn bình luận hoặc lưu anime yêu thích.',
  profileUnavailable: 'Supabase auth chưa được cấu hình nên trang hồ sơ hiện chưa khả dụng.',
  profileOverview: 'Tổng quan hồ sơ',
  favoriteLibrary: 'Thư viện yêu thích',
  memberIdentity: 'Nhận diện thành viên',
  accountStatus: 'Trạng thái tài khoản',
  accountStatusActive: 'Đang hoạt động',
  profileCompletion: 'Mức hoàn thiện hồ sơ',
  recentAvatarTip: 'Nên dùng ảnh vuông rõ nét để avatar không bị mờ ở mọi nơi.',
  publicPresence: 'Đây là cách hồ sơ của bạn xuất hiện khi bình luận hoặc lưu anime.',

  pageNotFound: 'Không tìm thấy trang',
  pageNotFoundSubtitle: 'Trang bạn đang tìm không tồn tại, có thể đã được chuyển đi hoặc liên kết không hợp lệ.',
  backToHome: 'Về trang chủ',

  close: 'Đóng',
  checkInbox: 'Kiểm tra hộp thư',
  checkInboxMessage: (email: string) =>
    `Chúng tôi đã gửi liên kết xác nhận đến ${email}. Hãy mở email để kích hoạt tài khoản.`,
  gotIt: 'Đã hiểu',
  welcomeBack: 'Chào mừng quay lại',
  createAccount: 'Tạo tài khoản',
  authSigninSubtitle: 'Đăng nhập để thích anime và tham gia thảo luận.',
  authSignupSubtitle: 'Tham gia Anime Wiki để lưu yêu thích và để lại bình luận.',
  authSigningIn: 'Đang đăng nhập...',
  authNotConfigured: 'Auth chưa được cấu hình. Hãy thiết lập VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY.',
  continueWithGoogle: 'Tiếp tục với Google',
  orEmail: 'hoặc email',
  passwordPlaceholder: 'Mật khẩu (tối thiểu 6 ký tự)',
  googleSignInFailed: 'Đăng nhập Google thất bại',
  createAccountAction: 'Tạo tài khoản',
  noAccount: 'Chưa có tài khoản?',
  alreadyHaveAccount: 'Đã có tài khoản?',
  signUp: 'Đăng ký',

  footerTagline: 'Người bạn đồng hành anime để xem tiêu đề, tóm tắt, điểm số, nhân vật và studio trong một nơi.',
  unofficialIndex: 'Thư mục anime không chính thức.',

  theme: 'Giao diện',
  themeLight: 'Sáng',
  themeDark: 'Tối',
  themeSystem: 'Theo hệ thống',
  switchToLightMode: 'Chuyển sang giao diện sáng',
  switchToDarkMode: 'Chuyển sang giao diện tối',

  exploreMenu: 'Khám phá',
  exploreMenuHint: 'Truy cập nhanh: theo mùa, lịch chiếu, xếp hạng, thư viện',
  scheduleNav: 'Lịch chiếu',
  libraryNav: 'Thư viện',
  rankingNav: 'Xếp hạng',
  seasonNav: 'Theo mùa',
  myLibrary: 'Thư viện của tôi',

  notifications: 'Thông báo',
  noNotifications: 'Chưa có thông báo nào',
  notificationHint: 'Bạn sẽ được thông báo khi anime trong thư viện có tập mới.',
  notificationNewEpisode: (animeTitle: string, episode: number) =>
    `Anime "${animeTitle}" vừa có tập mới #${episode}!`,
  markAllRead: 'Đánh dấu tất cả đã đọc',
  viewAll: 'Xem tất cả',

  spotifyMiniLabel: 'Đang phát trên Spotify',
  spotifyOpenFull: 'Mở rộng trình phát',
  spotifyClose: 'Đóng mini player',

  spoilerWarning: 'Spoiler — bấm để hiển thị',
  spoilerHide: 'Ẩn spoiler',
  spoilerShow: 'Hiện spoiler',
  insertBold: 'In đậm',
  insertItalic: 'In nghiêng',
  insertSpoiler: 'Spoiler',
  formattingHint: 'Hỗ trợ **đậm**, *nghiêng*, ~~gạch~~ và ||spoiler||',
  noCommentsTitle: 'Cuộc thảo luận đang chờ bạn',
  beTheFirstToComment: 'Hãy là người đầu tiên chia sẻ cảm nhận về anime này!',
  reportConfirm: 'Báo cáo bình luận này tới mod?',
  reportSent: 'Cảm ơn — mod sẽ xem xét bình luận này.',
  adminDelete: 'Xóa (admin)',
  adminLabel: 'Sáng lập',
  ownerLabel: 'Tác giả',
  modLabel: 'Quản trị',

  changeCover: 'Đổi ảnh bìa',
  removeCover: 'Xóa ảnh bìa',
  coverHint: 'Kích thước khuyên dùng: 1500×500. Tối đa 5 MB.',
  coverUploaded: 'Đã cập nhật ảnh bìa.',

  activityWatching: 'Đang xem',
  activityCompleted: 'Đã xem',
  activityPlanToWatch: 'Muốn xem',
  activityDropped: 'Đã bỏ',
  activityOnHold: 'Tạm dừng',
  activityFavorites: 'Yêu thích',
  activityLibrary: 'Thư viện',

  seasonWinter: 'Đông',
  seasonSpring: 'Xuân',
  seasonSummer: 'Hè',
  seasonFall: 'Thu',

  backToProfile: 'Về trang hồ sơ',
  loadMoreActivity: 'Xem thêm',
  noActivityForStatus: (status: string) => `Chưa có anime nào trong "${status}"`,
}

export const translations: Record<Lang, Translation> = { en, vi }


export const DEFAULT_LANG: Lang = 'en'
export const LANG_STORAGE_KEY = 'anm-lang'
