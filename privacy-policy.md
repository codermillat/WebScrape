# Privacy Policy - Web Text Extractor

Last Updated: 2025-08-09

## Data Collection
- The extension does not collect, transmit, or sell personal data.
- All text extraction and processing occur locally in your browser by default.

## Data Storage
- Extracted content is kept in-memory within the extension popup only for your current session.
- User preferences (e.g., chosen save location, feature toggles) are stored using `chrome.storage.local` and, when available, a directory handle is stored in IndexedDB for your device only.
- API keys that you enter for optional AI features are stored only in `chrome.storage.local` on your device.

## Permissions
- `activeTab`: Access the current tab when you interact with the extension.
- `scripting`: Inject the content script into the current tab on demand.
- `downloads`: Save extracted files to your Downloads folder.
- `storage`: Remember your extension preferences.
  
Note: No broad host permissions are requested. Content script injection occurs only on user action (via `activeTab` + `scripting`).

## File System Access
If you choose a custom folder, the extension requests access to a directory using the File System Access API. This access is:
- Granted explicitly by you via a browser prompt
- Limited to the selected folder
- Revocable at any time by removing permissions or clearing site data

## Third Parties
- No data is sent to external servers or third parties unless you enable AI features and provide API keys.
- When AI features are enabled and you consent, the extension may send extracted text and optional structured tables to:
  - Google Generative Language API: `https://generativelanguage.googleapis.com`
  - DigitalOcean Inference: `https://inference.do-ai.run`
  The content sent includes only the text you extracted from the current page (and optional table summaries) to organize/clean the data.

You can disable AI features or revoke consent at any time in the extension settings/options.

## Contact
For questions or support, contact the developer of this extension.


