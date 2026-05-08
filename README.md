# Udemy Transcript Downloader

A NodeJS-based tool for downloading transcripts from Udemy courses. This script uses Puppeteer to navigate through Udemy's UI and extract transcripts for each lecture in a course.

## Features

- Downloads transcripts from any Udemy course you have access to
- Creates individual transcript files for each lecture
- Generates a combined transcript file with all lectures
- Optionally downloads `.srt` files with timestamps for each lecture
- Scrapes and saves course content structure
- Supports email-based authentication with verification code
- Handles Cloudflare security challenges
- Runs in headless mode for better performance

## Prerequisites

- Node.js (v14 or newer)
- NPM
- A Udemy account with access to the course you want to download transcripts from

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/TOA-Anakin/udemy-transcript-downloader.git
   cd udemy-transcript-downloader
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with your Udemy email:
   ```
   UDEMY_EMAIL=your-email@example.com
   ```

## Usage

### Local usage

Run the script with the URL of the Udemy course as an argument:

```
npm start "https://www.udemy.com/course/your-course-url/"
```

Or use the direct Node.js command:

```
node src/index.js "https://www.udemy.com/course/your-course-url/"
```

### Filter languages for SRT download

You can use the `--languages` (or `-l`) flag to download only specific subtitle languages:

```
npm start "https://www.udemy.com/course/your-course-url/" --languages en_GB,zh_CN
```

```
node src/index.js "https://www.udemy.com/course/your-course-url/" -l en_GB,zh_CN
```

When `--languages` is specified, SRT download is automatically enabled, and only the specified language codes will be downloaded.

### Save and reuse login session

You can save your login session to skip authentication in future runs:

```bash
# First time: save auth cookies after login (will prompt for verification code)
node src/index.js --save-auth udemy-auth.json "https://www.udemy.com/course/your-course/"

# Subsequent runs: load saved auth to skip login
node src/index.js --load-auth udemy-auth.json -l en_GB,zh_CN "https://www.udemy.com/course/your-course/"
```

### Non-interactive mode (for automation)

Use `--non-interactive` with environment variables for fully automated runs:

```bash
DOWNLOAD_SRT=true TAB_COUNT=5 node src/index.js --load-auth udemy-auth.json --non-interactive -l en_GB,zh_CN "https://..."
```

Or for first-time auth without cookies:

```bash
UDEMY_VERIFICATION_CODE=123456 DOWNLOAD_SRT=true node src/index.js --non-interactive -l en_GB,zh_CN "https://..."
```

## GitHub Actions (Cloud Download)

This repository includes a workflow to download transcripts entirely in the cloud.

### One-time setup

1. Fork this repository
2. Add these **Repository Secrets** (Settings → Secrets and variables → Actions):
   - `UDEMY_EMAIL` — your Udemy login email
   - `UDEMY_AUTH` — your saved auth cookies (see below)
3. Generate the auth file locally (one-time):
   ```bash
   node src/index.js --save-auth udemy-auth.json "https://www.udemy.com/course/any-course/"
   # Login with email + verification code when prompted
   ```
4. Set the secret from the generated file:
   ```bash
   gh secret set UDEMY_AUTH -b "$(cat udemy-auth.json)"
   # Or manually: copy the file content to Settings → Secrets → Actions → UDEMY_AUTH
   ```

### Running the workflow

1. Go to **Actions** tab → **Download Udemy Transcripts** → **Run workflow**
2. Fill in:
   - `course_url`: The Udemy course URL
   - `languages`: Comma-separated language codes (default: `en_GB,zh_CN`)
   - `tab_count`: Number of parallel download tabs (default: `5`)
3. Click **Run workflow**
4. When complete, download the artifact from the workflow summary

> **Note:** Auth cookies expire after some time. If downloads fail with auth errors, re-run the one-time setup to refresh the cookies.

The script will:

1. Ask if you want to download `.srt` files (with timestamps) for each lecture (unless `--languages` or `--non-interactive` is used)
2. Ask how many tabs to use for downloading transcripts (default is 5)
   - A higher number can speed things up, but requires a good PC (enough CPU and RAM)
3. Open a headless browser and navigate to Udemy login (skipped if `--load-auth` is used)
4. Fill in your email from the .env file
5. Ask you to enter the 6-digit verification code from your email
6. Navigate to the course page
7. Scrape course content structure
8. Enter the course player
9. Go through each lecture and download available transcripts
10. Save individual transcript files in the `output` directory

## Output Files

All output files are saved to the `output` directory:

- `CONTENTS.txt` - Course structure with sections and lectures
- `[Lecture Name].txt` - Individual transcript files for each lecture
- `[Lecture Name].srt` - Individual transcript files with timestamps in SubRip format (optional)

## Troubleshooting

- **Verification Code Issues**: Make sure to enter the verification code quickly after receiving it in your email
- **Browser Crashing**: If you experience issues with headless mode, you can modify the script to use `headless: false` for debugging
- **Missing Transcripts**: Not all lectures may have transcripts. The script will create empty files for lectures without transcripts.
- **SRT Errors**: If `.srt` generation fails for a lecture, try increasing timeouts or re-running the script with fewer browser tabs open.
- **Slow Transcript Downloads**: The script can download transcripts in parallel using multiple browser tabs. If your PC is slow or has limited memory, stick to a lower number of tabs (e.g. 1–3). If you have a powerful machine, you can safely use 5 or more tabs for faster processing.

## License

MIT

## Disclaimer

This tool is for personal use only. Please respect Udemy's terms of service.
