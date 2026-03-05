# Docusaurus 프로젝트 설정 가이드

**프로젝트**: Insighta API 문서 사이트
**Docusaurus 버전**: 3.6.0+
**마지막 업데이트**: 2025-12-16

---

## 📋 목차

1. [Docusaurus 소개](#docusaurus-소개)
2. [프로젝트 생성](#프로젝트-생성)
3. [디렉토리 구조](#디렉토리-구조)
4. [설정 파일](#설정-파일)
5. [플러그인 설정](#플러그인-설정)
6. [콘텐츠 구조](#콘텐츠-구조)
7. [커스터마이징](#커스터마이징)
8. [배포](#배포)

---

## Docusaurus 소개

### 선택 이유

- **React 기반**: 컴포넌트 재사용 가능
- **TypeScript 지원**: 타입 안전성
- **MDX**: Markdown + React 컴포넌트
- **다국어 지원**: i18n 내장
- **검색 기능**: Algolia DocSearch 통합
- **버전 관리**: API 버전별 문서 관리
- **OpenAPI 플러그인**: API 레퍼런스 자동 생성

### 주요 기능

- **가이드 및 튜토리얼**: 시작 가이드, 인증 설정, 사용 예제
- **API 레퍼런스**: OpenAPI 기반 인터랙티브 문서
- **블로그**: 업데이트, 릴리스 노트
- **커뮤니티**: FAQ, 트러블슈팅

---

## 프로젝트 생성

### 1. Docusaurus 프로젝트 초기화

```bash
# 프로젝트 루트에서 실행
npx create-docusaurus@latest docs-site classic --typescript

# 또는 docs/ 디렉토리 내에 생성
cd docs
npx create-docusaurus@latest site classic --typescript
```

**옵션 설명**:
- `docs-site`: 프로젝트 디렉토리 이름
- `classic`: 클래식 템플릿 (권장)
- `--typescript`: TypeScript 사용

### 2. 생성된 파일 확인

```bash
cd docs-site
ls -la
```

**생성된 파일**:
```
docs-site/
├── blog/                 # 블로그 글
├── docs/                 # 문서 마크다운 파일
├── src/
│   ├── components/       # React 컴포넌트
│   ├── css/             # 스타일
│   └── pages/           # 커스텀 페이지
├── static/              # 정적 파일 (이미지, OpenAPI 명세 등)
├── docusaurus.config.ts # Docusaurus 설정
├── package.json
├── sidebars.ts          # 사이드바 설정
└── tsconfig.json
```

### 3. 의존성 설치

```bash
cd docs-site
npm install

# OpenAPI 플러그인 설치
npm install docusaurus-plugin-openapi-docs docusaurus-theme-openapi-docs
```

---

## 디렉토리 구조

### 권장 구조

```
docs-site/
├── blog/
│   ├── 2025-12-16-api-launch.md
│   └── authors.yml
│
├── docs/
│   ├── intro.md                      # 소개 페이지
│   ├── getting-started/
│   │   ├── installation.md           # 설치 가이드
│   │   ├── quick-start.md            # 빠른 시작
│   │   └── authentication.md         # 인증 설정
│   │
│   ├── guides/
│   │   ├── importing-playlists.md    # 플레이리스트 임포트
│   │   ├── video-summarization.md    # 비디오 요약
│   │   ├── note-taking.md            # 노트 작성
│   │   └── analytics.md              # 분석 기능
│   │
│   ├── api/
│   │   ├── overview.md               # API 개요
│   │   ├── authentication.md         # API 인증
│   │   ├── rate-limiting.md          # Rate Limiting
│   │   ├── errors.md                 # 에러 처리
│   │   └── reference/                # API 레퍼런스 (자동 생성)
│   │
│   ├── examples/
│   │   ├── javascript.md             # JavaScript 예제
│   │   ├── python.md                 # Python 예제
│   │   ├── curl.md                   # cURL 예제
│   │   └── postman.md                # Postman 컬렉션
│   │
│   └── troubleshooting/
│       ├── faq.md                    # 자주 묻는 질문
│       ├── common-errors.md          # 일반적인 에러
│       └── debugging.md              # 디버깅 가이드
│
├── src/
│   ├── components/
│   │   ├── HomepageFeatures/        # 홈페이지 기능 소개
│   │   └── ApiPlayground/           # API 테스트 플레이그라운드
│   │
│   ├── pages/
│   │   ├── index.tsx                # 홈페이지
│   │   └── api-reference.tsx        # Scalar API 레퍼런스 (커스텀)
│   │
│   └── css/
│       └── custom.css               # 커스텀 스타일
│
├── static/
│   ├── img/                         # 이미지
│   ├── openapi.yaml                 # OpenAPI 명세 (자동 복사)
│   └── postman-collection.json      # Postman 컬렉션
│
├── docusaurus.config.ts             # Docusaurus 설정
├── sidebars.ts                      # 사이드바 설정
└── package.json
```

---

## 설정 파일

### `docusaurus.config.ts`

```typescript
import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Insighta API',
  tagline: 'YouTube 플레이리스트 동기화 및 학습 관리 API',
  favicon: 'img/favicon.ico',

  url: 'https://docs.yourdomain.com',
  baseUrl: '/',

  organizationName: 'your-org',
  projectName: 'youtube-playlist-sync',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'ko',
    locales: ['ko', 'en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/your-org/youtube-playlist-sync/tree/main/docs-site/',
          docItemComponent: '@theme/ApiItem',
        },
        blog: {
          showReadingTime: true,
          editUrl: 'https://github.com/your-org/youtube-playlist-sync/tree/main/docs-site/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      'docusaurus-plugin-openapi-docs',
      {
        id: 'api',
        docsPluginId: 'classic',
        config: {
          api: {
            specPath: 'static/openapi.yaml',
            outputDir: 'docs/api/reference',
            sidebarOptions: {
              groupPathsBy: 'tag',
              categoryLinkSource: 'tag',
            },
          },
        },
      },
    ],
  ],

  themes: ['docusaurus-theme-openapi-docs'],

  themeConfig: {
    image: 'img/social-card.png',
    navbar: {
      title: 'Insighta API',
      logo: {
        alt: 'Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/api/overview',
          label: 'API',
          position: 'left',
        },
        {
          to: '/blog',
          label: 'Blog',
          position: 'left',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
        {
          href: 'https://github.com/your-org/youtube-playlist-sync',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/intro',
            },
            {
              label: 'API Reference',
              to: '/docs/api/reference',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/your-org/youtube-playlist-sync',
            },
            {
              label: 'Discord',
              href: 'https://discord.gg/your-invite',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'FAQ',
              to: '/docs/troubleshooting/faq',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Your Organization. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'typescript', 'javascript', 'json', 'yaml'],
    },
    algolia: {
      appId: 'YOUR_APP_ID',
      apiKey: 'YOUR_API_KEY',
      indexName: 'youtube-playlist-sync',
      contextualSearch: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
```

### `sidebars.ts`

```typescript
import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/authentication',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/importing-playlists',
        'guides/video-summarization',
        'guides/note-taking',
        'guides/analytics',
      ],
    },
    {
      type: 'category',
      label: 'API',
      items: [
        'api/overview',
        'api/authentication',
        'api/rate-limiting',
        'api/errors',
        {
          type: 'category',
          label: 'Reference',
          link: {
            type: 'generated-index',
            title: 'API Reference',
            description: 'Complete API reference generated from OpenAPI specification.',
          },
          items: require('./docs/api/reference/sidebar.js'),
        },
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      items: [
        'examples/javascript',
        'examples/python',
        'examples/curl',
        'examples/postman',
      ],
    },
    {
      type: 'category',
      label: 'Troubleshooting',
      items: [
        'troubleshooting/faq',
        'troubleshooting/common-errors',
        'troubleshooting/debugging',
      ],
    },
  ],
};

export default sidebars;
```

---

## 플러그인 설정

### OpenAPI Docs 플러그인

**설치**:
```bash
npm install docusaurus-plugin-openapi-docs docusaurus-theme-openapi-docs
```

**설정** (`docusaurus.config.ts`에 이미 포함):
```typescript
plugins: [
  [
    'docusaurus-plugin-openapi-docs',
    {
      id: 'api',
      docsPluginId: 'classic',
      config: {
        api: {
          specPath: 'static/openapi.yaml',
          outputDir: 'docs/api/reference',
          sidebarOptions: {
            groupPathsBy: 'tag',
            categoryLinkSource: 'tag',
          },
        },
      },
    },
  ],
],
themes: ['docusaurus-theme-openapi-docs'],
```

**API 문서 생성**:
```bash
npm run docusaurus gen-api-docs all
```

### Scalar 통합 (선택사항)

**Scalar React 컴포넌트 사용**:

```bash
npm install @scalar/api-reference-react
```

**커스텀 페이지** (`src/pages/api-reference.tsx`):
```typescript
import React from 'react';
import Layout from '@theme/Layout';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/dist/style.css';

export default function ApiReference() {
  return (
    <Layout title="API Reference" description="Interactive API Reference">
      <ApiReferenceReact
        configuration={{
          spec: {
            url: '/openapi.yaml',
          },
          theme: 'purple',
          layout: 'modern',
          defaultHttpClient: {
            targetKey: 'javascript',
            clientKey: 'fetch',
          },
        }}
      />
    </Layout>
  );
}
```

---

## 콘텐츠 구조

### 홈페이지 (`src/pages/index.tsx`)

```typescript
import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro"
          >
            시작하기 →
          </Link>
          <Link
            className="button button--outline button--lg margin-left--md"
            to="/docs/api/reference"
          >
            API 레퍼런스
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title}`}
      description="YouTube 플레이리스트 동기화 및 학습 관리 API"
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
```

### 기능 소개 컴포넌트 (`src/components/HomepageFeatures/index.tsx`)

```typescript
import React from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: JSX.Element;
  emoji: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'YouTube 플레이리스트 동기화',
    emoji: '🔄',
    description: (
      <>
        YouTube 플레이리스트를 자동으로 동기화하고
        비디오 메타데이터를 로컬 데이터베이스에 저장합니다.
      </>
    ),
  },
  {
    title: 'AI 기반 비디오 요약',
    emoji: '🤖',
    description: (
      <>
        Gemini AI를 활용한 자동 비디오 요약 기능으로
        학습 시간을 단축하세요.
      </>
    ),
  },
  {
    title: '학습 분석 대시보드',
    emoji: '📊',
    description: (
      <>
        진도 추적, 복습 추천, 학습 통계를 통해
        효율적인 학습을 지원합니다.
      </>
    ),
  },
];

function Feature({ title, emoji, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <span style={{ fontSize: '4rem' }}>{emoji}</span>
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
```

---

## 커스터마이징

### 테마 색상 (`src/css/custom.css`)

```css
:root {
  --ifm-color-primary: #7c3aed;
  --ifm-color-primary-dark: #6d28d9;
  --ifm-color-primary-darker: #5b21b6;
  --ifm-color-primary-darkest: #4c1d95;
  --ifm-color-primary-light: #8b5cf6;
  --ifm-color-primary-lighter: #a78bfa;
  --ifm-color-primary-lightest: #c4b5fd;
  --ifm-code-font-size: 95%;
  --docusaurus-highlighted-code-line-bg: rgba(0, 0, 0, 0.1);
}

[data-theme='dark'] {
  --ifm-color-primary: #a78bfa;
  --ifm-color-primary-dark: #8b5cf6;
  --ifm-color-primary-darker: #7c3aed;
  --ifm-color-primary-darkest: #6d28d9;
  --ifm-color-primary-light: #c4b5fd;
  --ifm-color-primary-lighter: #ddd6fe;
  --ifm-color-primary-lightest: #ede9fe;
  --docusaurus-highlighted-code-line-bg: rgba(0, 0, 0, 0.3);
}
```

---

## 배포

### 정적 사이트 빌드

```bash
npm run build
```

### GitHub Pages 배포

```bash
GIT_USER=<your-github-username> npm run deploy
```

### Vercel 배포

1. Vercel에 GitHub 레포지토리 연결
2. Build Command: `cd docs-site && npm run build`
3. Output Directory: `docs-site/build`
4. 자동 배포 완료

### Netlify 배포

**netlify.toml**:
```toml
[build]
  base = "docs-site"
  command = "npm run build"
  publish = "build"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## 다음 단계

### 1. 프로젝트 생성 및 초기 설정

```bash
npx create-docusaurus@latest docs-site classic --typescript
cd docs-site
npm install docusaurus-plugin-openapi-docs docusaurus-theme-openapi-docs
```

### 2. OpenAPI 명세 복사

```bash
cp ../openapi/openapi.yaml static/openapi.yaml
```

### 3. API 문서 생성

```bash
npm run docusaurus gen-api-docs all
```

### 4. 개발 서버 실행

```bash
npm start
```

### 5. 문서 작성

- `docs/intro.md` - 소개 페이지
- `docs/getting-started/` - 시작 가이드
- `docs/guides/` - 사용 가이드
- `docs/examples/` - 코드 예제

---

**문서 버전**: 1.0
**작성자**: James Kim (jamesjk4242@gmail.com)
**작성일**: 2025-12-16
