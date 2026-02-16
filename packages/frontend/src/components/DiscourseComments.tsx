"use client";

import { useEffect, useRef } from "react";

interface DiscourseCommentsProps {
  owner: string;
  name: string;
}

export function DiscourseComments({ owner, name }: DiscourseCommentsProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== "https://discussion.fedoraproject.org") return;
      if (event.data?.type === "resize" && iframeRef.current) {
        iframeRef.current.style.height = `${event.data.height}px`;
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const embedUrl = encodeURIComponent(
    `https://copr.fedorainfracloud.org/coprs/${owner}/${name}/`
  );

  return (
    <iframe
      ref={iframeRef}
      src={`https://discussion.fedoraproject.org/embed/comments?embed_url=${embedUrl}`}
      width="100%"
      style={{ border: "none", minHeight: "300px" }}
      scrolling="no"
      referrerPolicy="no-referrer-when-downgrade"
      title="Community Discussion"
    />
  );
}
