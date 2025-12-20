import React from 'react';
import type { Message } from '../../../ai/server/types';
import { DiffViewer } from './DiffViewer';
import { toProjectRelative, shortenPath } from '../utils/pathResolver';
import { formatToolDisplayName } from '../utils/toolNameFormatter';
import { MaterialSymbol } from '../../icons/MaterialSymbol';

interface EditToolResultCardProps {
  toolMessage: Message;
  edits: any[];
  workspacePath?: string;
  onOpenFile?: (filePath: string) => void;
}

const resolveEditFilePath = (edit: any, toolMessage: Message): string | undefined => {
  if (!edit) return undefined;
  const tool = toolMessage.toolCall;
  return (
    edit.filePath ||
    edit.file_path ||
    edit.targetFilePath ||
    tool?.targetFilePath ||
    tool?.arguments?.file_path ||
    tool?.arguments?.filePath ||
    tool?.arguments?.path
  );
};

const getInstructionText = (toolMessage: Message): string => {
  const args = toolMessage.toolCall?.arguments;
  if (!args) return '';
  if (typeof args.instructions === 'string') return args.instructions;
  if (typeof args.instruction === 'string') return args.instruction;
  return '';
};

const truncateInstruction = (text: string, maxLength = 320) => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
};

export const EditToolResultCard: React.FC<EditToolResultCardProps> = ({ toolMessage, edits, workspacePath, onOpenFile }) => {
  const tool = toolMessage.toolCall;
  if (!tool || edits.length === 0) {
    return null;
  }

  const firstEditPath = resolveEditFilePath(edits[0], toolMessage);
  const displayPath = firstEditPath ? toProjectRelative(firstEditPath, workspacePath) : '';
  const prettyPath = displayPath ? shortenPath(displayPath, 64) : '';
  const toolDisplayName = formatToolDisplayName(tool.name || '') || tool.name || 'Edit';

  const instruction = truncateInstruction(getInstructionText(toolMessage));
  const statusLabel = toolMessage.isError ? 'Failed' : 'Applied';
  const statusClass = toolMessage.isError ? 'error' : 'success';
  const editCountLabel = edits.length === 1 ? '1 edit' : `${edits.length} edits`;

  const handleOpenFile = () => {
    if (firstEditPath && onOpenFile) {
      onOpenFile(firstEditPath);
    }
  };

  return (
    <div className="rich-transcript-edit-card">
      <div className="rich-transcript-edit-card__header">
        <div className="rich-transcript-edit-card__icon" aria-hidden="true">
          <MaterialSymbol icon="edit" size={16} />
        </div>
        <div className="rich-transcript-edit-card__details">
          <div className="rich-transcript-edit-card__title">
            {toolDisplayName}
            {prettyPath && (
              <span className="rich-transcript-edit-card__file">· {prettyPath}</span>
            )}
          </div>
          <div className="rich-transcript-edit-card__meta">
            <span>{editCountLabel}</span>
            {instruction && <span className="rich-transcript-edit-card__meta-divider">•</span>}
            {instruction && <span>Instruction</span>}
          </div>
        </div>
        {firstEditPath && onOpenFile && (
          <button
            className="rich-transcript-edit-card__open-button"
            onClick={handleOpenFile}
            title="Open file"
            aria-label="Open file"
          >
            <MaterialSymbol icon="open_in_new" size={14} />
          </button>
        )}
        <span className={`rich-transcript-edit-card__status rich-transcript-edit-card__status--${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      {instruction && (
        <div className="rich-transcript-edit-card__instruction">
          {instruction}
        </div>
      )}

      <div className="rich-transcript-edit-card__diffs">
        {edits.map((edit, idx) => {
          const absolutePath = resolveEditFilePath(edit, toolMessage);
          const relativePath = absolutePath ? toProjectRelative(absolutePath, workspacePath) : undefined;
          return (
            <DiffViewer
              key={`edit-${idx}`}
              edit={edit}
              filePath={relativePath || absolutePath}
              maxHeight="18rem"
            />
          );
        })}
      </div>
    </div>
  );
};
