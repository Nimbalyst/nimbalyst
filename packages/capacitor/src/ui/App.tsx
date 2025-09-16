import React, { useEffect, useMemo, useRef, useState } from 'react';
import { initDB, ProjectsRepository, DocumentsRepository, type DocumentRecord, type Project } from '@stravu/runtime';
import { StravuEditor } from 'rexical';
import { AIPanel } from './AIPanel';

export function App() {
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocumentRecord | null>(null);
  const [aiOpen, setAiOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<Pick<DocumentRecord, 'id' | 'title' | 'content'> | null>(null);

  useEffect(() => {
    (async () => {
      await initDB();
      const ps = await ProjectsRepository.list();
      let project = ps[0];
      if (!project) {
        project = await ProjectsRepository.create('My Notes');
      }
      setProjects([project, ...ps.filter(p => p.id !== project.id)]);
      setActiveProject(project);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!activeProject) return;
    (async () => {
      const ds = await DocumentsRepository.list(activeProject.id);
      setDocs(ds);
      if (ds.length) setActiveDoc(ds[0]);
    })();
  }, [activeProject?.id]);

  const onNewDoc = async () => {
    if (!activeProject) return;
    const created = await DocumentsRepository.create(activeProject.id, 'Untitled');
    const ds = await DocumentsRepository.list(activeProject.id);
    setDocs(ds);
    setActiveDoc(created);
  };

  const flushSave = async () => {
    if (!activeDoc) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const payload = pendingSave.current ?? { id: activeDoc.id, title: activeDoc.title, content: activeDoc.content };
    if (payload) {
      await DocumentsRepository.save(payload);
      pendingSave.current = null;
    }
    const ds = await DocumentsRepository.list(activeDoc.projectId);
    setDocs(ds);
  };

  const onSave = async () => {
    await flushSave();
  };

  const scheduleSave = (doc: DocumentRecord) => {
    pendingSave.current = { id: doc.id, title: doc.title, content: doc.content };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = pendingSave.current;
      if (payload) {
        await DocumentsRepository.save(payload);
        pendingSave.current = null;
      }
    }, 2000);
  };

  const onSelectDoc = async (d: DocumentRecord) => {
    await flushSave();
    setActiveDoc(d);
  };

  // Flush pending saves on unmount, tab hide, or page unload
  useEffect(() => {
    const handleBeforeUnload = () => { void flushSave(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void flushSave();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
      void flushSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.id]);

  const onRenameDoc = async (doc: DocumentRecord, title: string) => {
    await DocumentsRepository.save({ id: doc.id, title, content: doc.content });
    const ds = await DocumentsRepository.list(doc.projectId);
    setDocs(ds);
    if (activeDoc?.id === doc.id) setActiveDoc({ ...activeDoc, title });
  };

  if (!ready) return <div className="muted" style={{ padding: 16 }}>Initializing…</div>;

  return (
    <div className={`app ${sidebarOpen ? 'flyout-open' : ''}`}>
      <aside className="sidebar">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button className="btn" onClick={onNewDoc}>New Doc</button>
        </div>
        <div className="muted">{activeProject?.name}</div>
        <ul className="list">
          {docs.map(d => (
            <li key={d.id} className={activeDoc?.id === d.id ? 'active' : ''} onClick={() => { onSelectDoc(d); setSidebarOpen(false); }}>
              {d.title || 'Untitled'}
            </li>
          ))}
        </ul>
      </aside>
      {/* Mobile flyout */}
      {sidebarOpen && (
        <div className="flyout-overlay" onClick={() => setSidebarOpen(false)}>
          <div className="flyout" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className="btn" onClick={() => { onNewDoc(); }}>New Doc</button>
              <button className="btn" onClick={() => setSidebarOpen(false)}>Close</button>
            </div>
            <div className="muted">{activeProject?.name}</div>
            <ul className="list">
              {docs.map(d => (
                <li key={d.id} className={activeDoc?.id === d.id ? 'active' : ''} onClick={() => { onSelectDoc(d); setSidebarOpen(false); }}>
                  {d.title || 'Untitled'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <main className="main">
        <div className="toolbar">
          <button className="btn" onClick={() => setSidebarOpen(true)} title="Menu" style={{ marginRight: 8 }}>☰</button>
          <input
            style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px' }}
            value={activeDoc?.title || ''}
            onChange={(e) => activeDoc && onRenameDoc(activeDoc, e.target.value)}
            placeholder="Title"
          />
          <button className="btn" onClick={onSave}>Save</button>
          <button className="btn" onClick={() => setAiOpen((v) => !v)}>AI</button>
        </div>
        <div className="editor">
          {activeDoc ? (
            <StravuEditor
              key={activeDoc.id}
              config={{
                theme: 'auto',
                isRichText: true,
                selectionAlwaysOnDisplay: true,
                markdownOnly: true,
                initialContent: activeDoc.content,
                onContentChange: async (content: string) => {
                  const updated = { ...activeDoc, content };
                  setActiveDoc(updated);
                  scheduleSave(updated);
                },
              }}
            />
          ) : (
            <div className="muted">Select or create a document…</div>
          )}
        </div>
      </main>
      <AIPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        document={activeDoc ? { content: activeDoc.content, fileType: 'markdown', filePath: activeDoc.title } : undefined}
      />
    </div>
  );
}
