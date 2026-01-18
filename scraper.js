const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * Premium Beauty News Scraper
 * Scrapes articles from industry-buzz section with date filtering
 */
class PremiumBeautyScraper {
  constructor(options = {}) {
    this.baseUrl = 'https://www.premiumbeautynews.com';
    this.startDate = options.startDate || null; // Format: '2026-01-01'
    this.endDate = options.endDate || null;     // Format: '2026-01-31'
    this.outputFile = options.outputFile || 'scraped_articles.json';
    this.pageTimeout = options.pageTimeout || 120000; // 2 minutes default
    this.browser = null;
    this.page = null;
    this.scrapedArticles = [];
  }

  async init() {
    console.log('Launching browser...');
    this.browser = await chromium.launch({ 
      headless: false, // Set to true for headless mode
      // Removed slowMo for faster execution
    });
    
    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      // Increase default timeout for all operations
      timeout: this.pageTimeout
    });
    
    this.page = await context.newPage();
    
    // Set longer default timeout for page operations
    this.page.setDefaultTimeout(this.pageTimeout);
    this.page.setDefaultNavigationTimeout(this.pageTimeout);
    
    // Handle cookie consent if it appears
    this.page.on('dialog', async dialog => {
      await dialog.accept();
    });
  }

  async acceptCookies() {
    try {
      // Wait for cookie banner and accept if present
      const acceptButton = await this.page.$('text=accept');
      if (acceptButton) {
        await acceptButton.click();
        await this.page.waitForTimeout(1000);
        console.log('Cookies accepted');
      }
    } catch (error) {
      // Cookie banner might not be present
      console.log('No cookie banner found or already accepted');
    }
  }

  /**
   * Scroll to the bottom of the page to trigger lazy-loaded content
   */
  async scrollToBottom() {
    try {
      console.log('Scrolling to bottom of page...');
      
      // Get the initial scroll height
      let previousHeight = 0;
      let currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
      
      // Keep scrolling until we reach the bottom
      while (previousHeight !== currentHeight) {
        previousHeight = currentHeight;
        
        // Scroll to bottom
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        
        // Wait for content to load
        await this.page.waitForTimeout(1500);
        
        // Get new scroll height
        currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
      }
      
      // Final scroll to ensure we're at the very bottom
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Wait a bit more for any final lazy-loaded content
      await this.page.waitForTimeout(1000);
      
      console.log('Finished scrolling to bottom');
    } catch (error) {
      console.log('Error during scroll:', error.message);
      // Continue anyway - scrolling is not critical
    }
  }

  /**
   * Parse date from datetime attribute
   */
  parseDate(dateString) {
    if (!dateString) return null;
    // Extract date from datetime attribute (e.g., "2026-01-16 19:32:27")
    const dateMatch = dateString.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      return new Date(dateMatch[1]);
    }
    return null;
  }

  /**
   * Check if date is within range
   */
  isDateInRange(articleDate) {
    if (!this.startDate && !this.endDate) {
      return true; // No date filter, accept all
    }

    if (!articleDate) {
      return false; // No date found, exclude
    }

    const articleDateObj = this.parseDate(articleDate);
    if (!articleDateObj) {
      return false;
    }

    if (this.startDate) {
      const startDateObj = new Date(this.startDate);
      if (articleDateObj < startDateObj) {
        return false;
      }
    }

    if (this.endDate) {
      const endDateObj = new Date(this.endDate);
      if (articleDateObj > endDateObj) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if article date is OLDER than startDate (before our range).
   * When true, we can STOP scraping - articles are ordered newest first,
   * so all subsequent articles will also be older than startDate.
   */
  isDateBeforeStartDate(articleDate) {
    if (!this.startDate || !articleDate) return false;
    const articleDateObj = this.parseDate(articleDate);
    if (!articleDateObj) return false;
    const startDateObj = new Date(this.startDate);
    return articleDateObj < startDateObj; // article is older than start
  }

  /**
   * Extract article links from the industry-buzz page with retry logic
   * Can optionally take an offset parameter for pagination
   */
  async extractArticleLinks(retries = 3, offset = 0) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Build URL with offset if provided
        let url = `${this.baseUrl}/en/industry-buzz/`;
        if (offset > 0) {
          url = `${this.baseUrl}/en/industry-buzz/?debut_rub_lastart=${offset}`;
        }
        
        console.log(`Extracting article links from industry-buzz page... (Attempt ${attempt}/${retries}, offset: ${offset})`);
        
        // Use 'load' instead of 'networkidle' for faster loading
        // 'load' waits for the load event, which is usually sufficient
        await this.page.goto(url, {
          waitUntil: 'load', // Changed from 'networkidle' to 'load' for faster execution
          timeout: this.pageTimeout
        });

        // Wait for the articles container to be visible
        try {
          await this.page.waitForSelector('.post-style1.col-md-6', { 
            timeout: 30000,
            state: 'visible' 
          });
        } catch (e) {
          console.log('Articles container not found, trying alternative selector...');
          // Try waiting for any article element
          await this.page.waitForSelector('.post-style1, .row', { timeout: 30000 });
        }

        await this.acceptCookies();
        
        // Scroll to bottom to load all lazy-loaded content
        await this.scrollToBottom();
        
        await this.page.waitForTimeout(1000);

        const articleLinks = await this.page.evaluate((baseUrl) => {
          const links = [];
          const articles = document.querySelectorAll('.post-style1.col-md-6');
          
          articles.forEach(article => {
            const h4Element = article.querySelector('h4 a');
            if (h4Element) {
              const href = h4Element.getAttribute('href');
              const title = h4Element.textContent.trim();
              const description = article.querySelector('p')?.textContent.trim() || '';
              let image = article.querySelector('img')?.getAttribute('src') || '';
              
              // Convert relative image URLs to absolute URLs
              if (image && !image.startsWith('http')) {
                if (image.startsWith('/')) {
                  image = `${baseUrl}${image}`;
                } else {
                  image = `${baseUrl}/${image}`;
                }
              }
              
              if (href) {
                links.push({
                  href: href.startsWith('http') ? href : `${baseUrl}/${href}`,
                  title,
                  description,
                  image
                });
              }
            }
          });
          
          return links;
        }, this.baseUrl);

        if (articleLinks.length > 0) {
          console.log(`Found ${articleLinks.length} articles on current page`);
          return articleLinks;
        } else if (attempt < retries) {
          console.log('No articles found, retrying...');
          await this.page.waitForTimeout(2000);
        }
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error.message);
        if (attempt < retries) {
          console.log(`Retrying in 3 seconds...`);
          await this.page.waitForTimeout(3000);
        } else {
          throw new Error(`Failed to extract article links after ${retries} attempts: ${error.message}`);
        }
      }
    }
    return [];
  }

  /**
   * Check if there are articles on the current page
   * If no articles found, we've reached the end
   */
  async hasNextPage() {
    try {
      // Check if there are articles on the current page
      const articleCount = await this.page.evaluate(() => {
        return document.querySelectorAll('.post-style1.col-md-6').length;
      });
      
      // If we found articles, there might be more pages
      // We'll check after scraping - if we get 0 articles, we stop
      return articleCount > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Navigate to next page by incrementing debut_rub_lastart parameter
   * Simple approach: increment by 10 each time (10, 20, 30, 40...)
   */
  async goToNextPage(currentOffset = 0) {
    try {
      // Calculate next offset (increment by 10)
      const nextOffset = currentOffset + 10;
      
      // Build the URL with the new offset
      const nextUrl = `${this.baseUrl}/en/industry-buzz/?debut_rub_lastart=${nextOffset}`;
      
      console.log(`\n➡️  Navigating to next page (offset ${nextOffset}): ${nextUrl}`);
      
      // Navigate directly to the URL
      await this.page.goto(nextUrl, { 
        waitUntil: 'load', 
        timeout: this.pageTimeout 
      });
      
      console.log('   ✓ Page loaded successfully');
      
      // Wait for articles to be visible
      let articlesFound = false;
      for (let i = 0; i < 5; i++) {
        try {
          await this.page.waitForSelector('.post-style1.col-md-6', { 
            timeout: 8000,
            state: 'visible' 
          });
          articlesFound = true;
          break;
        } catch (e) {
          if (i < 4) {
            console.log(`   Waiting for articles to load... (attempt ${i + 1}/5)`);
            await this.page.waitForTimeout(1500);
          }
        }
      }
      
      if (!articlesFound) {
        console.log('   ⚠ No articles found on this page - reached end');
        return false;
      }
      
      // Scroll to bottom to load all lazy-loaded content
      await this.scrollToBottom();
      
      await this.page.waitForTimeout(1000);
      return true;
    } catch (error) {
      console.error('   ❌ Error navigating to next page:', error.message);
      return false;
    }
  }

  /**
   * Extract article content from individual article page with retry logic
   * Now checks date FIRST before extracting full content
   */
  async extractArticleContent(articleLink, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Checking article: ${articleLink.title} (Attempt ${attempt}/${retries})`);
        
        // Navigate to article page
        await this.page.goto(articleLink.href, {
          waitUntil: 'load',
          timeout: this.pageTimeout
        });

        // Wait for header with date to be visible (faster than waiting for full article)
        try {
          await this.page.waitForSelector('header.sub-header span[datetime]', { 
            timeout: 20000, 
            state: 'visible' 
          });
        } catch (e) {
          // Try alternative selectors
          await this.page.waitForSelector('header.sub-header, .sub-header', { timeout: 20000 });
        }

        await this.page.waitForTimeout(500); // Small wait for date to be available

        // FIRST: Extract and check the date BEFORE doing expensive content extraction
        const dateInfo = await this.page.evaluate(() => {
          const dateElement = document.querySelector('header.sub-header span[datetime]');
          const datetime = dateElement ? dateElement.getAttribute('datetime') : null;
          const dateText = dateElement ? dateElement.textContent.trim() : null;
          return { datetime, dateText };
        });
        
        if (!dateInfo || !dateInfo.datetime) {
          console.log(`⚠ Could not extract date for article. Skipping...`);
          return null;
        }

        // OPTIMIZATION: If article is OLDER than startDate, STOP - all subsequent articles will be older too
        if (this.isDateBeforeStartDate(dateInfo.datetime)) {
          console.log(`🛑 Article date ${dateInfo.datetime} (${dateInfo.dateText}) is BEFORE start date (${this.startDate}). Stopping - no need to check older articles.`);
          return { stop: true }; // Signal to break and return scraped articles
        }

        // Check if date is within range (e.g., after endDate - skip but continue)
        if (!this.isDateInRange(dateInfo.datetime)) {
          console.log(`⏭ Article date ${dateInfo.datetime} (${dateInfo.dateText}) is OUTSIDE the specified range [${this.startDate || 'no start'} to ${this.endDate || 'no end'}]. Skipping...`);
          return null;
        }

        console.log(`✓ Article date ${dateInfo.datetime} (${dateInfo.dateText}) is WITHIN range. Extracting full content...`);
        
        // Date is in range, now extract full content
        // Wait for key elements to be present
        try {
          // Wait for either the article text or the header to be visible
          await Promise.race([
            this.page.waitForSelector('.article-text', { timeout: 20000, state: 'visible' }),
            this.page.waitForSelector('header.sub-header', { timeout: 20000, state: 'visible' }),
            this.page.waitForSelector('article', { timeout: 20000, state: 'visible' })
          ]);
        } catch (e) {
          console.log('Key elements not immediately visible, continuing anyway...');
        }

        // Scroll to bottom to load all lazy-loaded content (images, etc.)
        await this.scrollToBottom();
        
        await this.page.waitForTimeout(1000);

        const articleData = await this.page.evaluate((baseUrl) => {
          // Extract date from datetime attribute (already have it, but extract again for consistency)
          const dateElement = document.querySelector('header.sub-header span[datetime]');
          const datetime = dateElement ? dateElement.getAttribute('datetime') : null;
          const dateText = dateElement ? dateElement.textContent.trim() : null;

          // Extract article text content
          const articleTextDiv = document.querySelector('.article-text');
          let articleContent = '';
          
          if (articleTextDiv) {
            // Get all paragraphs and content
            const paragraphs = articleTextDiv.querySelectorAll('p');
            articleContent = Array.from(paragraphs)
              .map(p => p.textContent.trim())
              .filter(text => text.length > 0)
              .join('\n\n');
            
            // Also extract any images from the article
            const images = articleTextDiv.querySelectorAll('img');
            if (images.length > 0) {
              const imageUrls = Array.from(images).map(img => {
                let src = img.getAttribute('src') || '';
                if (src && !src.startsWith('http')) {
                  if (src.startsWith('/')) {
                    src = `${baseUrl}${src}`;
                  } else {
                    src = `${baseUrl}/${src}`;
                  }
                }
                return src;
              }).filter(url => url);
              
              if (imageUrls.length > 0) {
                articleContent += '\n\n[Article Images: ' + imageUrls.join(', ') + ']';
              }
            }
          }

          // Extract author/photo credit if available - clean it up
          const subHeader = document.querySelector('.sub-header');
          let photoCredit = null;
          if (subHeader) {
            // Get the first div which usually contains the photo credit
            const firstDiv = subHeader.querySelector('.col-md-12');
            if (firstDiv) {
              photoCredit = firstDiv.textContent.trim();
              // Remove extra whitespace and newlines
              photoCredit = photoCredit.replace(/\s+/g, ' ').trim();
            } else {
              // Fallback: get all text and clean it
              let rawText = subHeader.textContent.trim();
              // Remove date text and "Share:" text
              rawText = rawText.replace(/\d{1,2}\s+\w+\s+\d{4}/g, '').trim();
              rawText = rawText.replace(/Share:.*/i, '').trim();
              rawText = rawText.replace(/\s+/g, ' ').trim();
              if (rawText && rawText.length > 0) {
                photoCredit = rawText;
              }
            }
          }

          // Extract title
          const titleElement = document.querySelector('h1, .article-title, header h1');
          const title = titleElement ? titleElement.textContent.trim() : null;

          // Extract main article image if available
          let mainImage = null;
          const articleImage = document.querySelector('.article-text img, article img, .post-thumb img');
          if (articleImage) {
            mainImage = articleImage.getAttribute('src') || '';
            if (mainImage && !mainImage.startsWith('http')) {
              if (mainImage.startsWith('/')) {
                mainImage = `${baseUrl}${mainImage}`;
              } else {
                mainImage = `${baseUrl}/${mainImage}`;
              }
            }
          }

          return {
            datetime,
            dateText,
            title,
            photoCredit,
            content: articleContent,
            mainImage,
            url: window.location.href
          };
        }, this.baseUrl);

        // Combine with link data, prioritizing article page data over listing page data
        const fullArticle = {
          href: articleLink.href,
          title: articleData.title || articleLink.title,
          description: articleLink.description,
          image: articleData.mainImage || articleLink.image, // Use main image from article page if available
          datetime: articleData.datetime,
          dateText: articleData.dateText,
          photoCredit: articleData.photoCredit,
          content: articleData.content,
          url: articleData.url,
          scrapedAt: new Date().toISOString()
        };

        return fullArticle;
      } catch (error) {
        console.error(`Error scraping article ${articleLink.href} (Attempt ${attempt}):`, error.message);
        if (attempt < retries) {
          console.log(`Retrying in 2 seconds...`);
          await this.page.waitForTimeout(2000);
        } else {
          console.error(`Failed to scrape article after ${retries} attempts`);
          return null;
        }
      }
    }
    return null;
  }

  /**
   * Scrape all articles with pagination
   * Uses simple offset-based pagination: 0, 10, 20, 30, 40...
   */
  async scrapeAllArticles() {
    let pageNumber = 1;
    let currentOffset = 0; // Start at 0 (first page)

    while (true) {
      console.log(`\n=== Scraping Page ${pageNumber} (offset: ${currentOffset}) ===`);
      
      // Extract article links from current page with current offset
      const articleLinks = await this.extractArticleLinks(3, currentOffset);

      if (articleLinks.length === 0) {
        console.log('No articles found on this page. Reached end of pages.');
        break;
      }

      console.log(`Found ${articleLinks.length} articles on this page`);

      // Scrape each article
      let shouldStopScraping = false; // Set when we hit an article older than startDate
      for (let i = 0; i < articleLinks.length; i++) {
        const result = await this.extractArticleContent(articleLinks[i]);
        
        // OPTIMIZATION: If we hit an article older than startDate, break and return
        if (result && result.stop === true) {
          shouldStopScraping = true;
          break;
        }
        
        if (result) {
          this.scrapedArticles.push(result);
          console.log(`✓ Scraped: ${result.title}`);
        }

        // Small delay between requests to be respectful
        await this.page.waitForTimeout(1000);
      }

      // If we hit articles older than startDate, stop pagination too
      if (shouldStopScraping) {
        console.log(`\n🛑 Reached articles older than start date. Stopping early. Saving ${this.scrapedArticles.length} articles.`);
        break;
      }

      // Move to next page by incrementing offset by 10
      currentOffset += 10;
      const nextPageSuccess = await this.goToNextPage(currentOffset);
      
      if (!nextPageSuccess) {
        console.log('Failed to load next page or no more articles. Stopping...');
        break;
      }
      
      pageNumber++;
    }

    console.log(`\n=== Scraping Complete ===`);
    console.log(`Total articles scraped: ${this.scrapedArticles.length}`);
    if (this.startDate || this.endDate) {
      console.log(`Date range filter: ${this.startDate || 'no start'} to ${this.endDate || 'no end'}`);
    }
  }

  /**
   * Save scraped data to JSON file
   */
  async saveResults() {
    const outputPath = path.join(__dirname, this.outputFile);
    fs.writeFileSync(
      outputPath,
      JSON.stringify(this.scrapedArticles, null, 2),
      'utf-8'
    );
    console.log(`\nResults saved to: ${outputPath}`);
  }

  /**
   * Main scraping method
   */
  async run() {
    try {
      console.log('\n=== Premium Beauty News Scraper ===');
      if (this.startDate || this.endDate) {
        console.log(`Date Range: ${this.startDate || 'no start'} to ${this.endDate || 'no end'}`);
        console.log('Only articles within this date range will be scraped.\n');
      } else {
        console.log('No date filter set - scraping all articles.\n');
      }
      
      await this.init();
      await this.scrapeAllArticles();
      await this.saveResults();
    } catch (error) {
      console.error('Error during scraping:', error);
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// Main execution
async function main() {
  // Configure date range (optional)
  // Format: 'YYYY-MM-DD'
  // Example: To scrape articles from December 29 to December 31, 2025:
  const options = {
    startDate: '2025-12-29',  // Start date (inclusive) - Set to null to disable
    endDate: '2025-12-31',    // End date (inclusive) - Set to null to disable
    outputFile: 'scraped_articles.json',
    pageTimeout: 120000  // 2 minutes timeout (120000ms) - increase if pages are very slow
  };

  // Remove date filters if you want to scrape all articles
  // const options = {
  //   startDate: null,
  //   endDate: null,
  //   outputFile: 'scraped_articles.json',
  //   pageTimeout: 120000
  // };

  const scraper = new PremiumBeautyScraper(options);
  await scraper.run();
}

// Run the scraper
if (require.main === module) {
  main().catch(console.error);
}

module.exports = PremiumBeautyScraper;
