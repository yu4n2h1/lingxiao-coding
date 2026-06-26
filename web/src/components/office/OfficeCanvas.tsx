/**
 * OfficeCanvas — 剑阁 office tab 的文档画布
 *
 * 替代旧的 OfficeGeneratorCompact JSON 表单，提供：
 * 1. 缩略图网格：按 bbox+style 渲染幻灯片预览卡片
 * 2. 大纲视图：每页标题+文本摘要
 * 3. 编辑模式：页码列表 + 属性面板 + 增量编辑
 * 4. 空状态引导
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutGrid, ListOrdered, FileText, Loader2, RefreshCw,
  FolderOpen, Sparkles, Download, ChevronRight, AlertCircle,
  Pencil, Trash2, Save, Plus,
} from 'lucide-react';
import { officeClient, type OfficePreviewModel, type OfficePreviewPage, type OfficePreviewElement } from '../../api/OfficeClient';
import { useArtifactStore } from '../../stores/artifactStore';
import { useTranslation } from 'react-i18next';

type CanvasMode = 'thumbnails' | 'outline' | 'edit';

// ─── 幻灯片缩略图卡片 ───

function SlideThumbnailCard({
  page,
  pageIndex,
  pageSize,
  isSelected,
  onClick,
}: {
  page: OfficePreviewPage;
  pageIndex: number;
  pageSize: { width: number; height: number; unit: string };
  isSelected: boolean;
  onClick: () => void;
}) {
  // 按页面比例缩放到卡片尺寸
  const CARD_WIDTH = 240;
  const aspectRatio = pageSize.height / pageSize.width;
  const cardHeight = CARD_WIDTH * aspectRatio;
  const scaleX = CARD_WIDTH / pageSize.width;
  const scaleY = cardHeight / pageSize.height;

  // 提取页面标题（第一个文本元素）
  const titleEl = page.elements.find((e) => e.kind === 'text' && e.text);
  const title = titleEl?.text?.slice(0, 50) || `第 ${pageIndex + 1} 页`;

  return (
    <div
      onClick={onClick}
      className={`group relative shrink-0 cursor-pointer rounded-lg border-2 transition-all duration-150 ${
        isSelected
          ? 'border-accent-brand shadow-lg shadow-accent-brand/20'
          : 'border-border-muted hover:border-border-default hover:shadow-md'
      }`}
    >
      {/* 幻灯片预览区域 */}
      <div
        className="relative overflow-hidden rounded-t-md bg-white"
        style={{ width: CARD_WIDTH, height: cardHeight }}
      >
        {/* 渲染元素 */}
        {page.elements.map((el) => (
          <SlideElement key={el.id} element={el} scaleX={scaleX} scaleY={scaleY} />
        ))}
        {/* 页码标识 */}
        <div className="absolute bottom-1 right-1 rounded bg-black/40 px-1.5 py-0.5 text-[9px] font-mono text-white/80">
          {pageIndex + 1}
        </div>
      </div>
      {/* 标题栏 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-border-muted bg-bg-secondary rounded-b-md">
        <span className="text-[10px] font-mono text-text-tertiary shrink-0">{pageIndex + 1}</span>
        <span className="text-[11px] text-text-secondary truncate flex-1">{title}</span>
      </div>
    </div>
  );
}

// ─── 单个幻灯片元素渲染 ───

function SlideElement({
  element,
  scaleX,
  scaleY,
}: {
  element: OfficePreviewElement;
  scaleX: number;
  scaleY: number;
}) {
  if (!element.bbox) {
    // 无位置的元素（如纯文本段落）跳过视觉渲染
    return null;
  }

  const left = element.bbox.x * scaleX;
  const top = element.bbox.y * scaleY;
  const width = element.bbox.w * scaleX;
  const height = element.bbox.h * scaleY;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.max(width, 2)}px`,
    height: `${Math.max(height, 2)}px`,
  };

  // 字体样式
  if (element.style) {
    if (element.style.fontFace) style.fontFamily = element.style.fontFace;
    if (element.style.fontSizePt) style.fontSize = `${Math.max(element.style.fontSizePt * scaleX * 0.85, 5)}px`;
    if (element.style.bold) style.fontWeight = 'bold';
    if (element.style.italic) style.fontStyle = 'italic';
    if (element.style.color) style.color = `#${element.style.color.replace(/^#/, '')}`;
    if (element.style.fillColor) style.backgroundColor = `#${element.style.fillColor.replace(/^#/, '')}`;
    if (element.style.align) style.textAlign = element.style.align as React.CSSProperties['textAlign'];
  }

  switch (element.kind) {
    case 'text':
      return (
        <div style={style} className="overflow-hidden leading-tight whitespace-pre-wrap break-words">
          {element.text?.slice(0, 200)}
        </div>
      );
    case 'shape':
      return (
        <div
          style={{
            ...style,
            border: element.style?.lineColor ? `1px solid #${element.style.lineColor.replace(/^#/, '')}` : '1px solid #e0e0e0',
            borderRadius: '2px',
          }}
        />
      );
    case 'image':
      return (
        <div
          style={{
            ...style,
            backgroundColor: '#f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className="text-[6px] text-gray-400">IMG</span>
        </div>
      );
    case 'table':
      return (
        <div style={{ ...style, overflow: 'hidden' }} className="border border-gray-200">
          {element.rows?.slice(0, 5).map((row, ri) => (
            <div key={ri} className="flex border-b border-gray-100 last:border-b-0" style={{ height: `${height / Math.min(element.rows?.length || 1, 5)}px` }}>
              {row.cells.slice(0, 6).map((cell, ci) => (
                <div
                  key={ci}
                  className="flex-1 border-r border-gray-100 last:border-r-0 px-0.5 flex items-center overflow-hidden"
                  style={{ fontSize: '4px', color: cell.style?.color ? `#${cell.style.color.replace(/^#/, '')}` : undefined }}
                >
                  {cell.text.slice(0, 15)}
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

// ─── 大纲视图 ───

function OutlineView({ model }: { model: OfficePreviewModel }) {
  return (
    <div className="flex flex-col gap-1 p-3">
      {model.pages.map((page, idx) => {
        const texts = page.elements
          .filter((e) => e.kind === 'text' && e.text)
          .map((e) => e.text!);
        const title = texts[0]?.slice(0, 60) || `第 ${idx + 1} 页`;

        return (
          <div
            key={page.id}
            className="group rounded-lg border border-border-muted bg-bg-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
          >
            <div className="flex items-start gap-2 px-3 py-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent-brand/10 text-[10px] font-mono text-accent-brand mt-0.5">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-text-primary truncate">{title}</div>
                {texts.length > 1 && (
                  <div className="mt-0.5 space-y-0.5">
                    {texts.slice(1, 4).map((t, i) => (
                      <div key={i} className="text-[10px] text-text-tertiary truncate flex items-center gap-1">
                        <ChevronRight size={8} className="shrink-0 text-text-quaternary" />
                        {t.slice(0, 80)}
                      </div>
                    ))}
                    {texts.length > 4 && (
                      <div className="text-[10px] text-text-quaternary">+{texts.length - 4} 更多...</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {page.notes && (
              <div className="px-3 pb-2 pl-10 text-[10px] text-text-quaternary italic truncate">
                备注: {page.notes.slice(0, 80)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 空状态 ───

function EmptyState({ onGenerate, onOpenFile }: { onGenerate: () => void; onOpenFile: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-brand/10">
        <Sparkles size={28} className="text-accent-brand" />
      </div>
      <div>
        <div className="text-sm font-medium text-text-primary">文档画布</div>
        <div className="mt-1 text-xs text-text-tertiary">
          生成 PPT/DOCX/XLSX 后在此预览，或打开已有文件
        </div>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-[200px]">
        <button
          onClick={onGenerate}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-accent-brand px-3 py-2 text-xs font-medium text-white hover:bg-accent-brand/90 transition-colors"
        >
          <Sparkles size={14} />
          让 AI 生成
        </button>
        <button
          onClick={onOpenFile}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border-muted px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <FolderOpen size={14} />
          打开文件
        </button>
      </div>
    </div>
  );
}

// ─── 主组件 ───

export default function OfficeCanvas() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CanvasMode>('thumbnails');
  const [preview, setPreview] = useState<OfficePreviewModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<number>(-1);
  const [filePath, setFilePath] = useState<string | null>(null);

  const { openArtifact, activeArtifact } = useArtifactStore();

  // 当 artifact store 中的 artifact 包含 office 文件路径时自动加载预览
  useEffect(() => {
    if (!activeArtifact?.path) return;
    const path = activeArtifact.path;
    // 只处理 office 文件
    if (!/\.(pptx|docx)$/i.test(path)) return;

    setFilePath(path);
    void loadPreview(path);
  }, [activeArtifact?.path]);

  const loadPreview = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const isPptx = /\.pptx$/i.test(path);
      const model = await officeClient.getPreview(path, {
        format: isPptx ? 'pptx' : 'docx',
        slideLimit: 50,
      });
      setPreview(model);
      setSelectedPage(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleGenerate = useCallback(() => {
    // 通过 artifact store 打开生成器面板
    // ChatView 的输入框通过快捷指令触发
    window.dispatchEvent(new CustomEvent('lingxiao:office-generate'));
  }, []);

  const handleOpenFile = useCallback(() => {
    // 触发文件选择
    const input = window.prompt('输入文件路径（如 /workspace/output.pptx）');
    if (input) {
      setFilePath(input);
      void loadPreview(input);
    }
  }, [loadPreview]);

  const handleRefresh = useCallback(() => {
    if (filePath) void loadPreview(filePath);
  }, [filePath, loadPreview]);

  const handleDownload = useCallback(() => {
    if (!filePath) return;
    const name = filePath.split('/').pop() || 'download';
    // 使用 artifact store 打开下载
    openArtifact({ path: filePath, name });
  }, [filePath, openArtifact]);

  const stats = useMemo(() => {
    if (!preview) return null;
    return preview.stats;
  }, [preview]);

  return (
    <div className="flex h-full flex-col bg-bg-primary min-h-0">
      {/* 顶部 Toolbar */}
      <div className="shrink-0 flex items-center gap-1 border-b border-border-subtle bg-bg-tertiary/50 px-2 py-1.5">
        <div className="flex items-center gap-1 mr-1">
          <Sparkles size={12} className="text-accent-brand" />
          <span className="text-[11px] font-bold text-text-primary">文档画布</span>
        </div>

        {preview && (
          <>
            {/* 模式切换 */}
            <div className="flex items-center rounded-md border border-border-muted bg-bg-secondary">
              <button
                onClick={() => setMode('thumbnails')}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-l-md transition-colors ${
                  mode === 'thumbnails' ? 'bg-accent-brand/15 text-accent-brand' : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <LayoutGrid size={12} />
                缩略图
              </button>
              <button
                onClick={() => setMode('outline')}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                  mode === 'outline' ? 'bg-accent-brand/15 text-accent-brand' : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <ListOrdered size={12} />
                大纲
              </button>
              {preview?.kind === 'pptx' && (
                <button
                  onClick={() => setMode('edit')}
                  className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-r-md transition-colors ${
                    mode === 'edit' ? 'bg-accent-brand/15 text-accent-brand' : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  <Pencil size={12} />
                  编辑
                </button>
              )}
            </div>

            {/* 统计信息 */}
            <div className="flex items-center gap-2 text-[10px] text-text-tertiary ml-1">
              <span>{stats?.pageCount || 0} 页</span>
              <span>·</span>
              <span>{stats?.elementCount || 0} 元素</span>
              {stats && stats.imageCount > 0 && (
                <>
                  <span>·</span>
                  <span>{stats.imageCount} 图片</span>
                </>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={handleRefresh}
                className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:text-accent-blue hover:bg-bg-hover transition-colors"
                title="刷新预览"
              >
                <RefreshCw size={12} />
              </button>
              <button
                onClick={handleDownload}
                className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:text-accent-blue hover:bg-bg-hover transition-colors"
                title="下载文件"
              >
                <Download size={12} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* 文件路径条 */}
      {filePath && (
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-1 border-b border-border-subtle bg-bg-secondary/50">
          <FileText size={10} className="text-text-tertiary shrink-0" />
          <span className="text-[10px] font-mono text-text-tertiary truncate">{filePath}</span>
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={20} className="animate-spin text-accent-brand" />
              <span className="text-[11px] text-text-tertiary">加载预览中...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
            <AlertCircle size={24} className="text-accent-red" />
            <div className="text-[11px] text-text-secondary">预览加载失败</div>
            <div className="text-[10px] text-text-tertiary max-w-[280px] text-center">{error}</div>
            <button
              onClick={handleRefresh}
              className="mt-1 flex items-center gap-1 rounded border border-border-muted px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-hover"
            >
              <RefreshCw size={10} />
              重试
            </button>
          </div>
        ) : preview ? (
          mode === 'thumbnails' ? (
            <div className="p-3">
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                {preview.pages.map((page, idx) => (
                  <SlideThumbnailCard
                    key={page.id}
                    page={page}
                    pageIndex={idx}
                    pageSize={page.size}
                    isSelected={selectedPage === idx}
                    onClick={() => setSelectedPage(idx)}
                  />
                ))}
              </div>
              {/* 选中页的详情面板 */}
              {selectedPage >= 0 && selectedPage < preview.pages.length && (
                <div className="mt-3 rounded-lg border border-border-muted bg-bg-secondary p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-mono text-accent-brand">P{selectedPage + 1}</span>
                    <span className="text-[12px] font-medium text-text-primary">
                      {preview.pages[selectedPage].elements.find((e) => e.kind === 'text' && e.text)?.text?.slice(0, 60) || `第 ${selectedPage + 1} 页`}
                    </span>
                    <span className="ml-auto text-[10px] text-text-tertiary">
                      {preview.pages[selectedPage].elements.length} 个元素
                    </span>
                  </div>
                  {/* 元素列表 */}
                  <div className="space-y-1">
                    {preview.pages[selectedPage].elements
                      .filter((e) => e.text)
                      .map((el) => (
                        <div key={el.id} className="flex items-center gap-2 text-[10px]">
                          <span className="rounded bg-bg-hover px-1 py-0.5 font-mono text-text-quaternary shrink-0">{el.kind}</span>
                          <span className="text-text-secondary truncate">{el.text?.slice(0, 100)}</span>
                        </div>
                      ))}
                  </div>
                  {preview.pages[selectedPage].notes && (
                    <div className="mt-2 rounded bg-bg-hover/50 px-2 py-1 text-[10px] text-text-tertiary italic">
                      备注: {preview.pages[selectedPage].notes.slice(0, 120)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : mode === 'outline' ? (
            <OutlineView model={preview} />
          ) : (
            <EditView
              model={preview}
              filePath={filePath}
              onRefresh={handleRefresh}
            />
          )
        ) : (
          <EmptyState onGenerate={handleGenerate} onOpenFile={handleOpenFile} />
        )}
      </div>
    </div>
  );
}

// ─── 编辑模式 ───

function EditView({
  model,
  filePath,
  onRefresh,
}: {
  model: OfficePreviewModel;
  filePath: string | null;
  onRefresh: () => void;
}) {
  const [selectedSlide, setSelectedSlide] = useState(0);
  const [editingElement, setEditingElement] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  const page = model.pages[selectedSlide];
  const textElements = page?.elements.filter((e) => e.text) || [];

  const handleEditText = useCallback((element: OfficePreviewElement) => {
    setEditingElement(element.id);
    setEditText(element.text || '');
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingElement || !filePath || !page) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const operations = [{
        type: 'replace_element_text',
        element_id: editingElement,
        text: editText,
      }];
      await officeClient.editPptx(filePath, operations, { overwrite: true });
      setSaveResult({ success: true, message: '已保存' });
      setEditingElement(null);
      onRefresh();
    } catch (e) {
      setSaveResult({ success: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }, [editingElement, filePath, editText, page, onRefresh]);

  const handleDeleteElement = useCallback(async (elementId: string) => {
    if (!filePath) return;
    setSaving(true);
    setSaveResult(null);
    try {
      await officeClient.editPptx(filePath, [{
        type: 'delete_element',
        element_id: elementId,
      }], { overwrite: true });
      setSaveResult({ success: true, message: '元素已删除' });
      onRefresh();
    } catch (e) {
      setSaveResult({ success: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }, [filePath, onRefresh]);

  return (
    <div className="flex h-full min-h-0">
      {/* 左侧页码列表 */}
      <div className="w-32 shrink-0 border-r border-border-muted overflow-auto">
        <div className="p-1 space-y-0.5">
          {model.pages.map((p, idx) => {
            const title = p.elements.find((e) => e.kind === 'text' && e.text)?.text?.slice(0, 20) || `P${idx + 1}`;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedSlide(idx)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-colors ${
                  selectedSlide === idx
                    ? 'bg-accent-brand/10 text-accent-brand'
                    : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
                }`}
              >
                <span className="text-[10px] font-mono shrink-0">{idx + 1}</span>
                <span className="text-[10px] truncate">{title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧编辑区域 */}
      <div className="flex-1 min-w-0 overflow-auto p-3">
        {page && (
          <>
            {/* 页面信息 */}
            <div className="flex items-center gap-2 mb-3">
              <span className="rounded bg-accent-brand/10 px-2 py-0.5 text-[10px] font-mono text-accent-brand">
                P{selectedSlide + 1}
              </span>
              <span className="text-[12px] font-medium text-text-primary">
                {page.elements.find((e) => e.kind === 'text' && e.text)?.text?.slice(0, 60) || `第 ${selectedSlide + 1} 页`}
              </span>
              <span className="ml-auto text-[10px] text-text-tertiary">
                {page.elements.length} 个元素
              </span>
            </div>

            {/* 元素列表 */}
            <div className="space-y-2">
              {textElements.map((el) => (
                <div
                  key={el.id}
                  className={`rounded-lg border p-2 transition-all ${
                    editingElement === el.id
                      ? 'border-accent-brand bg-accent-brand/5'
                      : 'border-border-muted bg-bg-secondary'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[9px] font-mono text-text-quaternary shrink-0">
                      {el.kind}
                    </span>
                    <span className="text-[9px] font-mono text-text-quaternary truncate">{el.id}</span>
                    <div className="ml-auto flex items-center gap-0.5">
                      <button
                        onClick={() => handleEditText(el)}
                        className="flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:text-accent-blue hover:bg-bg-hover"
                        title="编辑文本"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        onClick={() => handleDeleteElement(el.id)}
                        disabled={saving}
                        className="flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:text-accent-red hover:bg-bg-hover disabled:opacity-40"
                        title="删除元素"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>

                  {editingElement === el.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full bg-bg-primary border border-border-muted rounded p-2 text-[11px] text-text-primary outline-none focus:border-accent-brand resize-y"
                        rows={4}
                        autoFocus
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleSaveEdit}
                          disabled={saving}
                          className="flex items-center gap-1 rounded bg-accent-brand px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-brand/90 disabled:opacity-40"
                        >
                          {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                          保存
                        </button>
                        <button
                          onClick={() => setEditingElement(null)}
                          className="rounded border border-border-muted px-2 py-1 text-[10px] text-text-tertiary hover:bg-bg-hover"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-text-secondary">
                      {el.text?.slice(0, 120)}
                      {el.text && el.text.length > 120 ? '...' : ''}
                    </div>
                  )}

                  {/* 样式信息 */}
                  {el.style && (
                    <div className="flex items-center gap-2 mt-1 text-[9px] text-text-quaternary">
                      {el.style.fontFace && <span>{el.style.fontFace}</span>}
                      {el.style.fontSizePt && <span>{el.style.fontSizePt}pt</span>}
                      {el.style.bold && <span>B</span>}
                      {el.style.color && (
                        <span className="flex items-center gap-0.5">
                          <span className="inline-block h-2 w-2 rounded-full border border-border-muted" style={{ backgroundColor: `#${el.style.color.replace(/^#/, '')}` }} />
                          {el.style.color}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 保存结果提示 */}
            {saveResult && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-[11px] ${
                saveResult.success
                  ? 'bg-accent-green/10 text-accent-green'
                  : 'bg-accent-red/10 text-accent-red'
              }`}>
                {saveResult.message}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
