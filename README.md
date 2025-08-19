# Web Text Extractor for Educational Research

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Used By: SetForge Pipeline](https://img.shields.io/badge/Used%20By-SetForge%20Pipeline-blueviolet)](https://github.com/codermillat/SetForge)
[![Generates: Hugging Face Dataset](https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Dataset-blue)](https://huggingface.co/datasets/millat/indian_university_guidance_for_bangladeshi_students)

This Chrome extension is a specialized tool developed as part of a research project focused on creating a highly contextual Question & Answer (Q&A) dataset for Bangladeshi students planning to study in India. The initial research targets four key universities: **Sharda University**, **Noida International University (NIU)**, **Amity University**, and **Galgotias University**.

The primary function of this tool is to extract and preprocess web content into clean `.txt` files, which will serve as the foundation for generating a Q&A dataset to train or fine-tune Large Language Models (LLMs).

This project is open-source under the MIT License. The repository is available at: [https://github.com/codermillat/WebScrape](https://github.com/codermillat/WebScrape)

## 🏆 Showcase: Powering the SetForge Research Project

This extension served as the primary data collection tool for the **[SetForge](https://github.com/codermillat/SetForge)** research project, a sophisticated, multi-stage pipeline that transforms raw web data into a high-quality, instruction-formatted dataset.

The data gathered using WebScrape was instrumental in generating the **[Indian University Guidance for Bangladeshi Students](https://huggingface.co/datasets/millat/indian_university_guidance_for_bangladeshi_students)** dataset, now publicly available on the Hugging Face Hub.

## ✨ Features

### 🔍 **Smart Text Extraction**
- Extracts visible and dynamically-loaded content from any webpage
- **NEW**: In-page "Sider" UI for multi-capture sessions and persistent data management
- **NEW**: Extracts text from embedded and directly-viewed PDF files via `pdf.js`
- Filters out navigation elements, ads, and other boilerplate content
- Preserves meaningful content structure through DOM-ordered extraction

### 🧠 **Advanced Text Preprocessing**
- **Remove Duplicates**: Eliminates repetitive content using line- and sentence-level analysis
- **URL/Email Cleaning**: Strips web artifacts and contact information
- **Stop Word Removal**: Filters common English and web-specific stop words
- **Content Categorization**: Automatically identifies and structures:
  - Institution/Organization information
  - Academic programs, courses, and fee structures
  - Faculty and staff details (heuristic)
  - Student testimonials (heuristic)
  - Contact information

### 📊 **Multiple Output Formats**
- **Raw Text**: Original extracted content, minimally processed
- **Clean Text**: Preprocessed and deduplicated for general use
- **JSON Format**: Machine-readable structured data including metadata and categorized sections
- **Full-Page Structured Extract**: Human-readable `.txt` with labeled sections (Title, Metadata, Headings, Paragraphs, Lists, Tables, Links, Images)

### ⚙️ **Customizable Processing**
- Toggleable preprocessing options for fine-grained control
- Real-time format switching in the popup UI
- **NEW**: Advanced options for excluding boilerplate, including hidden elements, and managing metadata

### 💾 **Smart File Management**
- **Persistent Sessions**: Captures are stored locally using IndexedDB for persistence across browser sessions
- **Downloads Integration**: Seamlessly saves extracted files via the Chrome Downloads API
- **Smart Naming**: Automatic filename generation based on page title and domain
- **Visual Feedback**: Success notifications and clear error handling

## 🚀 Installation

1. **Download the extension files**
2. **Open Chrome and go to** `chrome://extensions/`
3. **Enable "Developer mode"** (top right toggle)
4. **Click "Load unpacked"** and select the extension folder
5. **Pin the extension** to your toolbar for easy access

## 🎯 Usage

### Basic Text Extraction
1. Navigate to any webpage
2. Click the extension icon
3. Click **"Extract Text"**
4. Copy or download the extracted content

### Advanced Preprocessing
1. After extracting text, click the **Settings** icon in the popup or open the in-page Sider UI.
2. Configure processing options:
   - ✅ Remove Duplicates
   - ✅ Remove URLs/Emails
   - ✅ Remove Stop Words
   - ✅ Extract Sections
   - ✅ Extract Key Phrases
3. Select output format:
   - **Raw Text**: Unprocessed content
   - **Clean Text**: Basic cleaning applied
   - **JSON Format**: Structured data export

### Download Options
- **Text files**: `.txt` format for all text outputs
- **JSON files**: `.json` format for structured data
- **Smart naming**: Automatic filename generation based on page content and domain.

## 💾 **NEW: Advanced In-Page Sider UI**

This extension now includes a powerful in-page "Sider" UI for managing complex data collection tasks.

### How to Use the Sider UI
1. Press **Ctrl+Shift+E** (or **Cmd+Shift+E** on Mac) to toggle the Sider UI on any webpage.
2. Click **"Add"** to capture the current page's content. Assign a label for easy identification.
3. The captured content is added to a persistent list, grouped by domain.
4. Select multiple captures from different pages and download them as a single, cleaned `.txt` file.

### Sider Features
- **Persistent Captures**: All captured data is saved locally using IndexedDB, so it persists even if you close the tab or browser.
- **Session Management**: Group captures by domain for organized data collection.
- **Bulk Downloading**: Select and download multiple captures at once.
- **Duplicate Prevention**: Automatically ignores duplicate content captures.
- **Targeted Cleanup**: Clear all captures for a specific site or remove individual items.

## 📁 File Structure

```
WebScrape/
├── manifest.json       # Extension configuration (MV3)
├── popup.html          # Extension popup interface
├── popup.css           # Styling for popup
├── popup.js            # Main popup logic
├── content.js          # In-page Sider UI and content extraction
├── text-processor.js   # Advanced text preprocessing engine
├── background.js       # Service worker for downloads and PDF extraction
├── options.html        # Options page for extraction settings
├── options.js          # Logic for options page
├── lib/                # Contains pdf.js library
├── icons/              # Extension icons
├── README.md           # This file
└── privacy-policy.md   # Privacy policy
```

## 🤖 LLM Training Format

The **JSON Format** provides structured output that can be easily adapted for language model training:

```json
{
  "metadata": {
    "processed_at": "2023-10-27T10:00:00.00Z",
    "stats": {
      "originalLength": 5000,
      "processedLength": 3200,
      "compressionRatio": 0.64,
      "tokenCount": 450,
      "uniqueTokens": 350,
      "vocabularyDiversity": 0.77
    }
  },
  "content": {
    "sections": {
      "title": "University Name",
      "main_content": "Main content overview...",
      "programs": "List of courses...",
      "faculty": "Professor names...",
      "testimonials": "Student feedback...",
      "contact_info": "Address, phone, email...",
      "fee_tables": "Course fees..."
    },
    "key_phrases": ["keyword1", "keyword2"],
    "processed_text": "The full cleaned text..."
  }
}
```

## 📊 Processing Statistics

The extension provides detailed analytics:

- **Compression Ratio**: How much content was cleaned vs original
- **Vocabulary Diversity**: Percentage of unique words
- **Token Count**: Number of meaningful words extracted
- **Content Categories**: Automatically identified sections

## 🎛️ Advanced Configuration

### Processing Options

| Option                  | Description                                                  | Default |
|-------------------------|--------------------------------------------------------------|---------|
| Remove Duplicates       | Eliminate repetitive sentences and lines                     | ✅ ON   |
| Remove URLs             | Strip web links and email addresses                          | ✅ ON   |
| Remove Numbers          | Filter out numeric content                                   | ❌ OFF  |
| Remove Stop Words       | Filter common English and web-specific words                 | ✅ ON   |
| Include Hidden Elements | Include non-visible elements in extraction                   | ❌ OFF  |
| Auto-scroll Page        | Scroll to load lazy content before extraction                | ❌ OFF  |
| Full-Page Structured    | Extract full-page content into labeled sections              | ❌ OFF  |
| Exclude Boilerplate     | Skip header/nav/footer/ads when extracting                   | ❌ OFF  |
| Include Metadata        | Include meta description and Open Graph tags                 | ✅ ON   |
| Extract Sections        | Heuristically categorize content into sections               | ✅ ON   |
| Extract Key Phrases     | Identify important topics using n-grams                      | ✅ ON   |

### Output Formats

| Format      | Use Case                       | File Type |
|-------------|--------------------------------|-----------|
| Raw         | Original content preservation  | `.txt`    |
| Clean       | General text processing        | `.txt`    |
| JSON        | Data analysis & integration    | `.json`   |

## 🔧 Project Documentation

For a non-technical guide to the extension's workflow, please see:
*   **[A Guide to the Data Pipeline](docs/RESEARCH_PIPELINE.md)**

For a technical analysis of the codebase, including its current status and architectural observations, please see:
*   **[Project Analysis](docs/PROJECT_ANALYSIS.md)**

## 💡 Use Cases

### 📚 **Academic Research**
- Extract content from university websites, including course catalogs and fee structures
- Process academic papers and brochures in PDF format
- Generate clean datasets for educational AI models

### 🤖 **LLM Training**
- Create clean, structured training data from web content
- Generate prompt engineering datasets from curated web text
- Preprocess data for fine-tuning domain-specific language models

### 📊 **Content Analysis**
- Analyze website content quality
- Extract structured data from unstructured pages
- Monitor content changes over time

### 🔍 **Data Collection**
- Research competitor content
- Gather industry information
- Build knowledge bases from web sources

## 🛠️ Development

### Prerequisites
- Chrome/Chromium browser
- Basic understanding of Chrome extension development
- Optional: Python 3.7+ for advanced processing

### Local Development
1. Make changes to extension files
2. Go to `chrome://extensions/`
3. Click the reload button for the extension
4. Test changes on target websites

### Python Integration
Not applicable in this repository. Previous references to Python helper scripts have been removed for accuracy.

## 🔒 Privacy & Security

- **Local Processing**: All text processing happens locally in your browser.
- **No Data Collection**: The extension does not send your data to any external servers.
- **Minimal Permissions**: Only requests access rights necessary for its core functionality.
- **Content Security**: Follows modern Chrome extension security best practices (Manifest V3).

See: `privacy-policy.md`

## 🐛 Troubleshooting

### Common Issues

**Extension not working on some pages**
- Chrome system pages (`chrome://`) are not accessible
- Some sites block content script injection
- Try refreshing the page and re-extracting

**Settings not saving**
- Settings are session-based for privacy
- Configure options each time you open the extension

**Poor extraction quality**
- Adjust processing options in the popup or Sider UI
- Try different output formats
- Some complex, JavaScript-heavy sites may not be fully captured

### Performance Tips
- Use "Clean Text" format for general use
- Use "JSON Format" for structured data analysis
- Disable computationally intensive options (like key phrase extraction) for faster results

## 🔮 Future Enhancements

- [x] ~~Persistent settings storage~~ ✅ **COMPLETED**
- [ ] Batch processing multiple pages from a list of URLs
- [ ] Custom preprocessing rules (e.g., regex-based filters)
- [ ] Export to cloud storage services (e.g., Google Drive)
- [ ] Advanced content filtering options (e.g., by word count)
- [ ] **NEW**: In-page annotation and labeling for supervised learning datasets

## 📄 License

This project is open source and available under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 🙏 Acknowledgments

This project would not be possible without the incredible work of the open-source community. We extend our sincere gratitude to:

-   **The Mozilla `pdf.js` Team**: For creating and maintaining the powerful `pdf.js` library, which enables robust text extraction from PDF documents directly in the browser. Their work is fundamental to this extension's ability to process academic documents and brochures.

This extension also incorporates text preprocessing techniques inspired by established research in Natural Language Processing (NLP) and web content extraction best practices.

---

**This tool is dedicated to the goal of making educational information more accessible through technology. 🚀**
