import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@/lib/utils";

// Model output is untrusted: raw HTML is skipped, then the tree is sanitized against
// a narrow allowlist. No images (tracking pixels), only http(s)/mailto links.
const schema = {
  ...defaultSchema,
  tagNames: [
    "p",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "a",
    "blockquote",
    "br",
    "h3",
    "h4",
  ],
  attributes: { a: ["href", "title"], code: [] },
  protocols: { href: ["http", "https", "mailto"] },
};

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-accent underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.9em]">{children}</code>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  p: ({ children }) => <p className="my-0 [&+p]:mt-2.5">{children}</p>,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-[15px] leading-[1.6] text-foreground", className)}>
      <ReactMarkdown skipHtml rehypePlugins={[[rehypeSanitize, schema]]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
