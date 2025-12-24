# Aiden AI Email Automation

A Tauri-based desktop application for AI-powered email automation with Gmail integration.

## Features

- 📧 Gmail integration with OAuth2 authentication
- 🤖 AI-powered email processing and automation
- 💾 Local SQLite database for storing email data
- 🖥️ Cross-platform desktop app (macOS, Windows, Linux)
- 🔐 Secure token storage

## Prerequisites

### Required Software

1. **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
2. **Rust** - [Install here](https://rustup.rs/)
3. **Python 3** - Usually pre-installed on most systems
4. **Google Cloud Project** with Gmail API enabled

### Python Dependencies

Install the required Python packages:

```bash
pip3 install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client python-dotenv
```

## Environment Configuration

The application uses environment variables to securely manage OAuth credentials and API keys.

### 1. Set up Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file with your actual credentials:
   ```env
   # Google OAuth Configuration
   GOOGLE_CLIENT_ID=your-google-client-id-here.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-google-client-secret-here
   GOOGLE_CLIENT_SECRET_HTML=your-google-client-secret-here  # For HTML OAuth flows

   # Claude/Anthropic Configuration
   ANTHROPIC_API_KEY=your-anthropic-api-key-here

   # OpenAI Configuration (for AI email reply generation)
   OPENAI_API_KEY=your-openai-api-key-here
   ```

   **Important**: The `.env` file is included in `.gitignore` and will never be committed to version control.

### 2. Managing OAuth Secrets in HTML Files

The HTML OAuth files (`simple.html`, `callback.html`, `test-oauth.html`) use placeholders to keep secrets out of version control. To run the application:

#### For Development:
```bash
# Inject actual secrets from .env into HTML files
npm run inject-secrets

# Run the application normally
# (see "Running the Application" section)
```

#### Before Committing:
```bash
# Restore placeholders to avoid committing secrets
npm run restore-placeholders

# Now you can safely commit
git add .
git commit -m "Your commit message"
```

### 3. Setup Gmail API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API
4. Create OAuth 2.0 credentials:
   - **For the Python OAuth Server**: Create a "Desktop app" client ID
   - **For the HTML OAuth flow**: You can use the same credentials or create a "Web application" client ID
5. Copy the Client ID and Client Secret to your `.env` file

Note: The project no longer uses a separate `gmail_credentials.json` file. All credentials are managed through environment variables.

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd aiden-cp
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

3. Install Rust dependencies (automatic with Tauri):
   ```bash
   cd src-tauri
   cargo build
   cd ..
   ```

## Running the Application

### Prerequisites

Before running the application, ensure you've:
1. Set up your `.env` file with proper credentials
2. Injected secrets into HTML files (required for OAuth):
   ```bash
   npm run inject-secrets
   ```

### Method 1: Manual (3 Terminal Windows)

You need to run all three commands simultaneously in separate terminals:

**Terminal 1 - Frontend (Vite Dev Server):**
```bash
npm run dev
```

**Terminal 2 - Backend (Tauri):**
```bash
npm run tauri dev
```

**Terminal 3 - OAuth Server:**
```bash
python3 oauth_server.py
```

### Method 2: Using a Script

Create a script to run all services at once:

**macOS/Linux:** (`run.sh`)
```bash
#!/bin/bash
echo "Starting Aiden Email Automation..."

# Start frontend
npm run dev &
FRONTEND_PID=$!

# Start backend
npm run tauri dev &
BACKEND_PID=$!

# Start OAuth server
python3 oauth_server.py &
OAUTH_PID=$!

echo "All services started!"
echo "Frontend: http://localhost:1420"
echo "OAuth Server: http://localhost:8081"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for Ctrl+C
trap "kill $FRONTEND_PID $BACKEND_PID $OAUTH_PID" EXIT
wait
```

**Windows:** (`run.bat`)
```batch
@echo off
echo Starting Aiden Email Automation...

start "Frontend" cmd /k "npm run dev"
start "Backend" cmd /k "npm run tauri dev"
start "OAuth Server" cmd /k "python3 oauth_server.py"

echo All services started!
echo Frontend: http://localhost:1420
echo OAuth Server: http://localhost:8081
pause
```

Make the script executable (macOS/Linux):
```bash
chmod +x run.sh
```

Then run:
```bash
./run.sh
```

## Accessing the Application

- **Web Interface**: http://localhost:1420
- **Desktop App**: Will open automatically when Tauri starts
- **OAuth Server**: http://localhost:8081 (for authentication)

## First Time Setup

1. Run all three services as described above
2. Open the application (web or desktop)
3. Click "Sign in with Google"
4. A browser window will open for Google authentication
5. Approve the requested permissions
6. The app will save your credentials locally

## Troubleshooting

### Common Issues

1. **Port already in use**
   - Kill existing processes on ports 1420, 1421, or 8081
   - Or change the ports in the configuration files

2. **Authentication fails**
   - Ensure `gmail_credentials.json` is in the root directory
   - Check that the Gmail API is enabled in your Google Cloud Console
   - Verify the OAuth redirect URIs include `http://localhost:8081`

3. **Build errors**
   - Run `npm install` to refresh Node dependencies
   - Run `cargo clean` then rebuild Rust code
   - Ensure all prerequisites are installed

4. **Python OAuth server not working**
   - Check if Python 3 is installed: `python3 --version`
   - Install required packages: `pip3 install google-auth google-auth-oauthlib google-api-python-client`

### Reset Authentication

To reset Gmail authentication:
```bash
rm -f token.json
```

## Development

### Project Structure

```
aiden-cp/
├── src/                # React frontend
│   ├── components/     # UI components
│   ├── stores/         # State management
│   └── services/       # API services
├── src-tauri/          # Rust backend
│   ├── src/           # Source code
│   └── Cargo.toml     # Rust dependencies
├── oauth_server.py     # Python OAuth server
├── simple.html         # OAuth login page (with placeholders)
├── callback.html       # OAuth callback handler (with placeholders)
├── test-oauth.html     # OAuth test page (with placeholders)
├── build-secrets.js    # Script to inject secrets into HTML files
├── restore-placeholders.js # Script to restore placeholders
├── .env                # Environment variables (DO NOT COMMIT)
└── .env.example        # Example environment variables
```

### Available Scripts

- `npm run inject-secrets` - Replace placeholders in HTML files with actual secrets from `.env`
- `npm run restore-placeholders` - Restore placeholders in HTML files for safe committing

### Build for Production

```bash
# Build frontend
npm run build

# Build Tauri app
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

## License

[Add your license here]

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues and questions:
- Create an issue on GitHub
- Check the troubleshooting section above
