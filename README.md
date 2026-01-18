# Premium Beauty News Scraper

A Playwright-based web scraper for extracting articles from Premium Beauty News industry-buzz section.

## Features

- ✅ Scrapes articles from the industry-buzz page
- ✅ Handles pagination automatically
- ✅ Filters articles by date range
- ✅ Extracts article content, dates, images, and metadata
- ✅ Saves results to JSON file
- ✅ Respectful scraping with delays between requests

## Installation

1. Install Node.js (v14 or higher)

2. Install dependencies:
```bash
npm install
```

3. Install Playwright browsers:
```bash
npx playwright install chromium
```

**If you get a permission error**, try:
```bash
npx playwright install chromium --with-deps
```

Or install system-wide:
```bash
npm install -g playwright
playwright install chromium
```

## Usage

### Basic Usage

Run the scraper with default settings:
```bash
npm start
```

### Customize Date Range and Timeout

Edit `scraper.js` and modify the `options` object in the `main()` function:

```javascript
const options = {
  startDate: '2026-01-14',  // Start date (YYYY-MM-DD) or null
  endDate: '2026-01-16',    // End date (YYYY-MM-DD) or null
  outputFile: 'scraped_articles.json',
  pageTimeout: 120000  // Page load timeout in milliseconds (default: 120000 = 2 minutes)
};
```

**Note:** If pages are taking too long to load, increase the `pageTimeout` value (e.g., `180000` for 3 minutes, `300000` for 5 minutes).

### Disable Date Filtering

To scrape all articles regardless of date:
```javascript
const options = {
  startDate: null,
  endDate: null,
  outputFile: 'scraped_articles.json'
};
```

## Output

The scraper saves results to `scraped_articles.json` with the following structure:

```json
[
  {
    "href": "https://www.premiumbeautynews.com/en/article-url",
    "title": "Article Title",
    "description": "Article description...",
    "image": "image-url.jpg",
    "datetime": "2026-01-16 19:32:27",
    "dateText": "16 January 2026",
    "photoCredit": "Premium Beauty News (Photo: © ...)",
    "content": "Full article content...",
    "url": "https://www.premiumbeautynews.com/en/article-url",
    "scrapedAt": "2026-01-16T20:00:00.000Z"
  }
]
```

## Configuration

You can modify the scraper behavior by editing the `PremiumBeautyScraper` class:

- `headless: false` - Set to `true` to run in headless mode (faster, no browser window)
- `pageTimeout: 120000` - Page load timeout in milliseconds (increase if pages load slowly)
- The scraper uses `waitUntil: 'load'` for faster page loading (instead of 'networkidle')
- Automatic retry logic for failed page loads (3 retries for listing page, 2 for article pages)
- Delay between article requests (1 second) to be respectful to the server

## Troubleshooting

### Pages Taking Too Long to Load

If you encounter timeout errors:

1. **Increase the timeout**: Set `pageTimeout` to a higher value (e.g., `300000` for 5 minutes)
2. **Check your internet connection**: Slow connections may require longer timeouts
3. **Run in headless mode**: Set `headless: true` in the `init()` method for potentially faster execution
4. **Check if the website is accessible**: The site might be down or blocking requests

## Notes

- The scraper automatically handles cookie consent banners
- It includes delays between requests to be respectful to the server
- Pagination is handled automatically
- Only articles within the specified date range are saved
- Uses faster `load` event instead of `networkidle` for better performance
- Includes automatic retry logic for failed requests
- Waits for specific selectors to ensure content is loaded before scraping
- Checks article dates first before extracting full content for efficiency

## Requirements

- Node.js 14+
- Playwright
- Internet connection
