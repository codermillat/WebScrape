# 🐛 Debugging Guide - "Could not establish connection" Error

## ✅ **Error Fixed!**

The main issue was in `manifest.json` - the `text-processor.js` file was incorrectly included in the content scripts array, which caused conflicts.

## 🔧 **What Was Fixed**

### 1. **Manifest Content Scripts**
**Before (Broken):**
```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["text-processor.js", "content.js"],  // ❌ Wrong!
    "run_at": "document_end"
  }
]
```

**After (Fixed):**
```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["content.js"],  // ✅ Correct!
    "run_at": "document_end"
  }
]
```

### 2. **Enhanced Error Handling**
- Added automatic content script injection
- Added connection timeout handling
- Better error messages for different scenarios
- Added debugging logs

### 3. **Connection Testing**
- Added ping/pong mechanism to test content script connectivity
- Console logging for debugging

## 🧪 **Testing the Fix**

### Step 1: Reload the Extension
1. Go to `chrome://extensions/`
2. Find "Web Text Extractor"
3. Click the **refresh/reload** button 🔄

### Step 2: Test on a Website
1. Go to any regular website (e.g., `https://example.com`)
2. Open the extension
3. Click **"Extract Text"**
4. Should work without errors!

### Step 3: Check Console (For Debugging)
1. Right-click on the extension popup → **Inspect**
2. Go to **Console** tab
3. You should see:
   ```
   Popup initialized
   Testing connection to tab: https://example.com
   Connection test response: {success: true, message: "Content script is ready"}
   ```

## 🚫 **Pages That Won't Work (By Design)**

These pages are restricted by Chrome security:

- ❌ `chrome://` pages (like `chrome://extensions/`)
- ❌ `chrome-extension://` pages
- ❌ `file://` local files
- ❌ `about:` pages
- ❌ Chrome Web Store pages

**Expected behavior**: Clear error message explaining the restriction.

## 🎯 **Testing Checklist**

### ✅ **Should Work On:**
- Regular websites (`https://example.com`)
- News sites (`https://bbc.com`)
- University websites (`https://stanford.edu`)
- Blog posts and articles
- Most public websites

### ❌ **Won't Work On:**
- Chrome system pages
- Local HTML files
- Extension pages
- PDF files (use Chrome's built-in PDF text selection instead)

## 🔍 **Advanced Debugging**

### Check Content Script Loading
1. Open any website
2. Press `F12` to open DevTools
3. Go to **Console** tab
4. Look for: `"Web Text Extractor content script loaded on: [URL]"`

### Check Message Passing
1. Open extension popup
2. Right-click popup → **Inspect**
3. In popup console, run: `testConnection()`
4. Should return `true` if working

### Manual Content Script Injection Test
In the popup console, run:
```javascript
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    files: ['content.js']
  }, () => {
    console.log('Content script manually injected');
  });
});
```

## 📊 **Error Messages Explained**

| Error Message | Cause | Solution |
|---------------|--------|----------|
| "Content script not loaded" | Connection failed | Refresh page, try again |
| "Chrome system pages...restricted" | Trying to extract from chrome:// | Use on regular websites |
| "Message timeout" | Page slow to respond | Wait, then try again |
| "No visible text found" | Empty/no content page | Try different page |
| "Failed to inject content script" | Permission issue | Refresh page |

## 🎉 **Success Indicators**

When working correctly, you should see:
1. **Loading spinner** when clicking "Extract Text"
2. **Text appears** in the text area
3. **Word/character counts** update
4. **No error messages**
5. **Download button** works

## 🆘 **Still Having Issues?**

### Quick Reset:
1. Go to `chrome://extensions/`
2. **Remove** the extension
3. **Reload** the extension folder
4. **Test** on `https://example.com`

### Check Browser Console:
1. Open any website
2. Press `F12`
3. Look for **red error messages**
4. Check if content script loads: `"Web Text Extractor content script loaded"`

---

**🎊 The extension should now work perfectly! The content script injection fix resolves the "Could not establish connection" error.** 🚀 