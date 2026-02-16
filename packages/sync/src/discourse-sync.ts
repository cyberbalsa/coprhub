import { USER_AGENT } from "./user-agent.js";

const DISCOURSE_BASE = "https://discussion.fedoraproject.org";

export interface DiscourseTopicInfo {
  topicId: number;
  slug: string;
  likes: number;
  views: number;
  replies: number;
}

export interface DiscourseStats {
  likes: number;
  views: number;
  replies: number;
}

export async function fetchDiscourseTopicByEmbedUrl(
  owner: string,
  name: string,
): Promise<DiscourseTopicInfo | null> {
  const embedUrl = `copr.fedorainfracloud.org/coprs/${owner}/${name}`;
  const url = `${DISCOURSE_BASE}/search.json?q=${encodeURIComponent(embedUrl)}`;

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) return null;

  const data = await res.json();
  const topics = data.topics;

  if (!topics || topics.length === 0) return null;

  const topic = topics[0];
  return {
    topicId: topic.id,
    slug: topic.slug,
    likes: topic.like_count,
    views: topic.views,
    replies: topic.reply_count,
  };
}

export async function fetchDiscourseTopicStats(
  topicId: number,
): Promise<DiscourseStats | null> {
  const url = `${DISCOURSE_BASE}/t/${topicId}.json`;

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) return null;

  const data = await res.json();
  return {
    likes: data.like_count,
    views: data.views,
    replies: data.reply_count,
  };
}
