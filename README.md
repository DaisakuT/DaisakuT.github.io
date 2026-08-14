# 自動更新ブログ

- 記事は `src/content/blog/*.md`
- 狙うキーワードは `keywords.txt`
- SNSのエクスポートは `data/raw/` に置く（JSONのみ）
- サイト名・運営者名は `src/site.ts`

## 動かし方
GitHubの Actions タブから「記事の自動生成」→ Run workflow。
できた記事はプルリクエストで届くので、確認して Merge すると公開されます。

詳しい手順は 手順書.md を参照。
