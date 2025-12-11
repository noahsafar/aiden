import React from 'react';

interface FloatingActionProps {
  onCompose?: () => void;
  onAICompose?: () => void;
  onQuickSearch?: () => void;
  onVoiceCompose?: () => void;
}

export const FloatingAction: React.FC<FloatingActionProps> = ({
  onCompose = () => {},
  onAICompose = () => {},
  onQuickSearch = () => {},
  onVoiceCompose = () => {}
}) => {
  return (
    <div className="fixed bottom-6 right-6 flex flex-col space-y-2">
      <button
        onClick={onVoiceCompose}
        className="bg-green-600 text-white rounded-full p-3 shadow-lg hover:bg-green-700 transition-colors"
        title="Voice Compose"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      </button>
      <button
        onClick={onQuickSearch}
        className="bg-blue-600 text-white rounded-full p-3 shadow-lg hover:bg-blue-700 transition-colors"
        title="Quick Search"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
      <button
        onClick={onAICompose}
        className="bg-purple-600 text-white rounded-full p-3 shadow-lg hover:bg-purple-700 transition-colors"
        title="AI Compose"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </button>
      <button
        onClick={onCompose}
        className="bg-indigo-600 text-white rounded-full p-4 shadow-lg hover:bg-indigo-700 transition-colors"
        title="Compose"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
};