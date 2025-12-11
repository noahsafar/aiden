#!/usr/bin/env node

/**
 * Build script to replace OAuth placeholders in HTML files with actual values from .env
 * This allows the HTML files to be committed to version control without secrets
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read environment variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  const env = {};

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      // Skip comments and empty lines
      if (!line || line.startsWith('#')) return;

      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        // Remove surrounding quotes if present
        env[key] = value.replace(/^["']|["']$/g, '');
      }
    });
  } else {
    console.error('Error: .env file not found. Please create it from .env.example');
    process.exit(1);
  }

  return env;
}

// Replace placeholders in a file
function processFile(filePath, env) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace Google OAuth placeholders
  content = content.replace(/__GOOGLE_CLIENT_ID__/g, env.GOOGLE_CLIENT_ID || 'YOUR_CLIENT_ID_HERE');
  content = content.replace(/__GOOGLE_CLIENT_SECRET__/g, env.GOOGLE_CLIENT_SECRET_HTML || env.GOOGLE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE');

  fs.writeFileSync(filePath, content);
  console.log(`Processed: ${path.relative(__dirname, filePath)}`);
}

// Main execution
function main() {
  console.log('🔧 Replacing OAuth placeholders with secrets from .env...');

  const env = loadEnv();

  // Check if required variables are set
  if (!env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID.includes('your_google_client_id_here')) {
    console.error('Error: GOOGLE_CLIENT_ID not set in .env file');
    process.exit(1);
  }

  if (!env.GOOGLE_CLIENT_SECRET_HTML && !env.GOOGLE_CLIENT_SECRET) {
    console.error('Error: Neither GOOGLE_CLIENT_SECRET_HTML nor GOOGLE_CLIENT_SECRET set in .env file');
    process.exit(1);
  }

  // Process HTML files
  const files = [
    'simple.html',
    'callback.html',
    'test-oauth.html'
  ];

  files.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      processFile(filePath, env);
    } else {
      console.warn(`Warning: ${file} not found, skipping...`);
    }
  });

  console.log('✅ OAuth secrets have been injected into HTML files');
  console.log('\n⚠️  Remember: Do NOT commit the HTML files after running this script!');
  console.log('   The placeholders are only restored when you run "git restore".');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { loadEnv, processFile };