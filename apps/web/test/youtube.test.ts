// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isYouTubeVideoId, parseYouTubeVideoId } from "../src/lib/youtube";

const VIDEO_ID = "dQw4w9WgXcQ";

describe("YouTube video parsing", () => {
  it("accepts watch, short, and embed URLs", () => {
    const urls = [
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      `https://youtube.com/watch?v=${VIDEO_ID}&t=42s`,
      `http://m.youtube.com/watch?app=desktop&v=${VIDEO_ID}`,
      `https://music.youtube.com/watch?v=${VIDEO_ID}`,
      `https://youtu.be/${VIDEO_ID}?t=42`,
      `https://www.youtu.be/${VIDEO_ID}`,
      `https://www.youtube.com/embed/${VIDEO_ID}`,
      `https://www.youtube.com/embed/${VIDEO_ID}?start=30`,
      `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
      `https://youtube.com/shorts/${VIDEO_ID}`,
      `youtu.be/${VIDEO_ID}`,
    ];

    for (const url of urls) {
      expect(parseYouTubeVideoId(url)).toBe(VIDEO_ID);
    }
  });

  it("accepts bare video IDs and trims surrounding whitespace", () => {
    expect(parseYouTubeVideoId(VIDEO_ID)).toBe(VIDEO_ID);
    expect(parseYouTubeVideoId(`  ${VIDEO_ID}  `)).toBe(VIDEO_ID);
    expect(parseYouTubeVideoId(`  https://youtu.be/${VIDEO_ID}  `)).toBe(VIDEO_ID);
  });

  it("rejects unsupported hosts, malformed URLs, and missing IDs", () => {
    const values = [
      "",
      "not a URL",
      `https://example.com/watch?v=${VIDEO_ID}`,
      `https://youtube.com.evil.example/watch?v=${VIDEO_ID}`,
      `https://notyoutube.com/watch?v=${VIDEO_ID}`,
      "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/",
      "https://www.youtube.com/watch",
      "https://www.youtube.com/watch?v=",
      `https://www.youtube.com/watch/extra?v=${VIDEO_ID}`,
      `https://youtu.be/${VIDEO_ID}/extra`,
      `https://www.youtube.com/embed/${VIDEO_ID}/extra`,
      `https://www.youtube.com/channel/${VIDEO_ID}`,
      "https://www.youtube.com/watch?v=too-short",
      "https://youtu.be/",
    ];

    for (const value of values) {
      expect(parseYouTubeVideoId(value)).toBeNull();
    }
  });

  it("validates bare IDs using the shared schema rules", () => {
    expect(isYouTubeVideoId(VIDEO_ID)).toBe(true);
    expect(isYouTubeVideoId("abcdefghij_")).toBe(true);
    expect(isYouTubeVideoId("abcdefghij-")).toBe(true);
    expect(isYouTubeVideoId("abcdefghij")).toBe(false);
    expect(isYouTubeVideoId("abcdefghijkL")).toBe(false);
    expect(isYouTubeVideoId("abcdefghij!")).toBe(false);
    expect(isYouTubeVideoId("")).toBe(false);
  });
});
