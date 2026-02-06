import React, { useState, useEffect } from 'react';
import { searchFiles, getFileBase64, type FileMatch, type AttachmentRequest } from '@/api/claude';
import { Paperclip, X, Check, File as FileIcon, AlertCircle } from 'lucide-react';

interface AttachmentSuggestion {
  request: AttachmentRequest;
  matches: FileMatch[];
  selectedFile: FileMatch | null;
  loading: boolean;
  error: string | null;
}

interface AttachmentSuggestionsProps {
  attachmentRequests: AttachmentRequest[];
  onAttachmentsSelected: (attachments: Array<{ path: string; base64: string; name: string }>) => void;
}

export const AttachmentSuggestions: React.FC<AttachmentSuggestionsProps> = ({
  attachmentRequests,
  onAttachmentsSelected,
}) => {
  const [suggestions, setSuggestions] = useState<AttachmentSuggestion[]>([]);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (attachmentRequests.length === 0) {
      setSuggestions([]);
      return;
    }

    // Initialize suggestions for each attachment request
    const initialSuggestions: AttachmentSuggestion[] = attachmentRequests.map(request => ({
      request,
      matches: [],
      selectedFile: null,
      loading: true,
      error: null,
    }));

    setSuggestions(initialSuggestions);

    // Search for files for each request
    attachmentRequests.forEach(async (request, index) => {
      try {
        const keywords = [request.keyword];
        const fileTypes = request.file_type ? [request.file_type] : undefined;

        const matches = await searchFiles(keywords, fileTypes, 5);

        setSuggestions(prev => {
          const newSuggestions = [...prev];
          newSuggestions[index] = {
            ...newSuggestions[index],
            matches,
            loading: false,
          };
          return newSuggestions;
        });
      } catch (error) {
        setSuggestions(prev => {
          const newSuggestions = [...prev];
          newSuggestions[index] = {
            ...newSuggestions[index],
            loading: false,
            error: 'Failed to search files',
          };
          return newSuggestions;
        });
      }
    });
  }, [attachmentRequests]);

  const selectFile = (suggestionIndex: number, file: FileMatch) => {
    setSuggestions(prev => {
      const newSuggestions = [...prev];
      newSuggestions[suggestionIndex] = {
        ...newSuggestions[suggestionIndex],
        selectedFile: file,
      };
      return newSuggestions;
    });
  };

  const handleAttachAll = async () => {
    setAttaching(true);

    const attachments: Array<{ path: string; base64: string; name: string }> = [];

    for (const suggestion of suggestions) {
      if (suggestion.selectedFile) {
        try {
          const base64 = await getFileBase64(suggestion.selectedFile.path);
          attachments.push({
            path: suggestion.selectedFile.path,
            base64,
            name: suggestion.selectedFile.name,
          });
        } catch (error) {
          console.error('Failed to get file base64:', error);
        }
      }
    }

    setAttaching(false);
    onAttachmentsSelected(attachments);
  };

  const canAttachAll = suggestions.every(s => s.selectedFile !== null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  if (attachmentRequests.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-4">
      {suggestions.map((suggestion, suggestionIndex) => (
        <div key={suggestionIndex} className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex items-start gap-3">
            <Paperclip className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {suggestion.request.description}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Searching for: <span className="font-mono">{suggestion.request.keyword}</span>
                {suggestion.request.file_type && (
                  <span className="ml-2">(.{suggestion.request.file_type})</span>
                )}
              </p>

              {suggestion.loading && (
                <div className="flex items-center gap-2 mt-3 text-amber-700 dark:text-amber-300">
                  <div className="w-4 h-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                  <span className="text-xs">Searching files...</span>
                </div>
              )}

              {suggestion.error && (
                <div className="flex items-center gap-2 mt-3 text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-xs">{suggestion.error}</span>
                </div>
              )}

              {!suggestion.loading && !suggestion.error && suggestion.matches.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                  No matching files found. Try checking your indexed folders.
                </p>
              )}

              {!suggestion.loading && suggestion.matches.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {suggestion.matches.length} file{suggestion.matches.length !== 1 ? '' : ''} found:
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {suggestion.matches.map((file, fileIndex) => (
                      <button
                        key={fileIndex}
                        onClick={() => selectFile(suggestionIndex, file)}
                        className={`text-left p-3 rounded border-2 transition-all ${
                          suggestion.selectedFile?.path === file.path
                            ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-500 dark:border-amber-600'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-300 dark:hover:border-amber-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <FileIcon className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                            <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                              {file.name}
                            </span>
                          </div>
                          {suggestion.selectedFile?.path === file.path && (
                            <Check className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                          <span>{file.folder_name}</span>
                          <span>{formatFileSize(file.size)}</span>
                          <span>{formatDate(file.modified)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {suggestions.some(s => s.matches.length > 0) && (
        <div className="flex items-center justify-end gap-2 pt-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {suggestions.filter(s => s.selectedFile).length} / {suggestions.length} selected
          </span>
          <button
            onClick={handleAttachAll}
            disabled={!canAttachAll || attaching}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            {attaching ? 'Attaching...' : canAttachAll ? 'Attach Selected' : 'Select All Files'}
          </button>
        </div>
      )}
    </div>
  );
};
