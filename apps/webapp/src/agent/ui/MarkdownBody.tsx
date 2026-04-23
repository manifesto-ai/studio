/**
 * MarkdownBody — renders assistant chat content as markdown (GFM).
 *
 * Styling choices:
 *   - Inherit color from the containing bubble (`text-inherit`) so user
 *     bubbles stay void-on-violet and assistant bubbles stay ink-on-glass.
 *   - `inline-code` gets a subtle chip background; fenced code gets its
 *     own dark slab with horizontal scroll.
 *   - Lists use tight spacing; headings are trimmed one size so they
 *     don't dominate a chat bubble.
 *   - Links open in a new tab with `rel="noreferrer noopener"`.
 *
 * Why react-markdown: lightweight, tree-walks safely (no `dangerouslySetInnerHTML`
 * on arbitrary HTML), trivial to override per-tag. remark-gfm adds tables,
 * strikethrough, task lists, autolinks — common in agent output.
 *
 * Safety: the renderer never eval's HTML strings. GFM-allowed HTML is
 * escaped by default. Raw html would require `rehype-raw`, which we do
 * NOT add — the chat context doesn't justify the XSS surface.
 */
import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  // Assistant turns occasionally emit headings ("## 현재 상태" etc.);
  // clamp them so they don't overpower the bubble layout.
  h1: ({ children }) => (
    <h3 className="text-[14px] font-sans font-semibold mt-2 mb-1 first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4 className="text-[13px] font-sans font-semibold mt-2 mb-1 first:mt-0">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="text-[12.5px] font-sans font-semibold mt-1.5 mb-0.5 first:mt-0">
      {children}
    </h5>
  ),
  h4: ({ children }) => (
    <h6 className="text-[12px] font-sans font-semibold mt-1.5 mb-0.5 first:mt-0">
      {children}
    </h6>
  ),

  p: ({ children }) => (
    <p className="my-1 first:mt-0 last:mb-0 leading-relaxed">{children}</p>
  ),

  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-1 space-y-0.5 marker:text-[var(--color-ink-mute)]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-1 space-y-0.5 marker:text-[var(--color-ink-mute)]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => (
    <del className="opacity-70 line-through">{children}</del>
  ),

  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline decoration-[var(--color-ink-mute)] underline-offset-2 hover:decoration-[var(--color-ink)]"
    >
      {children}
    </a>
  ),

  // Inline vs. fenced code — react-markdown passes `inline: true` for
  // inline code and omits it for block code in a fenced context.
  code: ({ className, children, ...rest }) => {
    const text = String(children ?? "");
    const isBlock = /\n/.test(text) || /language-/.test(className ?? "");
    if (!isBlock) {
      return (
        <code
          className="
            px-1 py-[1px] rounded
            text-[0.92em] font-mono
            bg-[color-mix(in_oklch,var(--color-void)_45%,transparent)]
            border border-[var(--color-rule)]
            whitespace-pre-wrap break-words
          "
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code className="font-mono text-[12px] leading-snug" {...rest}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre
      className="
        my-1.5 p-2 rounded-md
        bg-[color-mix(in_oklch,var(--color-void)_55%,transparent)]
        border border-[var(--color-rule)]
        overflow-x-auto
        text-[12px] leading-snug
      "
    >
      {children}
    </pre>
  ),

  blockquote: ({ children }) => (
    <blockquote
      className="
        my-1.5 pl-2 border-l-2
        border-[var(--color-rule)]
        text-[var(--color-ink-dim)]
      "
    >
      {children}
    </blockquote>
  ),

  hr: () => <hr className="my-2 border-[var(--color-rule)]" />,

  // Tables (gfm). Rarely used in chat but supported for completeness.
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="text-[11.5px] border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="px-1.5 py-0.5 border border-[var(--color-rule)] font-semibold text-left">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-1.5 py-0.5 border border-[var(--color-rule)]">
      {children}
    </td>
  ),
};

export const MarkdownBody = memo(function MarkdownBody({
  children,
  className,
}: {
  readonly children: string;
  readonly className?: string;
}): ReactNode {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
