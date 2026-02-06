import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { searchFiles, getFileBase64, type FileMatch, type AttachmentRequest } from '@/api/claude';
import { Paperclip, Check, File as FileIcon, AlertCircle, ChevronDown, ChevronUp, Eye } from 'lucide-react';

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

const MAX_INITIAL_RESULTS = 3;

export const AttachmentSuggestions: React.FC<AttachmentSuggestionsProps> = ({
  attachmentRequests,
  onAttachmentsSelected,
}) => {
  const [suggestions, setSuggestions] = useState<AttachmentSuggestion[]>([]);
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<number>>(new Set());
  const [previewingFile, setPreviewingFile] = useState<string | null>(null);

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
      const current = newSuggestions[suggestionIndex];
      // Toggle: if clicking the same file, unselect it
      if (current.selectedFile?.path === file.path) {
        newSuggestions[suggestionIndex] = {
          ...current,
          selectedFile: null,
        };
      } else {
        newSuggestions[suggestionIndex] = {
          ...current,
          selectedFile: file,
        };
      }
      return newSuggestions;
    });
  };

  const handlePreview = async (file: FileMatch, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent file selection when clicking preview
    setPreviewingFile(file.path);

    try {
      // Download and open the file
      const base64 = await getFileBase64(file.path);
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Save to downloads folder
      const downloadsPath = await invoke<string>('get_downloads_path', {});
      const filePath = `${downloadsPath}/${file.name}`;

      await invoke('write_file', {
        path: filePath,
        contents: Array.from(bytes)
      });

      // Open the file
      await invoke('open_file', { path: filePath });
    } catch (error) {
      console.error('Failed to preview file:', error);
      alert('Failed to preview file');
    } finally {
      setPreviewingFile(null);
    }
  };

  // Auto-attach selected files when selection changes
  useEffect(() => {
    const attachSelectedFiles = async () => {
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

      onAttachmentsSelected(attachments);
    };

    attachSelectedFiles();
  }, [suggestions, onAttachmentsSelected]);

  const toggleExpanded = (suggestionIndex: number) => {
    setExpandedSuggestions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(suggestionIndex)) {
        newSet.delete(suggestionIndex);
      } else {
        newSet.add(suggestionIndex);
      }
      return newSet;
    });
  };

  const getVisibleMatches = (matches: FileMatch[], suggestionIndex: number) => {
    const isExpanded = expandedSuggestions.has(suggestionIndex);
    if (isExpanded || matches.length <= MAX_INITIAL_RESULTS) {
      return matches;
    }

    const suggestion = suggestions[suggestionIndex];
    // If a file is selected that's outside the top 3, include it
    const selectedFile = suggestion?.selectedFile;
    if (selectedFile) {
      const selectedIndex = matches.findIndex(m => m.path === selectedFile.path);
      if (selectedIndex >= MAX_INITIAL_RESULTS) {
        // Include top 3 + the selected file
        return [...matches.slice(0, MAX_INITIAL_RESULTS), selectedFile];
      }
    }

    return matches.slice(0, MAX_INITIAL_RESULTS);
  };

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
                    {suggestion.matches.length} file{suggestion.matches.length !== 1 ? 's' : ''} found:
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {getVisibleMatches(suggestion.matches, suggestionIndex).map((file, fileIndex) => (
                      <div
                        key={fileIndex}
                        className={`p-3 rounded border-2 transition-all ${
                          suggestion.selectedFile?.path === file.path
                            ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-500 dark:border-amber-600'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => selectFile(suggestionIndex, file)}
                            className="flex-1 text-left"
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
                            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              <span>{file.folder_name}</span>
                              <span>{formatFileSize(file.size)}</span>
                              <span>{formatDate(file.modified)}</span>
                            </div>
                          </button>
                          <button
                            onClick={(e) => handlePreview(file, e)}
                            disabled={previewingFile === file.path}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-50 transition-colors flex-shrink-0"
                            title="Preview file"
                          >
                            <Eye size={16} className={previewingFile === file.path ? 'animate-pulse' : ''} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {suggestion.matches.length > MAX_INITIAL_RESULTS && (
                    <button
                      onClick={() => toggleExpanded(suggestionIndex)}
                      className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 flex items-center gap-1 mt-2 transition-colors"
                    >
                      {expandedSuggestions.has(suggestionIndex) ? (
                        <>
                          <ChevronUp className="w-3 h-3" />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3 h-3" />
                          See {suggestion.matches.length - MAX_INITIAL_RESULTS} more file{suggestion.matches.length - MAX_INITIAL_RESULTS > 1 ? 's' : ''}
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
