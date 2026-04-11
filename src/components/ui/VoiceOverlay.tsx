import React from 'react';
import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface VoiceOverlayProps {
  isListening: boolean;
  transcript: string;
  onStop: () => void;
  isProcessing: boolean;
}

export function VoiceOverlay({ isListening, transcript, onStop, isProcessing }: VoiceOverlayProps) {
  if (!isListening && !isProcessing) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
      <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-2xl shadow-elevated-lg border border-gray-200 dark:border-gray-700 px-4 py-3 min-w-[280px] max-w-[480px]">
        <div className="flex-shrink-0">
          <Mic className="h-5 w-5 text-red-500 animate-voice-pulse" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-red-500 mb-0.5">
            {isProcessing ? 'Processing...' : 'Listening...'}
          </div>
          <div className="text-sm text-foreground truncate">
            {transcript || 'Say a command...'}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 hover:bg-red-50 dark:hover:bg-red-900/20"
          onClick={onStop}
        >
          <Square className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>
    </div>
  );
}
