const canvas = document.querySelector(".tensor-canvas");
const ctx = canvas.getContext("2d");
const header = document.querySelector(".site-header");
const featuredVideo = document.querySelector(".featured-video");
const featuredVideoFrame = document.querySelector(".video-landscape");
const colorThresholdSlider = document.querySelector("#color-threshold");
const rattleThresholdSlider = document.querySelector("#rattle-threshold");

const pointer = {
  x: window.innerWidth * 0.5,
  y: window.innerHeight * 0.5,
  tx: window.innerWidth * 0.5,
  ty: window.innerHeight * 0.5,
};

let width = 0;
let height = 0;
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let lastScrollY = window.scrollY;
let featuredVideoHovered = false;
let audioContext = null;
let audioAnalyser = null;
let audioData = null;
let audioReactiveLevel = 0;
let audioPeakLevel = 0;
let audioUnlocked = false;
let audioSource = null;
let analysisReady = false;
let analysisRetryId = null;
let colorThreshold = 0.2;
let rattleThreshold = 0.12;

function setupVideoAudioAnalysis() {
  if (!featuredVideo || analysisReady) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  const stream =
    typeof featuredVideo.captureStream === "function"
      ? featuredVideo.captureStream()
      : typeof featuredVideo.mozCaptureStream === "function"
        ? featuredVideo.mozCaptureStream()
        : null;

  if (!stream || stream.getAudioTracks().length === 0) {
    return;
  }

  audioAnalyser = audioContext.createAnalyser();
  audioAnalyser.fftSize = 256;
  audioAnalyser.smoothingTimeConstant = 0.82;
  audioData = new Uint8Array(audioAnalyser.frequencyBinCount);
  audioSource = audioContext.createMediaStreamSource(stream);
  audioSource.connect(audioAnalyser);
  analysisReady = true;

  if (analysisRetryId) {
    window.clearInterval(analysisRetryId);
    analysisRetryId = null;
  }
}

function ensureVideoAudioAnalysis() {
  setupVideoAudioAnalysis();

  if (analysisReady || analysisRetryId) {
    return;
  }

  analysisRetryId = window.setInterval(() => {
    setupVideoAudioAnalysis();
  }, 400);
}

function resumeVideoAudioContext() {
  if (!audioContext) {
    setupVideoAudioAnalysis();
  }

  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
}

function updateAudioReactiveLevel() {
  const hasFallbackDrive =
    featuredVideo &&
    !featuredVideo.paused &&
    audioUnlocked &&
    featuredVideoHovered;

  if (!analysisReady || !audioAnalyser || !audioData || !audioContext || audioContext.state !== "running") {
    if (hasFallbackDrive) {
      const fallback =
        0.62 +
        Math.abs(Math.sin(featuredVideo.currentTime * 3.8)) * 0.52 +
        Math.abs(Math.sin(featuredVideo.currentTime * 8.6)) * 0.34;
      audioReactiveLevel += (Math.min(fallback, 1) - audioReactiveLevel) * 0.18;
      audioPeakLevel += (Math.min(fallback, 1) - audioPeakLevel) * 0.26;
      return;
    }

    audioReactiveLevel += (0 - audioReactiveLevel) * 0.08;
    audioPeakLevel += (0 - audioPeakLevel) * 0.18;
    return;
  }

  audioAnalyser.getByteFrequencyData(audioData);

  let sum = 0;
  let peak = 0;
  for (let i = 0; i < audioData.length; i += 1) {
    sum += audioData[i];
    if (audioData[i] > peak) {
      peak = audioData[i];
    }
  }

  const average = sum / (audioData.length * 255);
  const boosted = Math.min(1, Math.pow(average, 0.42) * 15.5);
  const boostedPeak = Math.min(1, Math.pow(peak / 255, 0.4) * 1.6);
  audioReactiveLevel += (boosted - audioReactiveLevel) * 0.14;
  audioPeakLevel += (boostedPeak - audioPeakLevel) * 0.22;

  if (audioReactiveLevel < 0.12 && hasFallbackDrive) {
    const fallback =
      0.56 +
      Math.abs(Math.sin(featuredVideo.currentTime * 4.2)) * 0.48 +
      Math.abs(Math.sin(featuredVideo.currentTime * 9.1)) * 0.3;
    audioReactiveLevel += (Math.min(fallback, 1) - audioReactiveLevel) * 0.12;
    audioPeakLevel += (Math.min(fallback, 1) - audioPeakLevel) * 0.16;
  }
}

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function mixAngle(a, b, t) {
  const x = (1 - t) * Math.cos(a) + t * Math.cos(b);
  const y = (1 - t) * Math.sin(a) + t * Math.sin(b);
  return Math.atan2(y, x);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function mixColor(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function getAudioReactiveColor(level) {
  const white = { r: 255, g: 255, b: 255 };
  const green = { r: 64, g: 255, b: 130 };
  const red = { r: 255, g: 68, b: 68 };
  const boostedLevel = clamp(Math.pow(level, 0.55) * 1.22, 0, 1);

  if (boostedLevel <= colorThreshold) {
    return mixColor(white, green, boostedLevel / Math.max(colorThreshold, 0.001));
  }

  return mixColor(green, red, (boostedLevel - colorThreshold) / Math.max(1 - colorThreshold, 0.001));
}

function fieldAngle(x, y, now) {
  const nx = x / width - 0.5;
  const ny = y / height - 0.5;
  const base =
    Math.sin(nx * 6.2 + now * 0.0007) * 0.95 +
    Math.cos(ny * 7.4 - now * 0.00055) * 0.7 +
    Math.sin((nx - ny) * 9.5 + now * 0.00035) * 0.3;

  let targetX = pointer.x;
  let targetY = pointer.y;
  let targetBlend = 0.95;

  if (featuredVideoHovered && featuredVideoFrame) {
    const rect = featuredVideoFrame.getBoundingClientRect();
    targetX = rect.left + rect.width * 0.5;
    targetY = rect.top + rect.height * 0.5;
    targetBlend = 1;
  }

  const dx = targetX - x;
  const dy = targetY - y;
  const distance = Math.hypot(dx, dy);
  const cursorAngle = Math.atan2(dy, dx) + Math.PI * 0.5;
  const radius = featuredVideoHovered
    ? Math.max(width, height) * 0.95
    : Math.min(width, height) * 0.36;
  const influence = featuredVideoHovered
    ? 1 - clamp(distance / radius, 0, 1) * 0.35
    : Math.max(0, 1 - distance / radius);
  const eased = influence * influence * (3 - 2 * influence);

  return mixAngle(base, cursorAngle, eased * targetBlend);
}

function draw(now) {
  updateAudioReactiveLevel();

  pointer.x += (pointer.tx - pointer.x) * 0.08;
  pointer.y += (pointer.ty - pointer.y) * 0.08;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = `rgba(0, 0, 0, ${0.16 + audioReactiveLevel * 0.1})`;
  ctx.fillRect(0, 0, width, height);

  const spacing = width < 700 ? 24 : 30;
  const lineLength = spacing * (0.8 + audioReactiveLevel * 0.12);
  const reactiveColor = getAudioReactiveColor(audioReactiveLevel);
  const rattleStrength = clamp((audioPeakLevel - rattleThreshold) / Math.max(1 - rattleThreshold, 0.001), 0, 1);

  for (let y = spacing * 0.5; y < height + spacing; y += spacing) {
    for (let x = spacing * 0.5; x < width + spacing; x += spacing) {
      const angle = fieldAngle(x, y, now);
      const intensity =
        0.2 +
        0.8 * Math.abs(Math.sin(angle + now * 0.00045)) +
        audioReactiveLevel * 0.2;
      const rattleX =
        Math.sin(now * 0.045 + x * 0.09 + y * 0.04) *
        spacing *
        0.52 *
        rattleStrength;
      const rattleY =
        Math.cos(now * 0.052 + x * 0.05 - y * 0.08) *
        spacing *
        0.52 *
        rattleStrength;
      const vx = Math.cos(angle) * lineLength * 0.5;
      const vy = Math.sin(angle) * lineLength * 0.5;
      const alpha = 0.22 + clamp(intensity, 0, 1.4) * 0.5;
      ctx.strokeStyle = `rgba(${Math.round(reactiveColor.r)}, ${Math.round(reactiveColor.g)}, ${Math.round(reactiveColor.b)}, ${alpha})`;
      ctx.lineWidth = 1 + audioReactiveLevel * 0.38 + rattleStrength * 1.1;
      ctx.beginPath();
      ctx.moveTo(x + rattleX - vx, y + rattleY - vy);
      ctx.lineTo(x + rattleX + vx, y + rattleY + vy);
      ctx.stroke();
    }
  }

  const glow = ctx.createRadialGradient(
    pointer.x,
    pointer.y,
    0,
    pointer.x,
    pointer.y,
    Math.min(width, height) * 0.18
  );
  glow.addColorStop(
    0,
    `rgba(${Math.round(reactiveColor.r)}, ${Math.round(reactiveColor.g)}, ${Math.round(reactiveColor.b)}, ${0.12 + audioReactiveLevel * 0.18})`
  );
  glow.addColorStop(
    0.55,
    `rgba(${Math.round(reactiveColor.r)}, ${Math.round(reactiveColor.g)}, ${Math.round(reactiveColor.b)}, ${0.04 + audioReactiveLevel * 0.08})`
  );
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(
    pointer.x,
    pointer.y,
    Math.min(width, height) * (0.18 + audioReactiveLevel * 0.03),
    0,
    Math.PI * 2
  );
  ctx.fill();

  requestAnimationFrame(draw);
}

window.addEventListener("resize", resize);

window.addEventListener("pointermove", (event) => {
  pointer.tx = event.clientX;
  pointer.ty = event.clientY;
});

window.addEventListener("touchmove", (event) => {
  const touch = event.touches[0];
  if (!touch) {
    return;
  }

  pointer.tx = touch.clientX;
  pointer.ty = touch.clientY;
}, { passive: true });

window.addEventListener("pointerleave", () => {
  pointer.tx = width * 0.5;
  pointer.ty = height * 0.5;
});

window.addEventListener("scroll", () => {
  const currentScrollY = window.scrollY;
  const scrollingDown = currentScrollY > lastScrollY;
  const beyondThreshold = currentScrollY > 80;

  if (scrollingDown && beyondThreshold) {
    header.classList.add("is-hidden");
  } else {
    header.classList.remove("is-hidden");
  }

  lastScrollY = currentScrollY;
}, { passive: true });

if (featuredVideo) {
  function keepFeaturedVideoPlaying() {
    featuredVideo.play().catch(() => {});
  }

  function syncHoverAudio() {
    featuredVideo.muted = !(audioUnlocked && featuredVideoHovered);
    featuredVideo.volume = audioUnlocked && featuredVideoHovered ? 0.5 : 0.5;
  }

  function unlockFeaturedVideoAudio() {
    audioUnlocked = true;
    resumeVideoAudioContext();
    featuredVideo.muted = false;
    featuredVideo.volume = 0.5;
    syncHoverAudio();
    keepFeaturedVideoPlaying();
  }

  featuredVideo.addEventListener("pointerenter", () => {
    featuredVideoHovered = true;
    syncHoverAudio();
    keepFeaturedVideoPlaying();
  });

  featuredVideo.addEventListener("pointerleave", () => {
    featuredVideoHovered = false;
    syncHoverAudio();
    keepFeaturedVideoPlaying();
  });

  featuredVideo.addEventListener("click", unlockFeaturedVideoAudio);

  featuredVideo.addEventListener("pause", () => {
    if (featuredVideo.ended) {
      return;
    }

    keepFeaturedVideoPlaying();
  });

  featuredVideo.addEventListener("play", () => {
    ensureVideoAudioAnalysis();
    resumeVideoAudioContext();
  });

  featuredVideo.addEventListener("playing", () => {
    ensureVideoAudioAnalysis();
    resumeVideoAudioContext();
    syncHoverAudio();
  });

  featuredVideo.addEventListener("loadedmetadata", () => {
    featuredVideo.currentTime = 0;
    featuredVideo.volume = 0.5;
    ensureVideoAudioAnalysis();
    keepFeaturedVideoPlaying();
  });

  featuredVideo.muted = true;
  featuredVideo.autoplay = true;
  featuredVideo.volume = 0.5;
  keepFeaturedVideoPlaying();
}

window.addEventListener("pointerdown", () => {
  if (!audioUnlocked) {
    return;
  }

  resumeVideoAudioContext();
}, { passive: true });

window.addEventListener("keydown", () => {
  if (!audioUnlocked) {
    return;
  }

  resumeVideoAudioContext();
});

if (colorThresholdSlider) {
  colorThresholdSlider.addEventListener("input", () => {
    colorThreshold = clamp(Number(colorThresholdSlider.value) / 100, 0.01, 0.95);
  });
}

if (rattleThresholdSlider) {
  rattleThresholdSlider.addEventListener("input", () => {
    rattleThreshold = clamp(Number(rattleThresholdSlider.value) / 100, 0, 0.95);
  });
}

resize();
requestAnimationFrame(draw);
