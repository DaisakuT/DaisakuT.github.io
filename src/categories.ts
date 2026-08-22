// カテゴリーの定義。名前を変えたい場合は name を書き換えてください。
// slug はURLになります（変更すると既存のURLが変わるので注意）。
export const CATEGORIES = [
  {
    slug: 'sauna',
    name: 'サウナ',
    description: '整い方、水風呂との付き合い方、県内外で通っている施設のこと。',
  },
  {
    slug: 'food',
    name: '食',
    description: 'もつ鍋、豚肉、和牛。家での火入れの話と、鹿児島で食べているもの。',
  },
  {
    slug: 'travel',
    name: '旅',
    description: '鹿児島の移動と宿、荷物の減らし方、一人で出かけるときのこと。',
  },
];

export const findBySlug = (slug: string) => CATEGORIES.find((c) => c.slug === slug);
export const findByName = (name?: string) => CATEGORIES.find((c) => c.name === name);
