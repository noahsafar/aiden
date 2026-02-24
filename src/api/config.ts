/**
 * Centralized service URL configuration for microservices deployment.
 *
 * In dev mode (Tauri), these are unused — calls go through invoke().
 * In container / Minikube mode, Vite env vars override the defaults.
 */

export const EMAIL_SERVICE_URL =
  import.meta.env.VITE_EMAIL_SERVICE_URL || 'http://localhost:8081';

export const GENAI_SERVICE_URL =
  import.meta.env.VITE_GENAI_SERVICE_URL || 'http://localhost:8090';
