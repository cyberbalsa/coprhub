"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ReadmeDisplayProps {
  content: string;
}

export function ReadmeDisplay({ content }: ReadmeDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 2000;

  return (
    <div className="readme-container">
      <div
        className={`readme-content ${!expanded && isLong ? "readme-collapsed" : ""}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      {isLong && (
        <button
          className="readme-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
