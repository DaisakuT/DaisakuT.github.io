import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    // 以下は自動生成スクリプトが入れます（手書き記事では省略可）
    sourceCount: z.number().optional(),
    sourceFrom: z.string().optional(),
    sourceTo: z.string().optional(),
    heroImage: z.string().optional(),
  }),
});

export const collections = { blog };
