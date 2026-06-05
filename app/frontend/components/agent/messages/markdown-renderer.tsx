import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !match;
          const language = match ? match[1] : "";

          if (isInline) {
            return <code {...props}>{children}</code>;
          }

          return (
            <div className="code-block">
              {language && <div className="lang-tag">{language}</div>}
              <SyntaxHighlighter
                style={oneDark}
                language={language || "text"}
                PreTag="div"
                customStyle={{
                  margin: 0,
                  padding: "0.5rem",
                  paddingTop: "1rem",
                  background: "var(--agent-bg-code)",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--agent-border)",
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
        p({ children }) {
          return <p>{children}</p>;
        },
        ul({ children }) {
          return <ul>{children}</ul>;
        },
        ol({ children }) {
          return <ol>{children}</ol>;
        },
        li({ children }) {
          return <li>{children}</li>;
        },
        h1({ children }) {
          return <h1>{children}</h1>;
        },
        h2({ children }) {
          return <h2>{children}</h2>;
        },
        h3({ children }) {
          return <h3>{children}</h3>;
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
        blockquote({ children }) {
          return <blockquote>{children}</blockquote>;
        },
        hr() {
          return <hr />;
        },
        table({ children }) {
          return (
            <div className="table-wrapper">
              <table>{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return <thead>{children}</thead>;
        },
        tbody({ children }) {
          return <tbody>{children}</tbody>;
        },
        tr({ children }) {
          return <tr>{children}</tr>;
        },
        th({ children }) {
          return <th>{children}</th>;
        },
        td({ children }) {
          return <td>{children}</td>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
