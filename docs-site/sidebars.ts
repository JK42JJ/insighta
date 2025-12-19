import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';
import apiSidebar from './docs/api-reference/sidebar';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/quickstart',
        'getting-started/authentication',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/playlist-sync',
        'guides/video-management',
        'guides/learning-analytics',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/overview',
        'architecture/database',
        'architecture/modules',
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      items: [
        'examples/javascript',
        'examples/python',
        'examples/curl',
      ],
    },
  ],
  apiSidebar: apiSidebar,
};

export default sidebars;
