import { useEffect, useMemo, useRef } from "react";
import {
  codeBlockPlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
  type MDXEditorMethods
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const markdownContentClassName = cn(
  "min-w-0 break-words text-sm leading-6",
  "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold",
  "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold",
  "[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold",
  "[&_hr]:my-5 [&_hr]:border-border",
  "[&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
);

function PlainTextCodeBlockEditor({
  code,
  language,
  focusEmitter
}: CodeBlockEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const context = useCodeBlockEditorContext();

  useEffect(() => {
    focusEmitter.subscribe(() => textareaRef.current?.focus());
  }, [focusEmitter]);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-muted">
      {language ? (
        <div className="border-b border-border px-3 py-1 font-mono text-xs text-muted-foreground">
          {language}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={code}
        disabled={!context.parentEditor.isEditable()}
        spellCheck={false}
        aria-label={language ? `${language} code block` : "Code block"}
        className="block min-h-24 w-full resize-y bg-transparent p-3 font-mono text-sm leading-6 outline-none"
        onKeyDown={(event) => event.nativeEvent.stopImmediatePropagation()}
        onChange={(event) => context.setCode(event.target.value)}
      />
    </div>
  );
}

const plainTextCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 0,
  match: () => true,
  Editor: PlainTextCodeBlockEditor
};

export function MarkdownContent({
  children,
  className
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        markdownContentClassName,
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          img: ({ node: _node, alt }) => (
            <span className="text-muted-foreground">
              {alt ? `[Image: ${alt}]` : "[Image]"}
            </span>
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function MarkdownEditor({
  id,
  value,
  disabled,
  placeholder,
  minHeightClassName = "min-h-36",
  onChange
}: {
  id: string;
  value: string;
  disabled: boolean;
  placeholder?: string;
  minHeightClassName?: string;
  onChange: (value: string) => void;
}) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const lastPropValue = useRef(value);
  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      codeBlockPlugin({
        defaultCodeBlockLanguage: "",
        codeBlockEditorDescriptors: [plainTextCodeBlockDescriptor]
      }),
      markdownShortcutPlugin()
    ],
    []
  );

  useEffect(() => {
    if (value === lastPropValue.current) return;
    lastPropValue.current = value;
    if (editorRef.current?.getMarkdown() !== value) {
      editorRef.current?.setMarkdown(value);
    }
  }, [value]);

  return (
    <div className="space-y-2">
      <div
        id={id}
        className={cn(
          "overflow-hidden rounded-lg border border-input bg-transparent transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        <MDXEditor
          ref={editorRef}
          markdown={value}
          readOnly={disabled}
          placeholder={placeholder}
          plugins={plugins}
          suppressHtmlProcessing
          className="goal-markdown-editor"
          contentEditableClassName={cn(
            markdownContentClassName,
            "overflow-auto px-3 py-2 outline-none",
            minHeightClassName
          )}
          onChange={(markdown, initialMarkdownNormalize) => {
            if (initialMarkdownNormalize) return;
            lastPropValue.current = markdown;
            onChange(markdown);
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">Markdown is supported.</p>
    </div>
  );
}
