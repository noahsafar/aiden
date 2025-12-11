#!/usr/bin/env node

/**
 * Restore placeholders in HTML files (removes secrets)
 * This reverts the files to their placeholder state for safe committing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Restore placeholders in a file
function restoreFilePlaceholders(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace actual values with placeholders

  // Match and replace Google client IDs in const declarations
  content = content.replace(
    /const CLIENT_ID = '\d+-[\w-]+\.apps\.googleusercontent\.com';/g,
    "const CLIENT_ID = '__GOOGLE_CLIENT_ID__';"
  );

  // Match and replace Google client IDs in <code> tags
  content = content.replace(
    /<code>\d+-[\w-]+\.apps\.googleusercontent\.com<\/code>/g,
    '<code>__GOOGLE_CLIENT_ID__</code>'
  );

  // Match and replace Google client IDs assigned to variables
  content = content.replace(
    /const CLIENT_ID = '\d+-[\w-]+\.apps\.googleusercontent\.com'/g,
    "const CLIENT_ID = '__GOOGLE_CLIENT_ID__'"
  );

  // Match and replace Google client secrets in const declarations
  content = content.replace(
    /const CLIENT_SECRET = 'GOCSPX-[A-Za-z0-9_-]+';/g,
    "const CLIENT_SECRET = '__GOOGLE_CLIENT_SECRET__';"
  );

  // Match and replace Google client secrets in client_secret fields
  content = content.replace(
    /client_secret: 'GOCSPX-[A-Za-z0-9_-]+',/g,
    "client_secret: '__GOOGLE_CLIENT_SECRET__',"
  );

  fs.writeFileSync(filePath, content);
  console.log(`Restored placeholders: ${path.relative(__dirname, filePath)}`);
}

// Main execution
function main() {
  console.log('🔄 Restoring placeholders in HTML files...');

  // Process HTML files
  const files = [
    'simple.html',
    'callback.html',
    'test-oauth.html'
  ];

  files.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      restoreFilePlaceholders(filePath);
    } else {
      console.warn(`Warning: ${file} not found, skipping...`);
    }
  });

  console.log('✅ Placeholders have been restored');
  console.log('\n✅ Files are now safe to commit to Git');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}