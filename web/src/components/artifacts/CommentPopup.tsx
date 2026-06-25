/**
 * CommentPopup — 预览评论浮窗
 *
 * 用户在预览面板选中内容后点击"评论"按钮，弹出此浮窗。
 * 用户填写评论后，点击发送，将 文件路径 + 源码级上下文 + 评论
 * 通过 session/prompt 发送给凌霄 Leader，由 Leader 做源码级修改。
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, X, Loader2, MessageSquare } from 'lucide-react';

export interface CommentContext {
  /** 文件路径 */
  filePath: string;
  /** 文件格式 */
  format: string;
  /** 选中内容类型 */
  selectionType: 'text' | 'line' | 'cell' | 'slide' | 'element' | 'full';
  /** 选中文本 */
  selectedText?: string;
  /** 行号范围 (Monaco) */
  startLine?: number;
  endLine?: number;
  /** XLSX sheet 名 */
  sheet?: string;
  /** PPTX slide index */
  slideIndex?: number;
  /** 表格行列 */
  row?: number;
  col?: number;
}

interface CommentPopupProps {
  /** 评论上下文 */
  context: CommentContext | null;
  /** 发送回调 */
  onSend: (comment: string, ctx: CommentContext) => Promise<void>;
  /** 关闭回调 */
  onClose: () => void;
}

export default function CommentPopup({ context, onSend, onClose }: CommentPopupProps) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (context && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [context]);

  if (!context) return null;

  const handleSend = async () => {
    if (!comment.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(comment.trim(), context);
      setComment('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('artifact.comment.sendFailed', 'Failed to send comment'));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // 构建上下文摘要
  const contextSummary = (() => {
    const parts: string[] = [];
    parts.push(`📄 ${context.filePath}`);
    if (context.selectionType === 'line' && context.startLine) {
      const range = context.endLine && context.endLine !== context.startLine
        ? `L${context.startLine}-${context.endLine}`
        : `L${context.startLine}`;
      parts.push(`📍 ${range}`);
    }
    if (context.sheet) parts.push(`📋 Sheet: ${context.sheet}`);
    if (context.slideIndex !== undefined) parts.push(`📊 Slide ${context.slideIndex}`);
    if (context.row !== undefined && context.col !== undefined) parts.push(`🔗 R${context.row}C${context.col}`);
    if (context.selectedText) {
      const preview = context.selectedText.length > 120
        ? context.selectedText.slice(0, 120) + '...'
        : context.selectedText;
      parts.push(`📝 "${preview}"`);
    }
    return parts.join('  ·  ');
  })();

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[520px] max-w-[90vw] rounded-lg border border-border-default bg-bg-primary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border-muted px-4 py-3">
          <MessageSquare size={16} className="text-accent-brand" />
          <span className="text-sm font-medium text-text-primary">
            {t('artifact.comment.title', '源码评论 → 发送给 Leader')}
          </span>
          <button onClick={onClose} className="ml-auto rounded p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary">
            <X size={16} />
          </button>
        </div>

        {/* Context preview */}
        <div className="border-b border-border-muted px-4 py-2.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
            {t('artifact.comment.contextLabel', '评论上下文')}
          </div>
          <div className="rounded border border-border-muted bg-bg-secondary/60 px-3 py-2 text-xs text-text-secondary break-all">
            {contextSummary}
          </div>
          {context.selectedText && context.selectedText.length > 0 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[10px] text-accent-brand hover:underline">
                {t('artifact.comment.viewFullSelection', '查看完整选中文本')}
              </summary>
              <pre className="mt-1 max-h-32 overflow-auto rounded border border-border-muted bg-bg-secondary/60 p-2 text-[10px] font-mono text-text-secondary whitespace-pre-wrap break-all">
                {context.selectedText}
              </pre>
            </details>
          )}
        </div>

        {/* Comment input */}
        <div className="px-4 py-3">
          <textarea
            ref={textareaRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('artifact.comment.placeholder', '输入你的修改意见，Leader 会根据上下文做源码级修改...')}
            className="h-24 w-full resize-none rounded-md border border-border-input bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-brand/50"
            disabled={sending}
          />
          {error && (
            <div className="mt-2 text-xs text-accent-red">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-muted px-4 py-3">
          <span className="text-[10px] text-text-tertiary">
            {t('artifact.comment.hint', '⌘/Ctrl+Enter 发送 · Esc 取消')}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={sending}
              className="rounded border border-border-muted px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-40"
            >
              {t('app.cancel', '取消')}
            </button>
            <button
              onClick={handleSend}
              disabled={!comment.trim() || sending}
              className="inline-flex items-center gap-1.5 rounded bg-accent-brand px-3 py-1.5 text-xs text-white hover:bg-accent-brand/90 disabled:opacity-40"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {t('artifact.comment.send', '发送给 Leader')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
