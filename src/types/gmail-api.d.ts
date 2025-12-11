// Types for Google Gmail API
declare global {
  interface Window {
    gapi: any;
  }
}

declare const gapi: {
  client: {
    init: (config: {
      apiKey?: string;
      clientId?: string;
      discoveryDocs?: string[];
      scope?: string;
    }) => Promise<void>;
    gmail: {
      users: {
        messages: {
          list: (params: {
            userId: string;
            maxResults?: number;
            q?: string;
            pageToken?: string;
          }) => Promise<{
            result: {
              messages?: Array<{
                id: string;
                threadId: string;
              }>;
              nextPageToken?: string;
              resultSizeEstimate?: number;
            };
          }>;
          get: (params: {
            userId: string;
            id: string;
            format?: string;
            metadataHeaders?: string[];
          }) => Promise<{
            result: {
              id: string;
              threadId: string;
              labelIds?: string[];
              snippet?: string;
              sizeEstimate?: number;
              payload?: {
                headers?: Array<{
                  name?: string;
                  value?: string;
                }>;
                parts?: Array<any>;
                mimeType?: string;
                body?: {
                  data?: string;
                  size?: number;
                };
              };
              internalDate?: string;
              historyId?: string;
            };
          }>;
        };
      };
    };
  };
  load: (libraries: string) => void;
};

export {};