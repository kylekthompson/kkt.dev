# kkt.dev

The source for [kkt.dev](https://kkt.dev), Kyle Thompson's personal website and
blog.

The site is statically generated with [Astro](https://astro.build), styled with
[Tailwind CSS](https://tailwindcss.com), and served from Cloudflare assets.

## Development

The required Node.js and pnpm versions are pinned in `mise.toml`.

```sh
mise install
pnpm install --frozen-lockfile
pnpm dev
```

## Commands

| Command             | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | Start the Astro development server            |
| `pnpm check`        | Type-check Astro, TypeScript, and frontmatter |
| `pnpm format`       | Format supported project files                |
| `pnpm format:check` | Verify formatting without changing files      |
| `pnpm build`        | Generate the production site in `dist/`       |
| `pnpm preview`      | Serve the production build locally            |

## Writing

Blog entries live in `src/content/blog` as Markdown or MDX. Copy
`draft-template.md` to a descriptive filename, replace its frontmatter and
content, and set `draft` to `false` when it is ready to publish.

Drafts and entries with a future publication date are excluded from pages,
routes, RSS, and the sitemap. Published entries are shown newest first. A hero
image can be referenced with the optional `heroImage` frontmatter field.

## Project structure

- `src/components` contains shared page elements and metadata.
- `src/layouts` owns the site shell and blog post presentation.
- `src/pages` defines static routes and the RSS endpoint.
- `src/posts.ts` defines which blog entries are published.
- `src/styles/global.css` contains the Tailwind theme and article styles.
- `public` contains assets served without processing.

Cloudflare deployment reads the generated `dist` directory from
`wrangler.jsonc`.

## Credit

The original Astro starter theme is based on
[Bear Blog](https://github.com/HermanMartinus/bearblog/).
