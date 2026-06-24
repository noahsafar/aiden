import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { useEmailStore } from '@/stores/emailStore';
import { useCommitmentStore } from '@/stores/commitmentStore';
import { useChannelStore } from '@/stores/channelStore';
import { useChatStore } from '@/stores/chatStore';
import type { ActionSuggestion } from '@/lib/aidenBrain';

/**
 * Routes the small action suggestions produced across surfaces to real effects.
 * Keeping this in one place means every card (Today, Commitments, Relationships)
 * behaves consistently — "Reply" always opens the right thread, "Mark done"
 * always updates the commitment, etc.
 */
export function useAidenActions() {
  const navigate = useNavigate();
  const markDone = useCommitmentStore((s) => s.markDone);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
  const openCompose = useChatStore((s) => s.openCompose);

  return useCallback(
    (action: ActionSuggestion | { action: string; payload?: Record<string, unknown> }) => {
      const { action: type, payload = {} } = action;
      const emailId = payload.emailId as string | undefined;

      switch (type) {
        case 'open': {
          if (emailId) {
            navigate(`/today/email/${emailId}`, { state: { returnPath: '/today' } });
          }
          break;
        }
        case 'reply': {
          if (emailId) {
            navigate(`/today/email/${emailId}`, { state: { returnPath: '/today', autoReply: true } });
          }
          break;
        }
        case 'bump': {
          if (emailId) {
            const store = useEmailStore.getState();
            store.setCurrentFilter('inbox');
            navigate('/inbox', { state: { focusEmailId: emailId, intent: type } });
          } else {
            navigate('/inbox');
          }
          break;
        }
        case 'open_slack': {
          setActiveChannel('slack');
          navigate('/inbox', { state: { channel: 'slack', slackId: payload.id } });
          break;
        }
        case 'mark_done': {
          if (payload.commitmentId) markDone(payload.commitmentId as string);
          break;
        }
        case 'compose': {
          openCompose({
            to: (payload.to as string) || '',
            subject: (payload.subject as string) || '',
            body: (payload.body as string) || '',
            prompt: (payload.prompt as string) || undefined,
          });
          break;
        }
        case 'schedule': {
          navigate('/schedule', { state: { with: payload.to } });
          break;
        }
        case 'brief':
        case 'ask': {
          const q = (payload.q as string) || '';
          navigate(`/ask?q=${encodeURIComponent(q)}${payload.run ? '&run=1' : ''}`);
          break;
        }
        case 'person': {
          navigate('/relationships', { state: { focusEmail: payload.email } });
          break;
        }
        default:
          break;
      }
    },
    [navigate, markDone, setActiveChannel, openCompose],
  );
}
