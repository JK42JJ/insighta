import type { MandalaLevel, InsightCard, LinkType, UrlMetadata } from '@/entities/card/model/types';
import { supabase } from '@/shared/integrations/supabase/client';

export const createMockCards = (): InsightCard[] => [
  {
    id: 'card-1',
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Programming Basics - Variables and Types',
    thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    userNote: 'Learned variable declaration and basic data types. Refer to 02:30',
    createdAt: new Date('2024-01-15'),
    cellIndex: 0,
    levelId: 'root',
    linkType: 'youtube',
  },
  {
    id: 'card-2',
    videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    title: 'Building a Healthy Morning Routine',
    thumbnail: 'https://img.youtube.com/vi/jNQXAC9IVRw/mqdefault.jpg',
    userNote: '5am wake up, 10min meditation, 30min exercise routine',
    createdAt: new Date('2024-01-16'),
    cellIndex: 1,
    levelId: 'root',
    linkType: 'youtube',
  },
  {
    id: 'card-3',
    videoUrl: 'https://www.youtube.com/watch?v=9bZkp7q19f0',
    title: 'Mastering English Pronunciation',
    thumbnail: 'https://img.youtube.com/vi/9bZkp7q19f0/mqdefault.jpg',
    userNote: 'TH pronunciation and R/L distinction practice notes',
    createdAt: new Date('2024-01-17'),
    cellIndex: 3,
    levelId: 'root',
    linkType: 'youtube',
  },
];

export const createScratchPadCards = (): InsightCard[] => [
  {
    id: 'scratch-1',
    videoUrl: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
    title: 'Uncategorized video',
    thumbnail: 'https://img.youtube.com/vi/fJ9rUzIMcZQ/mqdefault.jpg',
    userNote: '',
    createdAt: new Date('2024-01-18'),
    cellIndex: -1,
    levelId: 'scratchpad',
    linkType: 'youtube',
  },
];

export const mockMandalaLevels: Record<string, MandalaLevel> = {
  root: {
    id: 'root',
    centerGoal: '2024 Goals',
    subjects: [
      'Programming',
      'Health',
      'Reading',
      'English',
      'Finance',
      'Relationships',
      'Hobbies',
      'Self-Development',
    ],
    parentId: null,
    parentCellIndex: null,
    cards: [],
  },
  programming: {
    id: 'programming',
    centerGoal: 'Programming',
    subjects: [
      'React',
      'TypeScript',
      'Node.js',
      'Database',
      'Algorithms',
      'Projects',
      'DevOps',
      'Testing',
    ],
    parentId: 'root',
    parentCellIndex: 0,
    cards: [],
  },
  health: {
    id: 'health',
    centerGoal: 'Health',
    subjects: [
      'Exercise',
      'Diet',
      'Sleep',
      'Meditation',
      'Weight Management',
      'Regular Checkups',
      'Stress',
      'Posture',
    ],
    parentId: 'root',
    parentCellIndex: 1,
    cards: [],
  },
};

/** Parse text/uri-list format: extract first valid URL, skip # comments, trim whitespace (RFC 2483) */
export const extractUrlFromDragData = (raw: string): string | null => {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      return trimmed;
    }
  }
  return null;
};

/** Extract URL from HTML drag data (text/html fallback) */
export const extractUrlFromHtml = (html: string): string | null => {
  const match = html.match(/href=["']([^"']+)["']/i);
  return match ? match[1] : null;
};

// Extract YouTube playlist ID from URL
export const extractYouTubePlaylistId = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('list');
  } catch {
    return null;
  }
};

// Detect link type from URL
export const detectLinkType = (url: string): LinkType => {
  const lowerUrl = url.toLowerCase();

  // YouTube Playlist (must check before regular youtube)
  // - /playlist?list=PLxxx → playlist import
  // - /watch?v=xxx&list=PLxxx → single video (video ID takes priority)
  if (
    (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) &&
    extractYouTubePlaylistId(url)
  ) {
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.get('v') && !lowerUrl.includes('/shorts/')) {
        return 'youtube-playlist';
      }
    } catch {
      return 'youtube-playlist';
    }
  }

  // YouTube Shorts
  if (lowerUrl.includes('youtube.com/shorts/') || lowerUrl.includes('youtu.be/shorts/')) {
    return 'youtube-shorts';
  }

  // YouTube regular
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
    return 'youtube';
  }

  // LinkedIn
  if (lowerUrl.includes('linkedin.com')) {
    return 'linkedin';
  }

  // Facebook
  if (
    lowerUrl.includes('facebook.com') ||
    lowerUrl.includes('fb.com') ||
    lowerUrl.includes('fb.watch')
  ) {
    return 'facebook';
  }

  // Notion
  if (lowerUrl.includes('notion.so') || lowerUrl.includes('notion.site')) {
    return 'notion';
  }

  // Text files
  if (lowerUrl.endsWith('.txt')) {
    return 'txt';
  }

  // Markdown files
  if (lowerUrl.endsWith('.md') || lowerUrl.endsWith('.markdown')) {
    return 'md';
  }

  // PDF files
  if (lowerUrl.endsWith('.pdf')) {
    return 'pdf';
  }

  return 'other';
};

// Helper to extract YouTube video ID from URL (including Shorts)
export const extractYouTubeId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
};

// Check if URL is valid for our supported types (URLs or file extensions)
export const isValidUrl = (url: string): boolean => {
  const linkType = detectLinkType(url);
  // Accept all known types including file types
  return linkType !== 'other' || url.startsWith('blob:') || url.startsWith('data:');
};

// Get thumbnail for different link types
export const getThumbnailForUrl = (url: string, linkType: LinkType): string => {
  switch (linkType) {
    case 'youtube':
    case 'youtube-shorts': {
      const videoId = extractYouTubeId(url);
      return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : '/placeholder.svg';
    }
    case 'linkedin':
      return '/placeholder.svg';
    case 'facebook':
      return '/placeholder.svg';
    case 'notion':
      return '/placeholder.svg';
    case 'txt':
      return '/placeholder.svg';
    case 'md':
      return '/placeholder.svg';
    case 'pdf':
      return '/placeholder.svg';
    default:
      return '/placeholder.svg';
  }
};

// Create a new card from any supported URL
export const createCardFromUrl = (
  url: string,
  cellIndex: number,
  levelId: string = 'root'
): InsightCard => {
  const linkType = detectLinkType(url);
  const thumbnail = getThumbnailForUrl(url, linkType);

  return {
    id: crypto.randomUUID(),
    videoUrl: url,
    title: '', // Will be fetched asynchronously
    thumbnail,
    userNote: '',
    createdAt: new Date(),
    cellIndex,
    levelId,
    linkType,
  };
};

// Get default title for link type (English fallback for non-i18n contexts)
const getDefaultTitleForLinkType = (linkType: LinkType): string => {
  switch (linkType) {
    case 'youtube':
    case 'youtube-shorts':
      return 'YouTube Video';
    case 'linkedin':
      return 'LinkedIn Post';
    case 'facebook':
      return 'Facebook Post';
    case 'notion':
      return 'Notion Page';
    case 'txt':
      return 'Text File';
    case 'md':
      return 'Markdown File';
    case 'pdf':
      return 'PDF Document';
    default:
      return 'Link';
  }
};

// Fetch title for different link types
export const fetchLinkTitle = async (url: string, linkType: LinkType): Promise<string> => {
  try {
    switch (linkType) {
      case 'youtube':
      case 'youtube-shorts': {
        const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const response = await fetch(oEmbedUrl);
        if (response.ok) {
          const data = await response.json();
          return data.title || 'YouTube Video';
        }
        return 'YouTube Video';
      }
      case 'linkedin':
        return 'LinkedIn Post';
      case 'facebook':
        return 'Facebook Post';
      case 'notion':
        return 'Notion Page';
      case 'txt':
        return decodeURIComponent(url.split('/').pop() || 'Text File');
      case 'md':
        return decodeURIComponent(url.split('/').pop() || 'Markdown File');
      case 'pdf':
        return decodeURIComponent(url.split('/').pop() || 'PDF Document');
      default:
        return 'Link';
    }
  } catch (error) {
    console.error('Failed to fetch link title:', error);
    return getDefaultTitleForLinkType(linkType);
  }
};

// Fetch URL metadata (OG tags) for external links
export const fetchUrlMetadata = async (url: string): Promise<UrlMetadata | null> => {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-url-metadata', {
      body: { url },
    });

    if (error) {
      console.error('Failed to fetch URL metadata:', error);
      return null;
    }

    return data?.metadata || null;
  } catch (error) {
    console.error('Error fetching URL metadata:', error);
    return null;
  }
};

// Legacy function for backward compatibility
export const fetchYouTubeTitle = async (url: string): Promise<string> => {
  return fetchLinkTitle(url, detectLinkType(url));
};
