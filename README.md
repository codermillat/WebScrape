# Web Text Extractor with LLM Preprocessing 🚀

A powerful Chrome extension that extracts and preprocesses webpage content for LLM training and analysis. Features intelligent text cleaning, content categorization, and multiple output formats.

## ✨ Features

### 🔍 **Smart Text Extraction**
- Extracts visible content from any webpage
- Filters out navigation elements, ads, and duplicates
- Preserves meaningful content structure

### 🧠 **Advanced Text Preprocessing**
- **Remove Duplicates**: Eliminates repetitive content
- **URL/Email Cleaning**: Strips web artifacts and contact info
- **Stop Word Removal**: Filters common and web-specific stop words
- **Content Categorization**: Automatically identifies:
  - Institution/Organization info
  - Academic programs and courses
  - Faculty and staff details
  - Student testimonials
  - Contact information

### 📊 **Multiple Output Formats**
- **Raw Text**: Original extracted content
- **Clean Text**: Preprocessed and deduplicated
- **LLM Format**: Structured for language model training
- **JSON Format**: Machine-readable structured data

### ⚙️ **Customizable Processing**
- Toggleable preprocessing options
- Real-time format switching
- Compression ratio tracking
- Vocabulary diversity metrics

### 💾 **Smart File Management**
- **Custom save locations**: Choose any folder on your system
- **Downloads integration**: Seamless Chrome Downloads API support
- **File System Access**: Modern browser API for direct folder access
- **Persistent preferences**: Remembers your settings and save locations
- **Visual feedback**: Success notifications and error handling

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
1. After extracting text, click **"Settings"** ⚙️
2. Configure processing options:
   - ✅ Remove Duplicates
   - ✅ Remove URLs  
   - ✅ Remove Stop Words
   - ✅ Extract Sections
   - ✅ Extract Key Phrases
3. Select output format:
   - **Raw Text**: Unprocessed content
   - **Clean Text**: Basic cleaning applied
   - **LLM Format**: Structured for AI training
   - **JSON Format**: Structured data export

### Download Options
- **Text files**: `.txt` format for all text outputs
- **JSON files**: `.json` format for structured data
- **Smart naming**: Automatic filename generation based on content

## 💾 **NEW: Advanced File Saving**

### Save Location Options
- **Downloads Folder**: Default behavior - saves files to your Downloads folder
- **Custom Folder**: Choose any folder on your system for organized storage

### How to Use Custom Folders
1. Open the extension settings panel ⚙️
2. Change "Save Location" to "Choose Custom Folder"
3. Click **"Browse"** to select your preferred folder
4. All future downloads will save to your chosen location

### Browser Compatibility
- ✅ **Chrome 86+**: Full File System Access API support
- ✅ **Edge 86+**: Full File System Access API support  
- ⚠️ **Firefox/Safari**: Automatic fallback to Downloads folder

### Features
- **Persistent Preferences**: Remembers your chosen save location
- **Visual Feedback**: Success notifications when files are saved
- **Smart Fallbacks**: Works in all browsers with graceful degradation
- **Permission Control**: You control folder access permissions

## 📁 File Structure

```
WebScrape/
├── manifest.json          # Extension configuration
├── popup.html             # Extension popup interface
├── popup.css              # Styling for popup
├── popup.js               # Main popup logic
├── content.js             # Page content extraction
├── text-processor.js      # Text preprocessing engine
├── text_preprocessor.py   # Python preprocessing (optional)
├── process_sharda_text.py # Example processing script
├── requirements.txt       # Python dependencies
└── README.md             # This file
```

## 🤖 LLM Training Format

The LLM format provides structured output optimized for language model training:

```
INSTITUTION: University Name

OVERVIEW:
Main content overview and description...

ACADEMIC PROGRAMS:
List of courses, degrees, and programs...

FACULTY HIGHLIGHTS:
Professor names, departments, and expertise...

STUDENT TESTIMONIALS:
Student experiences and feedback...

CONTACT INFORMATION:
Address, phone, email details...

KEY TOPICS: keyword1, keyword2, keyword3...

CONTENT STATISTICS:
- Original length: 5,000 characters
- Processed length: 3,200 characters
- Unique tokens: 450
- Compression ratio: 64.0%
- Vocabulary diversity: 78.5%
```

## 📊 Processing Statistics

The extension provides detailed analytics:

- **Compression Ratio**: How much content was cleaned vs original
- **Vocabulary Diversity**: Percentage of unique words
- **Token Count**: Number of meaningful words extracted
- **Content Categories**: Automatically identified sections

## 🎛️ Advanced Configuration

### Processing Options

| Option | Description | Default |
|--------|-------------|---------|
| Remove Duplicates | Eliminate repetitive sentences | ✅ ON |
| Remove URLs | Strip web links and references | ✅ ON |
| Remove Numbers | Filter out numeric content | ❌ OFF |
| Remove Stop Words | Filter common words | ✅ ON |
| Extract Sections | Categorize content types | ✅ ON |
| Extract Key Phrases | Identify important topics | ✅ ON |

### Output Formats

| Format | Use Case | File Type |
|--------|----------|-----------|
| Raw | Original content preservation | `.txt` |
| Clean | General text processing | `.txt` |
| LLM | AI/ML model training | `.txt` |
| JSON | Data analysis & integration | `.json` |

## 🔧 Technical Implementation

### JavaScript Text Processing
- **Real-time processing** in the browser
- **Zero external dependencies** for core functionality
- **Memory-efficient** tokenization and filtering
- **Modular architecture** for easy customization

### Content Script Features
- **DOM traversal** with intelligent filtering
- **Visibility detection** to skip hidden content
- **Ad/navigation blocking** using heuristic patterns
- **Cross-origin safety** with proper permissions

### Processing Pipeline
1. **Raw Extraction**: Get all visible text from page
2. **Initial Cleaning**: Remove URLs, emails, phone numbers
3. **Duplicate Removal**: Filter repetitive content
4. **Tokenization**: Break text into meaningful units
5. **Stop Word Filtering**: Remove common/web words
6. **Section Extraction**: Categorize content types
7. **Key Phrase Identification**: Extract important topics
8. **Format Generation**: Create output in selected format

## 💡 Use Cases

### 📚 **Academic Research**
- Extract content from university websites
- Process course catalogs and faculty information
- Generate datasets for educational AI models

### 🤖 **LLM Training**
- Create clean training data from web content
- Structure text for specific domain models
- Generate prompt engineering datasets

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
3. Click reload button for the extension
4. Test changes on target websites

### Python Integration (Optional)
```bash
# Install Python dependencies
pip install -r requirements.txt

# Run preprocessing on extracted text
python process_sharda_text.py
```

## 🔒 Privacy & Security

- **Local Processing**: All text processing happens locally
- **No Data Collection**: Extension doesn't send data to external servers
- **Minimal Permissions**: Only requests necessary access rights
- **Content Security**: Follows Chrome extension security best practices

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
- Adjust processing options in settings
- Try different output formats
- Some dynamic content may not be captured

### Performance Tips
- Use "Clean Text" format for general use
- Use "LLM Format" for AI training purposes
- Use "JSON Format" for data analysis
- Enable fewer processing options for faster results

## 🔮 Future Enhancements

- [x] ~~Persistent settings storage~~ ✅ **COMPLETED**
- [x] ~~Custom save locations~~ ✅ **COMPLETED**
- [ ] Batch processing multiple pages
- [ ] Custom preprocessing rules
- [ ] Export to cloud storage services
- [ ] Advanced content filtering options
- [ ] Integration with LLM APIs for real-time analysis

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

This extension incorporates text preprocessing techniques inspired by research in:
- Natural Language Processing (NLP)
- Large Language Model training methodologies  
- Web content extraction best practices

---

**Ready to extract and preprocess web content for your LLM training? Install the extension and start processing! 🚀** 