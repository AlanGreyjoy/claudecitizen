import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const config: Config = {
  title: 'ClaudeCitizen',
  tagline: 'Browser-based space sandbox',
  favicon: 'img/claudecitizen-logo-transparent.png',

  future: {
    v4: true,
  },

  url: 'https://claudecitizen-docs.netlify.app',
  baseUrl: '/',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/banner-with-logo.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ClaudeCitizen',
      logo: {
        alt: 'ClaudeCitizen',
        src: 'img/claudecitizen-logo-transparent.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://claudecitizen.netlify.app/',
          label: 'Play',
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
              label: 'Introduction',
              to: '/',
            },
            {
              label: 'Quick start',
              to: '/quick-start',
            },
            {
              label: 'Play',
              to: '/play',
            },
            {
              label: 'Prefab editor',
              to: '/editor',
            },
            {
              label: 'Roadmap',
              to: '/roadmap',
            },
            {
              label: 'Engineering',
              to: '/engineering',
            },
          ],
        },
        {
          title: 'Game',
          items: [
            {
              label: 'Live play test',
              href: 'https://claudecitizen.netlify.app/',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ClaudeCitizen. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
