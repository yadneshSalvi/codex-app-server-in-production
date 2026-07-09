import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// The agent narrates in markdown: headings, inline-code filenames, and
// (with remark-gfm) the occasional table. Each element gets app styling
// here, so answers look native instead of pasted-in.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="text-[15px] font-semibold">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          a: ({ children, href }) => (
            <a href={href} className="text-accent underline underline-offset-2">
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-stone-200/70 px-1 py-0.5 font-mono text-[13px] dark:bg-stone-800">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-stone-100 p-3 text-[13px] dark:bg-stone-800/80 [&_code]:bg-transparent [&_code]:p-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b-2 border-stone-300 px-2.5 py-1.5 text-left font-semibold dark:border-stone-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-stone-200 px-2.5 py-1.5 tabular-nums dark:border-stone-800">
              {children}
            </td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
