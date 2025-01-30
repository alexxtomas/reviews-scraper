#!/usr/bin/env node
import playwright from 'playwright';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import stream from 'stream';
import got from 'got';
import { createObjectCsvWriter } from 'csv-writer';

const pipeline = promisify(stream.pipeline);

// Helper function for random dates
function getRandomDate() {
  const start = new Date(2024, 10, 1); // November 1, 2024
  const end = new Date(2025, 0, 30); // January 30, 2025
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return date.toISOString().split('T')[0];
}

// CSV writer configuration
const csvWriter = createObjectCsvWriter({
  path: 'reviews.csv',
  header: [
    { id: 'product_handle', title: 'product_handle' },
    { id: 'rating', title: 'rating' },
    { id: 'author', title: 'author' },
    { id: 'email', title: 'email' },
    { id: 'body', title: 'body' },
    { id: 'created_at', title: 'created_at' },
    { id: 'photo_url', title: 'photo_url' },
    { id: 'verified_purchase', title: 'verified_purchase' },
  ],
});

(async () => {
  const browser = await playwright.chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Anti-bot measures
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.goto('https://boostedrider.com/products/showroom-1-0', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  // Click "Load More" until it disappears
  let loadMoreExists = true;
  let clickCount = 0;
  const maxClicks = 20;

  while (loadMoreExists && clickCount < maxClicks) {
    try {
      const loadMoreButton = await page.waitForSelector(
        'button.vtl-pr__btn.vtl-pr__btn--stroked.vtl-pr-main-widget__show-more-button',
        { timeout: 5000 },
      );
      await loadMoreButton.click();
      clickCount++;
      await page.waitForNetworkIdle({ idleTime: 1000 });
      await page.waitForTimeout(1500);
    } catch (err) {
      loadMoreExists = false;
    }
  }

  // Final scroll and wait
  await autoScroll(page);
  await page.waitForTimeout(2000);

  // Extract review data
  const reviews = await page.$$eval('.vtl-pr-review-card', (cards) =>
    cards.map((card) => {
      const author =
        card.querySelector('.vtl-pr-review-card__review-author span')?.textContent?.trim() ||
        'Anonymous';

      const reviewText =
        card.querySelector('.vtl-pr-review-card__review-text')?.textContent?.trim() || '';

      const imageUrl = card.querySelector('.vtl-pr-review-card__main-photo-holder img')?.src || '';

      return { author, reviewText, imageUrl };
    }),
  );

  // Create directory for images
  if (!existsSync('./review_images')) {
    mkdirSync('./review_images');
  }

  // Process images and prepare CSV data
  const csvData = [];
  for (const [index, review] of reviews.entries()) {
    let imagePath = null;

    if (review.imageUrl) {
      try {
        imagePath = `./review_images/image_${index + 1}.jpg`;
        await pipeline(got.stream(review.imageUrl), createWriteStream(imagePath));
      } catch (err) {
        console.error(`Failed to download image ${index + 1}`);
      }
    }

    // Create CSV record
    csvData.push({
      product_handle: 'minigarage',
      rating: Math.random() > 0.2 ? 5 : 4, // 80% chance of 5, 20% chance of 4
      author: review.author,
      email: '', // Email not available in source data
      body: review.reviewText,
      created_at: getRandomDate(),
      photo_url: review.imageUrl,
      verified_purchase: 'TRUE',
    });

    // Add path to JSON data
    review.imagePath = imagePath;
  }

  // Save files
  writeFileSync('reviews.json', JSON.stringify(reviews, null, 2));
  await csvWriter.writeRecords(csvData);

  console.log('\nSuccessfully generated:');
  console.log('- reviews.json');
  console.log('- reviews.csv');
  console.log('- review_images/ folder');

  await browser.close();
})();

// Auto-scroll function
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });
}
