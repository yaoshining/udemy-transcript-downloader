const puppeteer = require('puppeteer');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Apply stealth plugin to avoid detection
puppeteerExtra.use(StealthPlugin());

// Initialize readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, '../output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Parse a flag with a value (e.g., --flag value)
function parseFlagValue(args, flag) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      const raw = args[i + 1];
      if (!raw || raw.startsWith('-')) return null;
      return raw;
    }
  }
  return null;
}

// Check if a boolean flag exists (e.g., --flag)
function hasFlag(args, flag) {
  return args.includes(flag);
}

// Parse command line arguments for --languages / -l flag
function parseLanguages(args) {
  const raw = parseFlagValue(args, '--languages') || parseFlagValue(args, '-l');
  if (raw === null) return null;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Get positional arguments (skip node, script name, and flag arguments)
function getCourseUrl(args) {
  const flagSet = new Set(['--languages', '-l', '--save-auth', '--load-auth']);
  let skipNext = false;
  for (let i = 2; i < args.length; i++) {
    if (skipNext) { skipNext = false; continue; }
    if (flagSet.has(args[i])) { skipNext = true; continue; }
    if (!args[i].startsWith('-')) return args[i];
  }
  return null;
}

// Main function
async function main() {
  // Parse CLI flags
  const languages = parseLanguages(process.argv);
  const saveAuthPath = parseFlagValue(process.argv, '--save-auth');
  const loadAuthPath = parseFlagValue(process.argv, '--load-auth');
  const nonInteractive = hasFlag(process.argv, '--non-interactive');

  // Get course URL
  let courseUrl = getCourseUrl(process.argv);

  // Check if URL is provided
  if (!courseUrl) {
    console.error('Please provide a Udemy course URL as a parameter');
    console.error('Example: npm start https://www.udemy.com/course/your-course-name');
    console.error('Options:');
    console.error('  --languages, -l    Comma-separated language codes (e.g., en_GB,zh_CN)');
    console.error('  --save-auth <file>  Save login cookies to a JSON file after authentication');
    console.error('  --load-auth <file>  Load login cookies from a JSON file to skip login');
    console.error('  --non-interactive   Run without prompts (read inputs from env vars)');
    process.exit(1);
  }

  // Make sure URL ends with a trailing slash
  if (!courseUrl.endsWith('/')) {
    courseUrl += '/';
  }

  console.log(`Course URL: ${courseUrl}`);
  if (languages) {
    console.log(`Language filter: ${languages.join(', ')}`);
  }

  // Determine downloadSrt and tabCount based on mode
  let downloadSrt;
  let tabCount;

  if (nonInteractive) {
    downloadSrt = process.env.DOWNLOAD_SRT === 'true' || process.env.DOWNLOAD_SRT === '1';
    tabCount = parseInt(process.env.TAB_COUNT || '5', 10);
    console.log(`Non-interactive mode: downloadSrt=${downloadSrt}, tabCount=${tabCount}`);
  } else if (languages) {
    downloadSrt = true;
    console.log('SRT download: enabled (languages specified)');
    tabCount = await new Promise((resolve) => {
      rl.question(`How many tabs do you want to use for downloading transcripts? (default is 5) [5]: `, (answer) => {
        const normalized = answer.trim();
        resolve(normalized ? parseInt(normalized, 10) : 5);
      });
    });
  } else {
    downloadSrt = await new Promise((resolve) => {
      rl.question('Do you want to download transcripts as .srt files with timestamps as well? (yes/no) [no]: ', (answer) => {
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === 'yes' || normalized === 'y');
      });
    });
    tabCount = await new Promise((resolve) => {
      rl.question(`How many tabs do you want to use for downloading transcripts? (default is 5) [5]: `, (answer) => {
        const normalized = answer.trim();
        resolve(normalized ? parseInt(normalized, 10) : 5);
      });
    });
  }

  // Load auth cookies from file or UDEMY_AUTH env var
  let authCookies = null;
  if (loadAuthPath) {
    console.log(`Loading auth cookies from: ${loadAuthPath}`);
    if (!fs.existsSync(loadAuthPath)) {
      console.error(`Auth file not found: ${loadAuthPath}`);
      process.exit(1);
    }
    authCookies = JSON.parse(fs.readFileSync(loadAuthPath, 'utf8'));
  } else if (process.env.UDEMY_AUTH) {
    // Support loading from env var (for GitHub Actions secrets)
    const authSource = process.env.UDEMY_AUTH;
    if (fs.existsSync(authSource)) {
      console.log(`Loading auth cookies from env var path: ${authSource}`);
      authCookies = JSON.parse(fs.readFileSync(authSource, 'utf8'));
    } else {
      try {
        console.log('Loading auth cookies from UDEMY_AUTH env var');
        authCookies = JSON.parse(authSource);
      } catch {
        console.error('UDEMY_AUTH env var contains invalid JSON');
        process.exit(1);
      }
    }
  }

  // Launch browser in headless mode
  console.log('Launching browser...');
  const browser = await puppeteerExtra.launch({
    headless: 'new', // Use the new headless mode
    defaultViewport: null,
    args: [
      '--window-size=1280,720',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox'
    ],
    protocolTimeout: 300000
  });

  try {
    const page = await browser.newPage();
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (authCookies) {
      // Use saved auth cookies to skip login
      console.log('Setting auth cookies...');
      await page.setCookie(...authCookies);
      console.log('Auth cookies loaded, skipping login.');

      // Navigate to course page directly
      console.log(`Navigating to course page: ${courseUrl}`);
      await page.goto(courseUrl, { waitUntil: 'networkidle2' });
    } else {
      // Full login flow
      // Navigate to login page
      console.log('Navigating to login page...');
      let loginPageLoaded = false;
      for (let attempt = 0; attempt < 2 && !loginPageLoaded; attempt++) {
        try {
          await page.goto('https://www.udemy.com/join/passwordless-auth', { waitUntil: 'domcontentloaded' });
          loginPageLoaded = true;
        } catch (err) {
          if (err.message.includes('frame was detached')) {
            console.warn('Frame was detached, retrying navigation...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            throw err;
          }
        }
      }

      // Check if email is configured
      if (!process.env.UDEMY_EMAIL) {
        console.error('UDEMY_EMAIL not found in .env file. Please configure your credentials.');
        process.exit(1);
      }

      console.log('Processing login...');

      // Wait a few seconds before filling the email input
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Fill in the email input
      await page.waitForSelector('input[name="email"]');
      await page.type('input[name="email"]', process.env.UDEMY_EMAIL, { delay: 100 });

      // Close the cookie bar if it exists
      try {
        const cookieButtonExists = await page.evaluate(() => {
          return !!document.getElementById('onetrust-accept-btn-handler');
        });
        if (cookieButtonExists) {
          await page.$eval('#onetrust-accept-btn-handler', element => element.click());
          console.log('Closed cookie bar');
        }
      } catch (error) {
        console.log('Cookie bar not found or could not be closed');
      }

      // Submit the login form
      await page.$eval('[data-purpose="code-generation-form"] [type="submit"]', element => element.click());
      console.log('Email submitted, waiting for verification code...');

      // Get verification code
      let verificationCode;
      if (nonInteractive) {
        verificationCode = process.env.UDEMY_VERIFICATION_CODE;
        if (!verificationCode) {
          console.error('UDEMY_VERIFICATION_CODE not set. Required in non-interactive mode when no auth cookies are provided.');
          process.exit(1);
        }
        console.log('Using verification code from UDEMY_VERIFICATION_CODE env var');
      } else {
        console.log('You have 5 minutes to enter the verification code before the program times out.');
        verificationCode = await new Promise((resolve) => {
          rl.question('Please enter the 6-digit verification code from your email: ', (code) => {
            resolve(code.trim());
          });
        });
      }

      // Fill in the verification code
      await page.waitForSelector('[data-purpose="otp-text-area"] input', { timeout: 60000 });
      await page.type('[data-purpose="otp-text-area"] input', verificationCode, { delay: 100 });

      // Submit the verification form
      await page.$eval('[data-purpose="otp-verification-form"] [type="submit"]', element => element.click());
      console.log('Verification submitted, completing login...');

      // Wait for redirect after successful login with a longer timeout
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('Login successful!');

      // Save auth cookies if requested
      if (saveAuthPath) {
        const cookies = await page.cookies();
        fs.writeFileSync(saveAuthPath, JSON.stringify(cookies, null, 2), 'utf8');
        console.log(`Auth cookies saved to: ${saveAuthPath}`);
      }

      // Navigate to course page
      console.log(`Navigating to course page: ${courseUrl}`);
      await page.goto(courseUrl, { waitUntil: 'networkidle2' });
    }

    // Extract course ID
    console.log('Extracting course ID...');
    const courseId = await page.evaluate(() => {
      return document.querySelector("body[data-clp-course-id]").getAttribute("data-clp-course-id");
    });

    if (!courseId) {
      throw new Error('Could not retrieve course ID. Make sure you are logged in and the course URL is correct.');
    }

    console.log(`Course ID: ${courseId}`);

    // Fetch course content
    console.log('Fetching course content...');
    const apiUrl = `https://www.udemy.com/api-2.0/courses/${courseId}/subscriber-curriculum-items/?page_size=200&fields%5Blecture%5D=title,object_index,is_published,sort_order,created,asset,supplementary_assets,is_free&fields%5Bquiz%5D=title,object_index,is_published,sort_order,type&fields%5Bpractice%5D=title,object_index,is_published,sort_order&fields%5Bchapter%5D=title,object_index,is_published,sort_order&fields%5Basset%5D=title,filename,asset_type,status,time_estimation,is_external,transcript,captions&caching_intent=True`;

    let courseJson = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Attempt ${attempt} to fetch course content...`);
      try {
        await page.goto(apiUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const rawBody = await page.evaluate(() => document.body.innerText);

        if (rawBody.trim().startsWith('<!DOCTYPE html>')) {
          throw new Error('HTML response received instead of JSON');
        }

        courseJson = JSON.parse(rawBody);

        if (courseJson && courseJson.results) {
          break; // success
        } else {
          throw new Error('JSON parsed but no results key found');
        }
      } catch (err) {
        console.warn(`[Attempt ${attempt}] Failed to fetch course content: ${err.message}`);
        if (attempt < maxAttempts) {
          console.log('Retrying in 5 seconds...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          throw new Error('Could not retrieve course content. Make sure you have access to this course and try again.');
        }
      }
    }

    // Process course structure
    console.log('Processing course structure...');
    const courseStructure = processCourseStructure(courseJson.results);

    // Generate CONTENTS.txt
    console.log('Generating CONTENTS.txt...');
    generateContentsFile(courseStructure, outputDir);

    // Download transcripts
    console.log('Downloading transcripts...');
    await downloadTranscripts(browser, courseUrl, courseStructure, downloadSrt, tabCount, languages);

    console.log('All transcripts have been downloaded successfully!');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    // Close browser
    await browser.close();
    rl.close();
  }
}

// Process course structure
function processCourseStructure(results) {
  const courseStructure = {
    chapters: [],
    lectures: []
  };

  // Sort results by sort_order (highest first, as per Udemy's order)
  const sortedResults = [...results].sort((a, b) => b.sort_order - a.sort_order);

  let currentChapter = null;
  let chapterCounter = 1;
  let lectureCounter = 1;

  sortedResults.forEach(item => {
    if (item._class === 'chapter') {
      currentChapter = {
        id: item.id,
        title: item.title,
        index: chapterCounter++,
        lectures: []
      };
      courseStructure.chapters.push(currentChapter);
      lectureCounter = 1; // Reset lecture counter for the new chapter
    } else if (
      item._class === 'lecture' &&
      item.asset &&
      typeof item.asset.asset_type === 'string' &&
      item.asset.asset_type.toLowerCase().includes('video')
    ) {
      const lecture = {
        id: item.id,
        title: item.title,
        created: item.created,
        timeEstimation: item.asset.time_estimation,
        chapterIndex: currentChapter ? currentChapter.index : null,
        lectureIndex: lectureCounter++
      };

      if (item.asset.captions && Array.isArray(item.asset.captions)) {
        lecture.captions = item.asset.captions.filter(c => c.url);
      }

      if (currentChapter) {
        currentChapter.lectures.push(lecture);
      } else {
        courseStructure.lectures.push(lecture);
      }
    }
  });

  return courseStructure;
}

// Convert VTT timestamp to SRT format
function normalizeTimestamp(ts) {
  const [main, ms] = ts.split('.');
  const parts = main.split(':');

  while (parts.length < 3) {
    parts.unshift('00');
  }

  return `${parts.map(p => p.padStart(2, '0')).join(':')},${(ms || '000').padEnd(3, '0')}`;
}

// Convert VTT content to SRT format
function convertVttToSrt(vtt) {
  return vtt
    .replace(/^WEBVTT(\n|\r|\r\n)?/, '')
    .trim()
    .split(/\n{2,}/)
    .map((block, i) => {
      const lines = block.trim().split('\n');
      if (lines.length < 2) return null;
      const [startEnd, ...textLines] = lines;
      const [start, end] = startEnd.split(' --> ').map(normalizeTimestamp);
      return `${i + 1}\n${start} --> ${end}\n${textLines.join('\n')}\n`;
    })
    .filter(Boolean)
    .join('\n');
}

// Generate CONTENTS.txt file
function generateContentsFile(courseStructure, outputDir) {
  let content = '';

  for (const chapter of courseStructure.chapters) {
    content += `${chapter.index}. ${chapter.title}\n`;

    for (const lecture of chapter.lectures) {
      const timeInMinutes = Math.floor(lecture.timeEstimation / 60);
      const date = new Date(lecture.created).toLocaleDateString();
      content += `${chapter.index}.${lecture.lectureIndex} ${lecture.title} [${timeInMinutes} min, ${date}]\n`;
    }

    content += '\n';
  }

  // Add standalone lectures (if any)
  if (courseStructure.lectures.length > 0) {
    for (const lecture of courseStructure.lectures) {
      const timeInMinutes = Math.floor(lecture.timeEstimation / 60);
      const date = new Date(lecture.created).toLocaleDateString();
      content += `${lecture.lectureIndex}. ${lecture.title} [${timeInMinutes} min, ${date}]\n`;
    }
  }

  fs.writeFileSync(path.join(outputDir, 'CONTENTS.txt'), content, 'utf8');
  console.log('CONTENTS.txt has been created successfully!');
}

// Download transcripts
async function downloadTranscripts(browser, courseUrl, courseStructure, downloadSrt, tabCount = 5, languages = null) {
  const allLectures = [];

  // Flatten all lectures into a single list
  for (const chapter of courseStructure.chapters) {
    for (const lecture of chapter.lectures) {
      allLectures.push({ lecture, chapter });
    }
  }
  for (const lecture of courseStructure.lectures) {
    allLectures.push({ lecture, chapter: null });
  }

  // Split into chunks
  function chunkArray(arr, chunkCount) {
    const chunks = Array.from({ length: chunkCount }, () => []);
    arr.forEach((item, index) => {
      chunks[index % chunkCount].push(item);
    });
    return chunks;
  }

  const chunks = chunkArray(allLectures, tabCount);

  // Launch tabs and process in parallel
  await Promise.all(chunks.map(async (chunk, tabIndex) => {
    const page = await browser.newPage();
    console.log(`Tab ${tabIndex + 1} processing ${chunk.length} lectures...`);

    for (let i = 0; i < chunk.length; i++) {
      const { lecture, chapter } = chunk[i];
      await processLecture(page, courseUrl, lecture, chapter, downloadSrt, languages);
    }

    await page.close();
    console.log(`Tab ${tabIndex + 1} done.`);
  }));
}

// Process a single lecture
async function processLecture(page, courseUrl, lecture, chapter = null, downloadSrt = false, languages = null) {
  const lectureUrl = `${courseUrl}learn/lecture/${lecture.id}`;
  const filename = chapter ?
    `${chapter.index}.${lecture.lectureIndex} ${lecture.title}` :
    `${lecture.lectureIndex}. ${lecture.title}`;

  // Sanitize filename by removing invalid characters
  const sanitizedFilename = filename.replace(/[/\\?%*:|"<>]/g, '-');

  console.log(`Processing lecture: ${sanitizedFilename}`);

  try {
    // Navigate to lecture page with a longer timeout
    await page.goto(lectureUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000 // Increase timeout to 60 seconds
    });

    // Wait for video player to load completely (looking for the video container)
    await page.waitForSelector('video', {
      timeout: 30000,
      visible: true
    }).catch(() => {
      console.log(`Note: Video player not fully loaded for lecture: ${lecture.title}, but continuing anyway`);
    });

    // Additional delay to ensure page is fully loaded
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Try multiple approaches to find the transcript toggle button
    const transcriptButtonSelectors = [
      'button[data-purpose="transcript-toggle"]',
      '[data-purpose="transcript-toggle"]',
      'button:has-text("Transcript")',
      '.transcript-toggle', // Additional potential class name
      '[aria-label*="transcript" i]', // Any element with transcript in aria-label
      'button[aria-label*="transcript" i]' // Button with transcript in aria-label
    ];

    let transcriptButtonFound = false;

    for (const selector of transcriptButtonSelectors) {
      try {
        // Check if button exists
        const buttonExists = await page.evaluate((sel) => {
          const element = document.querySelector(sel);
          return !!element;
        }, selector);

        if (buttonExists) {
          console.log(`Found transcript button using selector: ${selector}`);

          // Use the direct JavaScript click method
          await page.$eval(selector, element => element.click());
          console.log(`Clicked transcript button using JavaScript method`);

          // Wait a moment for the click to take effect
          await new Promise(resolve => setTimeout(resolve, 1500));

          // Check if panel appeared
          const isPanelVisible = await page.evaluate(() => {
            const panel = document.querySelector('[data-purpose="transcript-panel"]');
            return panel && panel.offsetParent !== null;
          });

          if (isPanelVisible) {
            console.log('Transcript panel successfully opened');
            transcriptButtonFound = true;
            break;
          } else {
            console.log('Button clicked but panel did not appear, trying next selector');
          }
        }
      } catch (error) {
        console.log(`Error with selector ${selector}: ${error.message}`);
        continue;
      }
    }

    if (!transcriptButtonFound) {
      console.log(`No transcript button found/clicked successfully for lecture: ${lecture.title}. This lecture might not have a transcript.`);
      // Create a placeholder file
      fs.writeFileSync(path.join(__dirname, '../output', `${sanitizedFilename}.txt`),
        `# ${sanitizedFilename}\n\n[No transcript available or could not be accessed]`, 'utf8');
      console.log(`Created placeholder file for: ${sanitizedFilename}`);
      return;
    }

    // Additional delay to ensure transcript panel is fully loaded
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract transcript text with retry logic
    let transcriptText = '';
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      transcriptText = await page.evaluate(() => {
        const panel = document.querySelector('[data-purpose="transcript-panel"]');
        return panel ? panel.textContent : '';
      });

      if (transcriptText && transcriptText.trim() !== '') {
        break;
      }

      console.log(`Retry ${retries + 1}/${maxRetries} to get transcript...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries++;
    }

    if (!transcriptText || transcriptText.trim() === '') {
      console.log(`No transcript content available for lecture: ${lecture.title}`);
      return;
    }

    // Create file content
    const fileContent = `# ${sanitizedFilename}\n\n${transcriptText}`;

    // Write to file
    fs.writeFileSync(path.join(__dirname, '../output', `${sanitizedFilename}.txt`), fileContent, 'utf8');
    console.log(`Transcript saved for: ${sanitizedFilename}`);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Optional: Download SRT files if captions are available
    if (downloadSrt && Array.isArray(lecture.captions) && lecture.captions.length > 0) {
      // Filter captions by specified languages if provided
      const captionsToDownload = languages
        ? lecture.captions.filter(c => languages.includes(c.locale_id))
        : lecture.captions;

      if (languages && captionsToDownload.length === 0) {
        console.log(`  No captions match language filter [${languages.join(', ')}] for: ${sanitizedFilename}`);
      }

      for (const caption of captionsToDownload) {
        try {
          const vttContent = await page.evaluate(async (url) => {
            const res = await fetch(url);
            return await res.text();
          }, caption.url);

          const srtContent = convertVttToSrt(vttContent);
          const langTag = caption.locale_id || 'unknown';
          const srtPath = path.join(__dirname, '../output', `${sanitizedFilename} [${langTag}].srt`);
          fs.writeFileSync(srtPath, srtContent, 'utf8');
          console.log(`SRT saved: ${sanitizedFilename} [${langTag}]`);
        } catch (err) {
          console.log(`Error downloading caption [${caption.locale_id}] for ${sanitizedFilename}: ${err.message}`);
        }
      }
    } else if (downloadSrt) {
      console.log(`No captions found for ${sanitizedFilename}`);
    }

    // Wait briefly before moving to the next lecture to avoid overwhelming the browser
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`Error processing lecture ${lecture.title}:`, error.message);
  }
}

// Run the main function
main().catch(err => {
  console.error('Fatal error occurred:', err.message || err);
  process.exit(1);
});
