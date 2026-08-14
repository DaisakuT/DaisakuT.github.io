import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SITE_URL は GitHub Actions 側から自動で渡されます。
// 独自ドメインを買ったら deploy.yml の SITE_URL を書き換えるだけでOKです。
export default defineConfig({
  site: process.env.SITE_URL || 'https://example.github.io',
  integrations: [sitemap()],
});
