#!/usr/bin/env node
import playwright from 'playwright';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import stream from 'stream';
import got from 'got';

const pipeline = promisify(stream.pipeline);

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
  const maxClicks = 20; // Safety limit

  while (loadMoreExists && clickCount < maxClicks) {
    try {
      const loadMoreButton = await page.waitForSelector(
        'button.vtl-pr__btn.vtl-pr__btn--stroked.vtl-pr-main-widget__show-more-button',
        { timeout: 5000 },
      );

      await loadMoreButton.click();
      clickCount++;
      console.log(`Clicked "Load More" (${clickCount} times)`);

      // Wait for new content to load
      await page.waitForNetworkIdle({ idleTime: 1000 });
      await page.waitForTimeout(1500);
    } catch (err) {
      loadMoreExists = false;
      console.log('No more "Load More" button found');
    }
  }

  // Final scroll to ensure all elements are loaded
  await autoScroll(page);
  await page.waitForTimeout(2000);

  // Extract review data
  const reviews = await page.$$eval('.vtl-pr-review-card', (cards) =>
    cards.map((card) => {
      const author = card
        .querySelector('.vtl-pr-review-card__review-author span')
        ?.textContent?.trim();

      const reviewText = card
        .querySelector('.vtl-pr-review-card__review-text')
        ?.textContent?.trim();

      const imageUrl = card.querySelector('.vtl-pr-review-card__main-photo-holder img')?.src;

      return { author, reviewText, imageUrl };
    }),
  );

  // Create directory for images
  if (!existsSync('./review_images')) {
    mkdirSync('./review_images');
  }

  // Process images and replace URLs with paths
  for (const [index, review] of reviews.entries()) {
    let imagePath = null;

    if (review.imageUrl) {
      try {
        imagePath = `./review_images/image_${index + 1}.jpg`;
        await pipeline(got.stream(review.imageUrl), createWriteStream(imagePath));
        console.log(`Downloaded image: ${imagePath}`);
      } catch (err) {
        console.error(`Failed to download image for review ${index + 1}:`, err.message);
        imagePath = null;
      }
    }

    // Replace imageUrl with imagePath
    review.imagePath = imagePath;
    delete review.imageUrl;
  }

  // Save reviews to JSON file
  writeFileSync('reviews.json', JSON.stringify(reviews, null, 2));
  console.log('\nSaved all reviews to reviews.json');

  await browser.close();
})();

// Enhanced auto-scroll function
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
