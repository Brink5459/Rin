import Editor from '@monaco-editor/react';
import { editor } from 'monaco-editor';
import React, { useRef, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Loading from 'react-loading';
import { FlatInset, FlatTabButton } from "@rin/ui";
import { useAlert } from "./dialog";
import { useColorMode } from "../utils/darkModeUtils";
import { buildMarkdownImage, uploadImageFile } from "../utils/image-upload";
import { Markdown } from "./markdown";

type ToolbarAction = {
  icon: string;
  label: string;
  prefix: string;
  suffix: string;
  block?: boolean;
  placeholder?: string;
};

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { icon: "ri-bold", label: "Bold", prefix: "**", suffix: "**", placeholder: "bold text" },
  { icon: "ri-italic", label: "Italic", prefix: "*", suffix: "*", placeholder: "italic text" },
  { icon: "ri-strikethrough", label: "Strikethrough", prefix: "~~", suffix: "~~", placeholder: "strikethrough" },
  { icon: "ri-mark-pen-line", label: "Highlight", prefix: "==", suffix: "==", placeholder: "highlighted text" },
  { icon: "ri-separator", label: "Separator", prefix: "\n---\n", suffix: "", block: true },
  { icon: "ri-h-1", label: "Heading 1", prefix: "# ", suffix: "", block: true, placeholder: "Heading 1" },
  { icon: "ri-h-2", label: "Heading 2", prefix: "## ", suffix: "", block: true, placeholder: "Heading 2" },
  { icon: "ri-h-3", label: "Heading 3", prefix: "### ", suffix: "", block: true, placeholder: "Heading 3" },
  { icon: "ri-list-unordered", label: "Unordered List", prefix: "- ", suffix: "", block: true, placeholder: "list item" },
  { icon: "ri-list-ordered", label: "Ordered List", prefix: "1. ", suffix: "", block: true, placeholder: "list item" },
  { icon: "ri-list-check-2", label: "Task List", prefix: "- [ ] ", suffix: "", block: true, placeholder: "task item" },
  { icon: "ri-double-quotes-l", label: "Blockquote", prefix: "> ", suffix: "", block: true, placeholder: "quote" },
  { icon: "ri-code-s-slash-line", label: "Inline Code", prefix: "`", suffix: "`", placeholder: "code" },
  { icon: "ri-code-box-line", label: "Code Block", prefix: "```language\n", suffix: "\n```", block: true, placeholder: "code here" },
  { icon: "ri-link", label: "Link", prefix: "[", suffix: "](url)", placeholder: "link text" },
  { icon: "ri-table-line", label: "Table", prefix: "\n| Header | Header |\n| ------ | ------ |\n| Cell | Cell |\n", suffix: "", block: true },
  { icon: "ri-math-line", label: "Math", prefix: "$", suffix: "$", placeholder: "formula" },
];

function EditorToolbar({ editorRef }: { editorRef: React.MutableRefObject<editor.IStandaloneCodeEditor | undefined> }) {
  const handleAction = useCallback((action: ToolbarAction) => {
    const ed = editorRef.current;
    if (!ed) return;
    const selection = ed.getSelection();
    if (!selection) return;

    const selectedText = ed.getModel()?.getValueInRange(selection) || "";
    const isEmpty = selectedText.length === 0;

    let insertText: string;

    if (action.block && isEmpty) {
      const lineStart = { lineNumber: selection.startLineNumber, column: 1 };
      const lineEnd = { lineNumber: selection.startLineNumber, column: ed.getModel()!.getLineMaxColumn(selection.startLineNumber) };
      const lineContent = ed.getModel()!.getValueInRange({ startLineNumber: lineStart.lineNumber, startColumn: lineStart.column, endLineNumber: lineEnd.lineNumber, endColumn: lineEnd.column });
      const prefix = lineContent.length === 0 ? action.prefix : "\n" + action.prefix;
      insertText = prefix + (action.placeholder || "") + action.suffix;
    } else if (action.block && !isEmpty) {
      const lines = selectedText.split("\n");
      const wrapped = lines.map(line => action.prefix + line + action.suffix).join("\n");
      insertText = "\n" + wrapped + "\n";
    } else if (isEmpty) {
      insertText = action.prefix + (action.placeholder || "") + action.suffix;
    } else {
      insertText = action.prefix + selectedText + action.suffix;
    }

    const op = { identifier: { major: 1, minor: 1 }, range: selection, text: insertText, forceMoveMarkers: true };
    ed.executeEdits("toolbar", [op]);
    ed.focus();
  }, [editorRef]);

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-black/5 px-2 py-1 dark:border-white/5">
      {TOOLBAR_ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          title={action.label}
          onClick={() => handleAction(action)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <i className={`${action.icon} text-base`} />
        </button>
      ))}
    </div>
  );
}

interface MarkdownEditorProps {
  content: string;
  setContent: (content: string) => void;
  placeholder?: string;
  height?: string;
}

export function MarkdownEditor({ content, setContent, placeholder = "> Write your content here...", height = "400px" }: MarkdownEditorProps) {
  const { t } = useTranslation();
  const colorMode = useColorMode();
  const editorRef = useRef<editor.IStandaloneCodeEditor>();
  const isComposingRef = useRef(false);
  const [preview, setPreview] = useState<'edit' | 'preview' | 'comparison'>('edit');
  const [uploading, setUploading] = useState(false);
  const { showAlert, AlertUI } = useAlert();

  async function insertImage(
    file: File,
    range: NonNullable<ReturnType<editor.IStandaloneCodeEditor["getSelection"]>>,
    showAlert: (msg: string) => void,
  ) {
    try {
      const result = await uploadImageFile(file);
      const editorInstance = editorRef.current;
      if (!editorInstance) return;
      editorInstance.executeEdits(undefined, [{
        range,
        text: buildMarkdownImage(file.name, result.url, {
          blurhash: result.blurhash,
          width: result.width,
          height: result.height,
        }),
      }]);
    } catch (error) {
      console.error(error);
      showAlert(error instanceof Error ? error.message : t("upload.failed"));
    }
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const clipboardData = event.clipboardData;
    if (clipboardData.files.length === 1) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.trigger(undefined, "undo", undefined);
      setUploading(true);
      const myfile = clipboardData.files[0] as File;
      const selection = editor.getSelection();
      if (!selection) {
        setUploading(false);
        return;
      }
      void insertImage(myfile, selection, showAlert).finally(() => {
        setUploading(false);
      });
    }
  };

  function UploadImageButton() {
    const uploadRef = useRef<HTMLInputElement>(null);
    
    const upChange = (event: any) => {
      for (let i = 0; i < event.currentTarget.files.length; i++) {
        const file = event.currentTarget.files[i];
        if (file.size > 5 * 1024000) {
          showAlert(t("upload.failed$size", { size: 5 }));
          uploadRef.current!.value = "";
        } else {
          const editor = editorRef.current;
          if (!editor) return;
          const selection = editor.getSelection();
          if (!selection) return;
          setUploading(true);
          void insertImage(file, selection, showAlert).finally(() => {
            setUploading(false);
          });
        }
      }
    };
    
    return (
      <button
        type="button"
        onClick={() => uploadRef.current?.click()}
        className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-w px-3 py-2 text-sm t-primary transition-colors hover:border-black/20 dark:border-white/10 dark:hover:border-white/20"
      >
        <input
          ref={uploadRef}
          onChange={upChange}
          className="hidden"
          type="file"
          accept="image/gif,image/jpeg,image/jpg,image/png"
        />
        <i className="ri-image-add-line" />
        <span>Image</span>
      </button>
    );
  }

  /* ---------------- Monaco Mount & IME Optimization ---------------- */

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;

    editor.onDidCompositionStart(() => {
      isComposingRef.current = true;
    });

    editor.onDidCompositionEnd(() => {
      isComposingRef.current = false;
      setContent(editor.getValue());
    });

    editor.onDidChangeModelContent(() => {
      if (!isComposingRef.current) {
        setContent(editor.getValue());
      }
    });

    editor.onDidBlurEditorText(() => {
      setContent(editor.getValue());
    });
  };

  /* ---------------- synchronization ---------------- */

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    const editorValue = model.getValue();

    // Avoid infinite loops & prevent overwriting content being edited
    if (editorValue !== content) {
      editor.setValue(content);
    }
  }, [content]);

  /* ---------------- UI ---------------- */

  return (
    <div className="flex flex-col gap-0 sm:gap-3">
      <FlatInset className="flex flex-wrap items-center gap-2 border-0 border-b border-black/10 rounded-none bg-transparent p-3 dark:border-white/10">
        <FlatTabButton active={preview === 'edit'} onClick={() => setPreview('edit')}> {t("edit")} </FlatTabButton>
        <FlatTabButton active={preview === 'preview'} onClick={() => setPreview('preview')}> {t("preview")} </FlatTabButton>
        <FlatTabButton active={preview === 'comparison'} onClick={() => setPreview('comparison')}> {t("comparison")} </FlatTabButton>
        <div className="flex-grow" />
        <UploadImageButton />
        {uploading &&
          <div className="flex flex-row items-center space-x-2">
            <Loading type="spin" color="#FC466B" height={16} width={16} />
            <span className="text-sm text-neutral-500">{t('uploading')}</span>
          </div>
        }
      </FlatInset>
      <div className={`grid grid-cols-1 gap-0 sm:gap-4 ${preview === 'comparison' ? "lg:grid-cols-2" : ""}`}>
        <div className={"flex min-w-0 flex-col " + (preview === 'preview' ? "hidden" : "")}>
          {preview !== 'preview' && <EditorToolbar editorRef={editorRef} />}
          <div
            className={"relative min-h-0 overflow-hidden rounded-none border-0 bg-w"}
            onDrop={(e) => {
              e.preventDefault();
              const editor = editorRef.current;
              if (!editor) return;
              for (let i = 0; i < e.dataTransfer.files.length; i++) {
                const selection = editor.getSelection();
                if (!selection) return;
                const file = e.dataTransfer.files[i];
                setUploading(true);
                void insertImage(file, selection, showAlert).finally(() => {
                  setUploading(false);
                });
              }
            }}
            onPaste={handlePaste}
          >
            <Editor
              onMount={handleEditorMount}
              height={height}
              defaultLanguage="markdown"
              defaultValue={content}
              theme={colorMode === "dark" ? "vs-dark" : "light"}
              options={{
                wordWrap: "on",

                // Chinese IME stability key
                fontFamily: "Sarasa Mono SC, JetBrains Mono, monospace",
                fontLigatures: false,
                letterSpacing: 0,

                fontSize: 14,
                lineNumbers: "off",

                accessibilitySupport: "off",
                unicodeHighlight: { ambiguousCharacters: false },

                renderWhitespace: "none",
                renderControlCharacters: false,
                smoothScrolling: false,

                dragAndDrop: true,
                pasteAs: { enabled: false },
              }}
            />
          </div>
        </div>
        <div
          className={"min-h-0 overflow-y-auto rounded-none border-0 bg-w px-4 py-4 border-t sm:border-none " + (preview === 'edit' ? "hidden" : "")}
          style={{ height: height }}
        >
          <Markdown content={content ? content : placeholder} />
        </div>
      </div>
      <AlertUI />
    </div>
  );
}
