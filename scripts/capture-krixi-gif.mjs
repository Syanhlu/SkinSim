#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));
const chromePath = options.chrome ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const url = options.url ?? "https://vng-ab-test-agent.vercel.app/world?mode=replay&demo=kfc";
const out = path.resolve(root, options.out ?? "demo/krixi-run.gif");
const framesDir = path.resolve(options.frames ?? "C:\\tmp\\krixi-run-frames");
const profileDir = path.resolve(options.profile ?? "C:\\tmp\\krixi-run-chrome-profile");
const port = Number(options.port ?? 9224);
const width = Number(options.width ?? 1280);
const height = Number(options.height ?? 720);
const fps = Number(options.fps ?? 10);
const duration = Number(options.duration ?? 24);
const speed = Number(options.speed ?? 4);
const gifWidth = Number(options.gifWidth ?? 960);

await rm(framesDir, { recursive: true, force: true });
await rm(profileDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
await mkdir(path.dirname(out), { recursive: true });

await assertFile(chromePath, "Chrome executable");

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  `--window-size=${width},${height}`,
  url,
], {
  stdio: "ignore",
  windowsHide: true,
});

let cdp;
try {
  const page = await waitForPage(port);
  cdp = await connectCdp(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await waitForWorld(cdp);
  await prepareReplay(cdp, speed);
  await delay(300);

  const frameCount = Math.round(duration * fps);
  const frameMs = 1000 / fps;
  const start = Date.now();

  for (let i = 0; i < frameCount; i += 1) {
    const target = start + i * frameMs;
    const wait = target - Date.now();
    if (wait > 0) await delay(wait);

    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const file = path.join(framesDir, `frame_${String(i).padStart(4, "0")}.png`);
    await writeFile(file, Buffer.from(shot.data, "base64"));

    if ((i + 1) % fps === 0) {
      process.stdout.write(`captured ${Math.round((i + 1) / fps)}s / ${duration}s\r`);
    }
  }
  process.stdout.write(`captured ${duration}s / ${duration}s\n`);

  await renderGif(framesDir, out, fps, gifWidth);
  console.log(`wrote ${out}`);
} finally {
  try {
    if (cdp) await cdp.send("Browser.close");
  } catch {
    chrome.kill("SIGTERM");
  }
  await waitForExit(chrome, 3000).catch(() => chrome.kill("SIGKILL"));
  await cleanupGeneratedDir(framesDir);
  await cleanupGeneratedDir(profileDir);
}

function parseArgs(args) {
  const parsed = {};
  for (const arg of args) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) parsed[match[1]] = match[2];
  }
  return parsed;
}

async function assertFile(file, label) {
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error();
  } catch {
    throw new Error(`${label} not found: ${file}`);
  }
}

async function waitForPage(debugPort) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (res.ok) {
        const pages = await res.json();
        const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {
      // Chrome is still starting.
    }
    await delay(150);
  }
  throw new Error("Timed out waiting for Chrome DevTools page");
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();

    ws.onopen = () => {
      resolve({
        send(method, params = {}) {
          const messageId = ++id;
          ws.send(JSON.stringify({ id: messageId, method, params }));
          return new Promise((res, rej) => pending.set(messageId, { res, rej, method }));
        },
      });
    };
    ws.onerror = () => reject(new Error("Could not connect to Chrome DevTools"));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id);
      if (message.error) {
        callback.rej(new Error(`${callback.method}: ${message.error.message}`));
      } else {
        callback.res(message.result ?? {});
      }
    };
  });
}

async function waitForWorld(cdp) {
  const expression = `
    new Promise((resolve) => {
      const done = () => Boolean(
        document.querySelector(".world-split") &&
        document.querySelector(".time-scrubber") &&
        document.querySelector(".world-half")
      );
      if (done()) return resolve(true);
      const timer = setInterval(() => {
        if (done()) {
          clearInterval(timer);
          resolve(true);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(timer);
        resolve(done());
      }, 12000);
    })
  `;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.result?.value) return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Execution context was destroyed")) throw error;
    }
    await delay(250);
  }
  throw new Error("World replay did not render");
}

async function prepareReplay(cdp, replaySpeed) {
  const expression = `
    (() => {
      document.documentElement.style.background = "#f5f0e6";
      const style = document.createElement("style");
      style.textContent = ".prompt-dock{display:none!important}.world-classic-link{display:none!important}";
      document.head.appendChild(style);

      const speed = document.querySelector(".time-scrubber select");
      if (speed) {
        speed.value = "${replaySpeed}";
        speed.dispatchEvent(new Event("change", { bubbles: true }));
      }

      const playButton = document.querySelector(".time-scrubber button");
      if (playButton && /▶/.test(playButton.textContent || "")) playButton.click();
      return true;
    })()
  `;
  await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
}

async function renderGif(inputDir, outputFile, inputFps, outputWidth) {
  const palette = path.join(inputDir, "palette.png");
  const framePattern = path.join(inputDir, "frame_%04d.png");
  await run("ffmpeg", [
    "-y",
    "-framerate",
    String(inputFps),
    "-i",
    framePattern,
    "-vf",
    `fps=${inputFps},scale=${outputWidth}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    palette,
  ]);
  await run("ffmpeg", [
    "-y",
    "-framerate",
    String(inputFps),
    "-i",
    framePattern,
    "-i",
    palette,
    "-lavfi",
    `fps=${inputFps},scale=${outputWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    outputFile,
  ]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function cleanupGeneratedDir(dir) {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve("C:\\tmp\\krixi-run-"))) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rm(resolved, { recursive: true, force: true });
      return;
    } catch {
      await delay(500);
    }
  }
  console.warn(`warning: could not remove temporary directory ${resolved}`);
}
