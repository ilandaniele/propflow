'use client';

/**
 * Narrative — renders the executive brief markdown from /api/ai/executive-brief.
 *
 * Security:
 * - Uses react-markdown + rehype-sanitize with defaultSchema (strict allowlist).
 * - NO dangerouslySetInnerHTML — LLM output is never inserted as raw HTML (LLM02).
 * - react-markdown parses Markdown → React element tree; rehype-sanitize runs as
 *   a rehype plugin to strip any HTML tags that Markdown could produce (e.g. from
 *   raw-HTML blocks in the LLM response).
 */

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

interface NarrativeProps {
  /** Markdown string returned by /api/ai/executive-brief — never raw HTML */
  markdown: string;
  className?: string;
}

/**
 * Narrative renders LLM-generated Markdown safely.
 *
 * The pipeline is:
 *   Markdown text → react-markdown (parse) → rehype-sanitize (strip unsafe HTML) → React nodes
 *
 * This means even if the LLM injects raw `<script>` or `<iframe>` blocks, the
 * rehype-sanitize step removes them before React mounts the tree.
 *
 * Never use dangerouslySetInnerHTML here — that would bypass rehype-sanitize entirely.
 */
export function Narrative({ markdown, className }: NarrativeProps) {
  return (
    <div className={className}>
      {/* LLM02: rehype-sanitize strips <script>, <iframe>, on* attributes, etc. */}
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
