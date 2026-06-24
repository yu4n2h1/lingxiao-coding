/**
 * FileCanvasCompact — 剑阁侧边面板内的文件画布
 *
 * 文件目录树 + 全功能预览
 * 使用与 EditorView 一致的 apiFetch 模式（带 sessionId）
 */

import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { getServerToken } from '../../api/headers';
import {
  Folder, FolderOpen, File as FileIcon, ChevronRight, ChevronDown,
  FileCode, FileText, Image, Loader2, RefreshCw, Eye, Code2, Home,
} from 'lucide-react';

// ─── API ───

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-lingxiao-token': getServerToken(),
      ...(opts?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Types ───

interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FsEntry[];
  loaded?: boolean;
}

// ─── Component ───

export default function FileCanvasCompact() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const serverCwd = useSessionStore((s) => s.serverCwd);
  const sessions = useSessionStore((s) => s.sessions);
  const workspace = sessions.find(s => s.id === sessionId)?.workspace || serverCwd || '.';

  const [tree, setTree] = useState<FsEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [previewMode, setPreviewMode] = useState<'render' | 'source'>('source');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(async (dirPath?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ entries: FsEntry[] }>('/fs/list', {
        method: 'POST',
        body: JSON.stringify({ path: dirPath || workspace, sessionId }),
      });
      if (dirPath) {
        setTree(prev => mergeChildren(prev, dirPath, data.entries || []));
      } else {
        setTree(data.entries || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list files');
    } finally {
      setIsLoading(false);
    }
  }, [workspace, sessionId]);

  // Load root on mount
  useEffect(() => { fetchTree(); }, [fetchTree]);

  const toggleDir = useCallback(async (node: FsEntry) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path);
      setExpanded(newExpanded);
    } else {
      newExpanded.add(node.path);
      setExpanded(newExpanded);
      if (!node.loaded) {
        await fetchTree(node.path);
      }
    }
  }, [expanded, fetchTree]);

  const loadFile = useCallback(async (filePath: string) => {
    setIsLoadingFile(true);
    setActiveFile(filePath);
    setError(null);
    try {
      const params = new URLSearchParams({ path: filePath, token: getServerToken() });
      if (sessionId) params.set('sessionId', sessionId);
      const res = await fetch(`/api/v1/files/download?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setFileContent(json?.content || '');
      const ext = filePath.split('.').pop()?.toLowerCase();
      setPreviewMode(['html', 'htm', 'svg'].includes(ext || '') ? 'render' : 'source');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFileContent('');
    } finally {
      setIsLoadingFile(false);
    }
  }, [sessionId]);

  return (
    <div className="flex h-full bg-bg-primary overflow-hidden">
      {/* File tree */}
      <div className="w-48 flex flex-col border-r border-border-subtle bg-bg-secondary flex-shrink-0">
        <div className="flex items-center gap-2 px-2 h-7 border-b border-border-subtle bg-bg-tertiary/50 flex-shrink-0">
          <Home size={11} className="text-text-tertiary" />
          <span className="text-[10px] font-mono text-text-tertiary truncate flex-1" title={workspace}>
            {workspace === '.' ? 'root' : workspace.split('/').pop() || 'root'}
          </span>
          <button onClick={() => fetchTree()} className="p-0.5 rounded hover:bg-bg-hover text-text-tertiary" title="刷新">
            <RefreshCw size={11} />
          </button>
        </div>
        <div className="flex-1 overflow-auto py-0.5">
          {isLoading && tree.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-text-tertiary"><Loader2 size={14} className="animate-spin" /></div>
          ) : tree.length === 0 ? (
            <div className="px-2 py-4 text-[11px] text-text-tertiary text-center">{error || '无文件'}</div>
          ) : (
            <TreeNodes nodes={tree} expanded={expanded} activeFile={activeFile} onToggleDir={toggleDir} onFileClick={loadFile} depth={0} />
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-2 h-7 border-b border-border-subtle bg-bg-tertiary/50 flex-shrink-0">
          {activeFile ? (
            <>
              <FileIcon size={11} className="text-text-tertiary" />
              <span className="text-[10px] font-mono text-text-secondary truncate flex-1" title={activeFile}>{activeFile.split('/').pop()}</span>
              <button onClick={() => setPreviewMode(p => p === 'render' ? 'source' : 'render')} className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${previewMode === 'render' ? 'text-accent-brand bg-accent-brand/10' : 'text-text-tertiary'}`}>
                {previewMode === 'render' ? <Eye size={10} /> : <Code2 size={10} />}
                {previewMode === 'render' ? '渲染' : '源码'}
              </button>
            </>
          ) : <span className="text-[10px] text-text-tertiary">选择文件预览</span>}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {isLoadingFile ? (
            <div className="flex items-center justify-center h-full text-text-tertiary"><Loader2 size={16} className="animate-spin" /></div>
          ) : activeFile ? (
            <Preview filePath={activeFile} content={fileContent} mode={previewMode} sessionId={sessionId} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-2">
              <FileText size={32} className="opacity-20" />
              <p className="text-[11px]">从左侧选择文件</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function mergeChildren(tree: FsEntry[], parentPath: string, children: FsEntry[]): FsEntry[] {
  return tree.map(entry => {
    if (entry.path === parentPath && entry.type === 'directory') {
      return { ...entry, children, loaded: true };
    }
    if (entry.children) {
      return { ...entry, children: mergeChildren(entry.children, parentPath, children) };
    }
    return entry;
  });
}

function TreeNodes({ nodes, expanded, activeFile, onToggleDir, onFileClick, depth }: {
  nodes: FsEntry[]; expanded: Set<string>; activeFile: string | null;
  onToggleDir: (n: FsEntry) => void; onFileClick: (p: string) => void; depth: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.path);
        const isActive = activeFile === node.path;
        const isDir = node.type === 'directory';
        const ext = node.name.split('.').pop()?.toLowerCase() || '';
        return (
          <div key={node.path}>
            <button
              onClick={() => isDir ? onToggleDir(node) : onFileClick(node.path)}
              className={`w-full flex items-center gap-1 px-1.5 py-0.5 text-[11px] hover:bg-bg-hover text-left ${isActive ? 'bg-accent-brand/10 text-accent-brand' : 'text-text-secondary'}`}
              style={{ paddingLeft: `${depth * 10 + 4}px` }}
            >
              {isDir ? (
                <>
                  {isExpanded ? <ChevronDown size={9} className="flex-shrink-0" /> : <ChevronRight size={9} className="flex-shrink-0" />}
                  {isExpanded ? <FolderOpen size={11} className="text-accent-brand/60 flex-shrink-0" /> : <Folder size={11} className="text-accent-brand/60 flex-shrink-0" />}
                </>
              ) : (
                <>
                  <span className="w-[9px] flex-shrink-0" />
                  {['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'go', 'rs'].includes(ext) ? <FileCode size={11} className="text-accent-blue/60 flex-shrink-0" /> :
                   ['html', 'htm', 'svg', 'xml'].includes(ext) ? <FileCode size={11} className="text-accent-orange/60 flex-shrink-0" /> :
                   ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext) ? <Image size={11} className="text-accent-green/60 flex-shrink-0" /> :
                   ['md', 'txt', 'log'].includes(ext) ? <FileText size={11} className="text-text-tertiary flex-shrink-0" /> :
                   <FileIcon size={11} className="text-text-tertiary flex-shrink-0" />}
                </>
              )}
              <span className="truncate">{node.name}</span>
            </button>
            {isDir && isExpanded && node.children && (
              <TreeNodes nodes={node.children} expanded={expanded} activeFile={activeFile} onToggleDir={onToggleDir} onFileClick={onFileClick} depth={depth + 1} />
            )}
          </div>
        );
      })}
    </>
  );
}

function Preview({ filePath, content, mode, sessionId }: { filePath: string; content: string; mode: 'render' | 'source'; sessionId: string | null }) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  if (mode === 'render' && ['html', 'htm'].includes(ext)) {
    return <iframe srcDoc={content} className="w-full h-full border-none bg-white" sandbox="allow-scripts allow-same-origin" title="preview" />;
  }
  if (mode === 'render' && ext === 'svg') {
    return <div className="flex items-center justify-center h-full p-4 bg-white" dangerouslySetInnerHTML={{ __html: content }} />;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg'].includes(ext)) {
    const params = new URLSearchParams({ path: filePath, raw: '1', token: getServerToken() });
    if (sessionId) params.set('sessionId', sessionId);
    return (
      <div className="flex items-center justify-center h-full p-4 bg-bg-secondary/30">
        <img src={`/api/v1/files/download?${params.toString()}`} alt={filePath} className="max-w-full max-h-full object-contain" />
      </div>
    );
  }
  return <pre className="p-2 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-all overflow-auto h-full">{content || '(空文件)'}</pre>;
}
