/// <reference types="chrome"/>

/**
 * Global ambient declarations / shims for MV3 environment during migration.
 * Ensures the TypeScript compiler picks up @types/chrome without adding
 * explicit "types" array in tsconfig (keeps config minimal).
 */

export {};

declare global {
  // Minimal crypto.subtle presence (already in DOM lib, kept for clarity)
  interface Window {
    webTextExtractorContentScript?: boolean;
  }
}
