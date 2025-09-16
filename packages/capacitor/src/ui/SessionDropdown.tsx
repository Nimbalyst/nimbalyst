import React, { useEffect, useState } from 'react';
import { AISessionsRepository } from '@stravu/runtime';

export function SessionDropdown({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (id: string) => void }) {
  const [sessions, setSessions] = useState<{ id: string; provider: string; model?: string; updatedAt: number }[]>([]);
  useEffect(() => { if (open) { AISessionsRepository.list().then(setSessions).catch(()=>setSessions([])); } }, [open]);
  if (!open) return null;
  return (
    <div style={{ position: 'absolute', inset: 0 }} onClick={onClose}>
      <div style={{ position: 'absolute', bottom: 56, left: 8, right: 'auto', width: 320, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.2)', padding: 8 }} onClick={(e)=>e.stopPropagation()}>
        <div className="text-sm font-semibold text-gray-500" style={{ marginBottom: 6 }}>Recent Sessions</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {sessions.map(s => (
            <button key={s.id} className="btn" onClick={() => { onSelect(s.id); onClose(); }}>
              <div className="flex items-center justify-between w-full">
                <span className="truncate" title={`${s.provider} • ${s.model || 'model'}`}>{s.provider.toUpperCase()} • {s.model || 'model'}</span>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>history</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
