import { MessageSquare, X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useState, useEffect } from 'react';

export function ChatTrigger() {
  const { isOpen, openChat, closeChat } = useChatStore();
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Show trigger when hovering near the right edge
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const threshold = 50; // pixels from right edge
      const distanceFromRight = window.innerWidth - e.clientX;

      if (distanceFromRight < threshold) {
        setIsVisible(true);
      } else if (distanceFromRight > 100) {
        setIsVisible(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Also show on Cmd+J keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        setIsVisible(true);
        // Hide after a delay if it was opened via keyboard
        setTimeout(() => {
          if (!isOpen) {
            setIsVisible(false);
          }
        }, 2000);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleClick = () => {
    if (isOpen) {
      closeChat();
    } else {
      openChat();
    }
  };

  return (
    <div
      className={`fixed right-0 top-1/2 -translate-y-1/2 z-50 transition-all duration-200 ${
        isVisible || isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`relative transition-all duration-200 ${
          isHovered || isOpen ? 'w-12' : 'w-2'
        }`}
      >
        {/* Tab that expands on hover */}
        <button
          onClick={handleClick}
          className="h-16 bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 rounded-l-lg shadow-lg flex items-center justify-center transition-all duration-200"
          style={{
            width: isHovered || isOpen ? '48px' : '8px',
          }}
          title={`AI Assistant (${isOpen ? 'Cmd+J to close' : 'Cmd+J to open'})`}
        >
          {isHovered || isOpen ? (
            isOpen ? (
              <X className="w-5 h-5 text-white" />
            ) : (
              <MessageSquare className="w-5 h-5 text-white" />
            )
          ) : null}
        </button>

        {/* Tooltip */}
        {isHovered && !isOpen && (
          <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded whitespace-nowrap">
            AI Assistant (Cmd+J)
          </div>
        )}
      </div>
    </div>
  );
}
