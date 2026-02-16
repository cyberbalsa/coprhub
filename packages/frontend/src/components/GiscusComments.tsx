"use client";

import Giscus from "@giscus/react";

export function GiscusComments() {
  const repo = process.env.NEXT_PUBLIC_GISCUS_REPO;
  const repoId = process.env.NEXT_PUBLIC_GISCUS_REPO_ID;
  const categoryId = process.env.NEXT_PUBLIC_GISCUS_CATEGORY_ID;

  if (!repo || !repoId || !categoryId) return null;

  return (
    <Giscus
      repo={repo as `${string}/${string}`}
      repoId={repoId}
      category="COPR Comments"
      categoryId={categoryId}
      mapping="og:title"
      strict="1"
      reactionsEnabled="1"
      emitMetadata="1"
      inputPosition="top"
      theme="dark_high_contrast"
      lang="en"
      loading="lazy"
    />
  );
}
