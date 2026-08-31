// robots.txt を自動生成します。サイトマップの場所をクローラーに伝えます。
// URLは astro.config.mjs の site（＝deploy.yml の SITE_URL）から自動で入ります。
export async function GET({ site }) {
  const body = `User-agent: *
Allow: /

Sitemap: ${new URL('sitemap-index.xml', site).href}
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
