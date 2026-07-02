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
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// Stricter than the default schema: drop <img> (and any src/srcset) so LLM output
// cannot embed a remote image beacon that exfiltrates data (e.g. the org id) via a
// prompt-injection payload flowing in from tenant/Airtable content.
const NARRATIVE_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => t !== 'img'),
  attributes: { ...defaultSchema.attributes, '*': (defaultSchema.attributes?.['*'] ?? []) },
};

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
      {/* LLM02: rehype-sanitize strips <script>, <iframe>, <img>, on* attributes, etc. */}
      <ReactMarkdown rehypePlugins={[[rehypeSanitize, NARRATIVE_SANITIZE_SCHEMA]]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
