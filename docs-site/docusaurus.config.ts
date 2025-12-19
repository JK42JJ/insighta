import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import type * as OpenApiPlugin from 'docusaurus-plugin-openapi-docs';

const config: Config = {
  title: 'TubeArchive API',
  tagline: 'YouTube Playlist Sync & Learning Platform',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://tubearchive.dev',
  baseUrl: '/',

  organizationName: 'tubearchive',
  projectName: 'sync-youtube-playlists',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ko'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          docItemComponent: '@theme/ApiItem',
        },
        blog: false,
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
          tubearchive: {
            specPath: 'static/openapi.json',
            outputDir: 'docs/api-reference',
            sidebarOptions: {
              groupPathsBy: 'tag',
              categoryLinkSource: 'tag',
            },
          } satisfies OpenApiPlugin.Options,
        },
      },
    ],
  ],

  themes: ['docusaurus-theme-openapi-docs'],

  themeConfig: {
    image: 'img/tubearchive-social-card.jpg',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'TubeArchive',
      logo: {
        alt: 'TubeArchive Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          type: 'docSidebar',
          sidebarId: 'apiSidebar',
          position: 'left',
          label: 'API Reference',
        },
        {
          href: 'https://github.com/tubearchive/sync-youtube-playlists',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/intro',
            },
            {
              label: 'API Reference',
              to: '/docs/api-reference/tubearchive-api',
            },
          ],
        },
        {
          title: 'API Endpoints',
          items: [
            {
              label: 'Authentication',
              to: '/docs/api-reference/authentication',
            },
            {
              label: 'Playlists',
              to: '/docs/api-reference/playlists',
            },
            {
              label: 'Videos',
              to: '/docs/api-reference/videos',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/tubearchive/sync-youtube-playlists',
            },
            {
              label: 'Swagger UI',
              href: '/documentation',
            },
            {
              label: 'Scalar API',
              href: '/api-reference',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} TubeArchive. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'python'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
