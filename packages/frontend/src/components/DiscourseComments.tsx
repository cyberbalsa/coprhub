"use client";

import DOMPurify from "isomorphic-dompurify";
import type { CommentData } from "@/lib/api-client";

interface DiscourseCommentsProps {
  owner: string;
  name: string;
  comments: CommentData[];
  topicUrl: string | null;
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "a", "ul", "ol", "li",
      "blockquote", "code", "pre", "h1", "h2", "h3", "h4",
      "img", "div", "span",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "rel", "target"],
  });
}

export function DiscourseComments({ owner, name, comments, topicUrl }: DiscourseCommentsProps) {
  if (comments.length === 0) {
    const coprUrl = `https://copr.fedorainfracloud.org/coprs/${owner}/${name}/`;
    return (
      <p className="comments-empty">
        No discussion yet.{" "}
        <a href={coprUrl} target="_blank" rel="noopener">
          Visit the COPR page
        </a>{" "}
        to start one.
      </p>
    );
  }

  return (
    <div className="discourse-comments">
      {topicUrl && (
        <a
          href={topicUrl}
          target="_blank"
          rel="noopener"
          className="discourse-link"
        >
          View full discussion on Fedora Discussion &rarr;
        </a>
      )}
      <div className="comments-list">
        {comments.map((comment) => (
          <div key={comment.id} className="comment">
            <div className="comment-header">
              {comment.avatarUrl && (
                <img
                  src={comment.avatarUrl}
                  alt={comment.username}
                  className="comment-avatar"
                  width={32}
                  height={32}
                />
              )}
              <strong className="comment-author">{comment.username}</strong>
              <time className="comment-date" dateTime={comment.createdAt}>
                {new Date(comment.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
              {comment.likeCount > 0 && (
                <span className="comment-likes">
                  &#9829; {comment.likeCount}
                </span>
              )}
            </div>
            <div
              className="comment-body"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(comment.content) }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
