// ads.txt を自動生成します。site.ts に adsenseClient を入れると内容が入ります。
// 未設定のうちは空のファイルが出力されます（あっても害はありません）。
import { SITE } from '../site.ts';

export async function GET() {
  const id = (SITE.adsenseClient || '').replace(/^ca-/, '');
  const body = id ? `google.com, ${id}, DIRECT, f08c47fec0942fa0\n` : '';
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
