declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleSignInResponse) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            config: {
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with';
              width?: number;
              shape?: 'rectangular' | 'pill' | 'square' | 'circle';
              logo_alignment?: 'left' | 'center';
            }
          ) => void;
          prompt: () => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }

  }
}

interface GoogleSignInResponse {
  credential: string;
  select_by: string;
}

export {};