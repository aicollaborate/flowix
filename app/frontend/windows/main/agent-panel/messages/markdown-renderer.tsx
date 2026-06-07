import { isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { github } from "react-syntax-highlighter/dist/esm/styles/hljs";

interface MarkdownRendererProps {
  content: string;
}

// Agent 消息 Markdown 元素样式: 全部用 arbitrary variant 选择后代元素,
// 主题 token 走 text-primary / border-border 等, 自定义尺寸走 text-[..] 任意值。
const WRAPPER_CLASS =
  "break-words [&>*:first-child]:mt-0 " +
  "[&_h1]:text-base [&_h1]:font-normal [&_h1]:mt-2 " +
  "[&_h2]:text-[0.92rem] [&_h2]:font-normal [&_h2]:mt-2 " +
  "[&_h3]:text-[0.88rem] [&_h3]:font-normal [&_h3]:mt-2 " +
  "[&_h4]:text-[0.82rem] [&_h4]:font-normal [&_h4]:mt-1.5 " +
  "[&_p]:text-[0.82rem] [&_p]:font-normal [&_p]:leading-[1.8] [&_p]:mt-1.5 [&_p:last-child]:mb-0 " +
  "[&_ul]:list-disc [&_ul]:list-inside [&_ul]:mt-2 [&_ul]:text-[0.82rem] [&_ul]:leading-[1.8] " +
  "[&_ol]:list-decimal [&_ol]:list-inside [&_ol]:mt-2 [&_ol]:text-[0.82rem] [&_ol]:leading-[1.8] " +
  "[&_strong]:font-medium " +
  "[&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline " +
  "[&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:mb-2 " +
  "[&_hr]:border-0 [&_hr]:my-4 [&_hr]:border-t [&_hr]:border-t-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] " +
  // 内联 code: 背景 / 边框 / 圆角; pre 内的 code 由 [&_pre_code] 反向覆盖回透明。
  "[&_code]:bg-[var(--code-bg)] [&_code]:px-1.5 [&_code]:rounded-md [&_code]:border [&_code]:border-border [&_code]:text-[0.78rem] [&_code]:text-foreground [&_code]:font-sans " +
  "[&_pre_code]:bg-transparent [&_pre_code]:text-[0.82rem] [&_pre_code]:text-muted-foreground [&_pre_code]:font-sans " +
  "[&_pre]:m-0 [&_pre]:text-[0.86rem] [&_pre]:leading-relaxed [&_pre]:overflow-x-auto [&_pre]:font-sans " +
  "[&_table]:min-w-full [&_table]:border-collapse " +
  "[&_thead]:bg-transparent " +
  "[&_tr]:border-b [&_tr]:border-border [&_tr:last-child]:border-b-0 " +
  "[&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-normal [&_th]:text-foreground " +
  "[&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_td]:text-foreground";

const CODE_BLOCK_CLASS = "relative my-3 rounded-lg overflow-hidden";
const TABLE_WRAPPER_CLASS = "overflow-x-auto my-3 border border-border rounded-lg bg-transparent";

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className={WRAPPER_CLASS}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            // react-markdown v10 仍会为围栏代码块包一层默认 <pre>。
            // 我们在下面的 `code` 覆盖里已经返回了 <div class="code-block">，
            // 把它再套进 <pre> 会形成两套盒模型叠加（外层 <pre> 的
            // font-size / line-height / overflow-x: auto 与 SyntaxHighlighter
            // 的 customStyle 重复），导致代码块视觉上出现「重影 / 双边框」。
            // 因此当 <pre> 的子节点是 code-block 容器时，直接透传 children。
            const child = Array.isArray(children) ? children[0] : children;
            if (
              isValidElement(child) &&
              child.type === "div" &&
              (child.props as { className?: string })?.className === CODE_BLOCK_CLASS
            ) {
              return <>{child}</>;
            }
            return <pre>{children}</pre>;
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match;
            const language = match ? match[1] : "";

            if (isInline) {
              return <code {...props}>{children}</code>;
            }

            return (
              <div className={CODE_BLOCK_CLASS}>
                <SyntaxHighlighter
                  style={github}
                  language={language || "text"}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    padding: "0.5rem",
                    background: "var(--code-bg)",
                    borderRadius: "0.5rem",
                    border: "1px solid var(--border)",
                    fontSize: "0.86rem",
                    lineHeight: "1.6",
                    fontWeight: 400,
                    fontFamily: "var(--font-sans)",
                  }}
                  showLineNumbers={false}
                  lineNumberStyle={{
                    color: "var(--muted-foreground)",
                    paddingRight: "0.75rem",
                    minWidth: "2em",
                    userSelect: "none",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              </div>
            );
          },
          table({ children }) {
            return (
              <div className={TABLE_WRAPPER_CLASS}>
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
