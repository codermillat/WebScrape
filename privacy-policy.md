# Privacy Policy - Web Text Extractor

Last Updated: 2025-08-08

## Data Collection
- The extension does not collect, transmit, or sell personal data.
- All text extraction and processing occur locally in your browser.

## Data Storage
- Extracted content is kept in-memory within the extension popup only for your current session.
- User preferences (e.g., chosen save location) are stored using `chrome.storage.local` and, when available, a directory handle is stored in IndexedDB for your device only.

## Permissions
- `activeTab`: Access the current tab when you interact with the extension.
- `scripting`: Inject the content script into the current tab on demand.
- `downloads`: Save extracted files to your Downloads folder.
- `storage`: Remember your extension preferences.
- `host_permissions`: `http://*/*`, `https://*/*` to allow on-demand script injection to pages you choose.

## File System Access
If you choose a custom folder, the extension requests access to a directory using the File System Access API. This access is:
- Granted explicitly by you via a browser prompt
- Limited to the selected folder
- Revocable at any time by removing permissions or clearing site data

## Third Parties
- No data is sent to external servers or third parties.

## Contact
For questions or support, contact the developer of this extension.


