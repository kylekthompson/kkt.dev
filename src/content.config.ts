import { readdirSync } from "node:fs";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blogDirectory = new URL("./content/blog", import.meta.url);
const blogEntriesExist = readdirSync(blogDirectory, {
  encoding: "utf8",
  recursive: true,
}).some((path) => path.endsWith(".md") || path.endsWith(".mdx"));

const blog = defineCollection({
  loader: blogEntriesExist
    ? glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" })
    : () => [],
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: image().optional(),
      draft: z.boolean().default(false),
    }),
});

export const collections = { blog };
