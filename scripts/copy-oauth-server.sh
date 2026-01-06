#!/bin/bash
# Script to copy oauth_server.py to the Tauri app bundle and configure Info.plist after build

set -e

APP_BUNDLE="src-tauri/target/release/bundle/macos/Aiden.app"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"

echo "Configuring app bundle after build..."

# Create Resources directory if it doesn't exist
mkdir -p "$RESOURCES_DIR"

# Copy oauth_server.py to Resources
echo "Copying oauth_server.py to app bundle..."
cp oauth_server.py "$RESOURCES_DIR/oauth_server.py"
echo "Copied oauth_server.py to $RESOURCES_DIR/"

# Add NSAppTransportSecurity to Info.plist to allow HTTP localhost connections
echo "Adding NSAppTransportSecurity to Info.plist..."

# Use plutil to add the ATS settings
/usr/libexec/PlistBuddy -c "Delete :NSAppTransportSecurity" "$INFO_PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity dict" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains dict" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains:localhost dict" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains:localhost:NSExceptionAllowsInsecureHTTPLoads bool true" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains:localhost:NSIncludesSubdomains bool true" "$INFO_PLIST"

echo "Added NSAppTransportSecurity to Info.plist"

# Verify the plist is valid
plutil -lint "$INFO_PLIST"
echo "Info.plist is valid"

echo "Done!"
