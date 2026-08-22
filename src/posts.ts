import { getCollection } from "astro:content";

const postFiles = import.meta.glob("./content/blog/**/*.{md,mdx}");

export async function getPublishedPosts() {
  if (Object.keys(postFiles).length === 0) {
    return [];
  }

  const now = Date.now();
  const posts = await getCollection(
    "blog",
    ({ data }) => !data.draft && data.pubDate.valueOf() <= now,
  );

  return posts.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
}
