import { chromium, Page } from "playwright";
import { supabase } from "./db_actions.ts";
import { deleteOldVideos, cacheVideos } from "./scripts.ts";

interface VideoData {
  videoId: string;
  channelId: string;
  superchatUrl: string;
}

async function scrapeNewVideos(page: Page): Promise<VideoData[]> {
  console.log("scraping new videos")
  await page.goto("https://www.hololyzer.net/youtube/realtime/index.html", {
    waitUntil: "domcontentloaded",
  });

  const videoData = await page.evaluate(() => {
    const results: VideoData[] = [];

    // Find all table entries
    const tables = document.querySelectorAll('table[style*="margin:2px"]');

    tables.forEach((table) => {
      // Check if it's private/member only/on air
      const statusText = table.textContent || "";
      if (
        statusText.includes("private") ||
        statusText.includes("member only") ||
        statusText.includes("on air")
      ) {
        return;
      }

      // Get superchat link
      const superchatLink = table.querySelector('a[href*="superchat/"]');
      if (!superchatLink) return;

      const superchatHref = superchatLink.getAttribute("href");
      if (!superchatHref || !superchatHref.includes("/archive/")) return;

      // Check yen amount
      const yenText = superchatLink.textContent || "";
      if (yenText === "￥0") return;

      // Get video ID from youtube link
      const youtubeLink = table.querySelector('a[href*="youtube.com/watch"]');
      if (!youtubeLink) return;

      const youtubeHref = youtubeLink.getAttribute("href");
      const videoIdMatch = youtubeHref?.match(/[?&]v=([^&]+)/);
      if (!videoIdMatch) return;
      const videoId = videoIdMatch[1];

      // Get channel ID from channel link
      const channelLink = table.querySelector('a[href*="../channel/"]');
      if (!channelLink) return;

      const channelHref = channelLink.getAttribute("href");
      const channelIdMatch = channelHref?.match(/channel\/([^.]+)\.html/);
      if (!channelIdMatch) return;
      const channelId = channelIdMatch[1];

      // Build full superchat URL
      const superchatUrl = `https://www.hololyzer.net/youtube/archive/superchat/${videoId}.html`;

      results.push({
        videoId,
        channelId,
        superchatUrl,
      });
    });
    console.log("New video sample:", results[0]);
    return results;
  });

  return videoData;
}

async function scrapeSuperchatData(page: Page, url: string, videoId: string) {
  console.log(`scraping ${url}`);
  await page.goto(url);

  // Extract title
  const title = await page.evaluate(() => {
    const titleLink = document.querySelector('a[href*="youtube.com/watch"]');
    if (titleLink) {
      const clonedLink = titleLink.cloneNode(true) as HTMLElement;
      clonedLink.querySelectorAll("img").forEach((img) => img.remove());
      clonedLink.querySelectorAll("br").forEach((br) => br.remove());
      return clonedLink.textContent?.trim() || "";
    }
    return "";
  });

  // Extract data from all visible superchat rows
  const superchatData = await page.$$eval(
    ".tr.supacha",
    (rows, videoId) => {
      return rows.map((row) => {
        // Extract time
        const timeCell = row.querySelector(".td.timeLabel");
        let timestampMs = 0; // Store as milliseconds throughout

        if (timeCell) {
          const timeText =
            timeCell.querySelector("a")?.textContent?.trim() ||
            timeCell.textContent?.trim() ||
            "";

          // Try to get unix timestamp from hidden span first
          const unixSpan = timeCell.querySelector(".unixtime_timeLabel");
          const unixStr = unixSpan?.textContent?.trim() || "";

          if (unixStr) {
            // Convert microseconds to milliseconds
            const unixNum = parseInt(unixStr);
            if (unixStr.length > 13) {
              // Microseconds (16 digits)
              timestampMs = Math.floor(unixNum / 1000);
            } else if (unixStr.length > 10) {
              // Already milliseconds (13 digits)
              timestampMs = unixNum;
            } else {
              // Seconds (10 digits)
              timestampMs = unixNum * 1000;
            }
          } else if (timeText) {
            // Parse from text like "28 Oct 08:12:29" or "Oct 2709:42:49"
            const cleanTime = timeText.replace(/<br>/g, " ").trim();
            const match1 = cleanTime.match(
              /(\d{1,2})\s+(\w+)\s+(\d{2}):(\d{2}):(\d{2})/
            );
            const match2 = cleanTime.match(
              /(\w+)\s+(\d{1,2})(\d{2}):(\d{2}):(\d{2})/
            );

            const monthMap: { [key: string]: number } = {
              Jan: 0,
              Feb: 1,
              Mar: 2,
              Apr: 3,
              May: 4,
              Jun: 5,
              Jul: 6,
              Aug: 7,
              Sep: 8,
              Oct: 9,
              Nov: 10,
              Dec: 11,
            };

            if (match1) {
              const [, day, month, hour, minute, second] = match1;
              const date = new Date(
                new Date().getFullYear(),
                monthMap[month],
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
              );
              timestampMs = date.getTime();
            } else if (match2) {
              const [, month, day, hour, minute, second] = match2;
              const date = new Date(
                new Date().getFullYear(),
                monthMap[month],
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
              );
              timestampMs = date.getTime();
            }
          }
        }

        // Extract YEN amount
        const currencyCell = row.querySelector(".td:nth-child(3)");
        let yenAmount = "";
        if (currencyCell) {
          const yenCell = currencyCell.querySelector(".table-cell.align-right");
          const leftCell = currencyCell.querySelector(".table-cell.align-left");
          yenAmount =
            yenCell?.textContent?.trim() || leftCell?.textContent?.trim() || "";
        }

        // Extract name (text only, excluding images)
        const nameCell = row.querySelector(".td.align-left:not(.comment)");
        let name = "";
        if (nameCell) {
          const clonedCell = nameCell.cloneNode(true) as HTMLElement;
          clonedCell.querySelectorAll("img").forEach((img) => img.remove());
          clonedCell.querySelectorAll("font").forEach((font) => font.remove());
          name = clonedCell.textContent?.trim() || "";
        }

        const yenNumber = yenAmount
          ? parseFloat(yenAmount.replace(/[^\d.]/g, ""))
          : 0;

        return {
          timestamp: timestampMs
            ? new Date(timestampMs).toISOString()
            : new Date().toISOString(),
          yen_amount: yenNumber,
          name,
          video_id: videoId,
        };
      });
    },
    videoId
  );

  console.log(`Scraped ${superchatData.length} superchats from ${videoId}`);
  if (superchatData.length > 0) {
    console.log("Sample:", superchatData[0]);
  }

  return {
    title,
    data: superchatData,
  };
}

async function runScraper() {
  await deleteOldVideos();
  const { data } = await supabase.from("scraped_videos").select();
  const scrapedIds = data?.map((obj) => obj.id) || [];
  const browser = await chromium.launch({
    headless: true,
    slowMo: 1000,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const videos = await scrapeNewVideos(page);

  for (const video of videos) {
    console.log(`scraping ${video.superchatUrl}`);
    if (scrapedIds.includes(video.videoId)) {
      continue;
    }
    try {
      const { title, data } = await scrapeSuperchatData(
        page,
        video.superchatUrl,
        video.videoId
      );
      if (data.length > 0) {
        const { error } = await supabase.from("superchats").insert(data);
        if (error) {
          console.error(
            `could not insert to table:superchats for ${video.superchatUrl}: ${error.message} ${error.stack}`
          );
        }
        const { error: error2 } = await supabase.from("video_metadata").insert({
          id: video.videoId,
          channel_id: video.channelId,
          timestamp: data[0].timestamp,
          title,
        });
        if (error2) {
          console.error(
            `could not insert to table:video_metadata for ${video.superchatUrl}: ${error2.message} ${error2.stack}`
          );
        }
      }
      const { error } = await supabase
        .from("scraped_videos")
        .insert({ id: video.videoId });
      if (error) {
        console.error(
          `could not insert to table:scraped_videos for ${video.superchatUrl}: ${error.message}`
        );
      }
    } catch (e) {
      console.log({ e });
      await new Promise((resolve) => setTimeout(resolve, 100000));
    }
  }
  await browser.close();
  await cacheVideos()
}

if (import.meta.main) {
  runScraper();
}
