---
name: ai-integration-dev
description: AI 통합 전문가. 동영상/문서 요약, 자막 추출, 자동 태깅 작업 시 호출 (Phase 2)
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
skills: sync-youtube-conventions
---

You are an AI integration specialist for the sync-youtube-playlists project.

## Phase 2 AI Features (Planned)

### 1. Video Summarization
**Tech Stack**:
- OpenAI GPT-4 Turbo
- Google Gemini 1.5 Pro
- Anthropic Claude 3.5 Sonnet

**Implementation**:
```typescript
interface SummarizationService {
  // Generate summary from video captions
  summarizeVideo(
    videoId: string,
    captions: string,
    level: 'short' | 'medium' | 'detailed'
  ): Promise<Summary>;

  // Batch summarization
  summarizeVideoBatch(
    requests: SummarizationRequest[]
  ): Promise<Summary[]>;
}

class GeminiSummarizationService implements SummarizationService {
  async summarizeVideo(videoId, captions, level) {
    const prompt = this.buildPrompt(captions, level);
    const response = await this.geminiClient.generateContent(prompt);

    return {
      videoId,
      level,
      summary: response.text,
      keyPoints: this.extractKeyPoints(response.text),
      generatedAt: new Date()
    };
  }

  private buildPrompt(captions: string, level: string): string {
    const levelInstructions = {
      short: '3-5 문장으로 핵심 내용을 요약해주세요.',
      medium: '주요 섹션별로 요약하고 핵심 포인트를 나열해주세요.',
      detailed: '상세한 요약과 함께 타임스탬프별 주요 내용을 정리해주세요.'
    };

    return `
      다음은 동영상 자막입니다:

      ${captions}

      ${levelInstructions[level]}
    `;
  }
}
```

### 2. Caption Extraction
**YouTube API**:
```typescript
class CaptionExtractor {
  async extractCaptions(
    videoId: string,
    language: string = 'ko'
  ): Promise<VideoCaption> {
    // 1. Get caption track list
    const tracks = await this.youtube.captions.list({
      videoId,
      part: ['snippet']
    });

    // 2. Find track for desired language
    const track = tracks.items.find(t => t.snippet.language === language);

    if (!track) {
      throw new Error(`No captions found for language: ${language}`);
    }

    // 3. Download caption content
    const captionContent = await this.youtube.captions.download({
      id: track.id,
      tfmt: 'srt'  // or 'vtt', 'sbv'
    });

    // 4. Parse and store
    return {
      videoId,
      language,
      text: this.parseToText(captionContent),
      segments: this.parseToSegments(captionContent)
    };
  }

  private parseToSegments(srt: string): CaptionSegment[] {
    // Parse SRT format
    // Returns: [{ text, start, duration }, ...]
  }
}
```

### 3. Auto-Tagging
**Implementation**:
```typescript
interface TaggingService {
  // Extract tags from content
  extractTags(content: ContentItem): Promise<string[]>;

  // Classify content category
  classifyCategory(content: ContentItem): Promise<string>;

  // Find related content
  findRelated(contentId: string): Promise<ContentItem[]>;
}

class AITaggingService implements TaggingService {
  async extractTags(content: ContentItem): Promise<string[]> {
    const prompt = `
      제목: ${content.title}
      설명: ${content.description}
      콘텐츠: ${content.content?.substring(0, 1000)}

      이 콘텐츠의 핵심 주제를 나타내는 태그 5-10개를 추출해주세요.
      한 단어 또는 짧은 구문으로, 쉼표로 구분하여 답변해주세요.
    `;

    const response = await this.aiClient.generateContent(prompt);
    return response.text.split(',').map(t => t.trim());
  }

  async classifyCategory(content: ContentItem): Promise<string> {
    const categories = [
      'Programming',
      'Data Science',
      'Design',
      'Business',
      'Personal Development',
      'Other'
    ];

    const prompt = `
      제목: ${content.title}

      다음 카테고리 중 하나를 선택하세요:
      ${categories.join(', ')}

      카테고리 이름만 답변해주세요.
    `;

    const response = await this.aiClient.generateContent(prompt);
    return response.text.trim();
  }
}
```

### 4. Knowledge Graph
**Implementation**:
```typescript
interface KnowledgeGraphService {
  // Build relationships between content
  analyzeRelationships(contentIds: string[]): Promise<Relationship[]>;

  // Find semantic similarity
  findSimilar(contentId: string, topK: number): Promise<ContentItem[]>;
}

class AIKnowledgeGraphService implements KnowledgeGraphService {
  private embeddingModel = 'text-embedding-004';  // Google or OpenAI

  async analyzeRelationships(contentIds: string[]): Promise<Relationship[]> {
    // 1. Generate embeddings for all content
    const embeddings = await this.generateEmbeddings(contentIds);

    // 2. Calculate cosine similarity
    const relationships: Relationship[] = [];
    for (let i = 0; i < contentIds.length; i++) {
      for (let j = i + 1; j < contentIds.length; j++) {
        const similarity = this.cosineSimilarity(
          embeddings[i],
          embeddings[j]
        );

        if (similarity > 0.7) {  // Threshold
          relationships.push({
            sourceId: contentIds[i],
            targetId: contentIds[j],
            type: 'similar',
            weight: similarity
          });
        }
      }
    }

    return relationships;
  }

  async findSimilar(contentId: string, topK: number): Promise<ContentItem[]> {
    const targetEmbedding = await this.getEmbedding(contentId);
    const allContent = await this.getAllContent();

    const similarities = await Promise.all(
      allContent.map(async (item) => ({
        item,
        similarity: this.cosineSimilarity(
          targetEmbedding,
          await this.getEmbedding(item.id)
        )
      }))
    );

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .map(s => s.item);
  }
}
```

## Database Models (Phase 2)

```prisma
model VideoCaption {
  id        String   @id @default(uuid())
  videoId   String
  language  String
  text      String   // Full transcript
  segments  String   // JSON: [{ text, start, duration }]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  video     Video    @relation(fields: [videoId], references: [id])

  @@unique([videoId, language])
  @@map("video_captions")
}

model VideoNote {
  id        String   @id @default(uuid())
  videoId   String
  timestamp Int      // seconds
  content   String   // Markdown
  tags      String?  // JSON array
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  video     Video    @relation(fields: [videoId], references: [id])

  @@map("video_notes")
}

model Summary {
  id          String   @id @default(uuid())
  contentId   String
  level       String   // 'short' | 'medium' | 'detailed'
  summary     String
  keyPoints   String?  // JSON array
  generatedAt DateTime @default(now())

  @@map("summaries")
}
```

## API Endpoints (Phase 2)

```typescript
// Summarization
POST /api/v1/content/:id/summarize
Body: { level: 'short' | 'medium' | 'detailed' }

// Captions
GET /api/v1/videos/:id/captions?language=ko
POST /api/v1/videos/:id/captions/extract

// Tags
POST /api/v1/content/:id/tags/auto-generate
GET /api/v1/content/:id/related

// Notes
POST /api/v1/videos/:id/notes
GET /api/v1/videos/:id/notes
```

## Cost & Quota Management

```typescript
class AIQuotaManager {
  private dailyLimits = {
    gemini: 1500,    // requests/day
    openai: 3000,    // tokens/day (estimate)
  };

  async checkQuota(service: 'gemini' | 'openai'): Promise<boolean> {
    const usage = await this.getUsageToday(service);
    return usage < this.dailyLimits[service];
  }

  async trackUsage(
    service: 'gemini' | 'openai',
    cost: number
  ): Promise<void> {
    await prisma.aiQuotaUsage.create({
      data: { service, cost, date: new Date() }
    });
  }
}
```

## Testing
- Mock AI API responses
- Use test fixtures for captions
- Validate summary quality manually
- Test quota tracking

## Reference Files
- PRD.md - Phase 2 requirements
- src/modules/caption/ - Caption extraction
- src/modules/summarization/ - AI summarization
- src/modules/knowledge/ - Knowledge graph
