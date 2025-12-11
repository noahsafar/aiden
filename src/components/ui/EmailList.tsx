import React from 'react';

interface EmailListProps {
  emails?: any[];
  selectedEmailId?: string | null;
  onEmailSelect?: (id: string) => void;
  onEmailAction?: (id: string, action: string) => void;
}

export const EmailList: React.FC<EmailListProps> = ({
  emails = [],
  selectedEmailId = null,
  onEmailSelect = () => {},
  onEmailAction = () => {}
}) => {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-2">
        {emails.length > 0 ? emails.map((email: any) => (
          <div
            key={email.id}
            className={`p-4 bg-surface dark:bg-gray-800 border rounded-lg hover:shadow-md transition-shadow cursor-pointer ${
              selectedEmailId === email.id ? 'border-blue-500 dark:border-blue-400' : 'border-border'
            }`}
            onClick={() => onEmailSelect(email.id)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{email.subject}</h3>
                <p className="text-sm text-muted mt-1">{email.preview}</p>
              </div>
              <span className="text-xs text-muted">{email.timestamp}</span>
            </div>
          </div>
        )) : (
          <div className="p-4 bg-surface dark:bg-gray-800 border rounded-lg border-border">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Sample Email</h3>
                <p className="text-sm text-muted mt-1">This is a preview of an email...</p>
              </div>
              <span className="text-xs text-muted">2:30 PM</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};