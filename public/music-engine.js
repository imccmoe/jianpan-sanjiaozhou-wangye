const DEGREE_USAGES = [0x1d, 0x1b, 0x06, 0x19, 0x05, 0x11, 0x10];
const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const HIGH_ONE_USAGE = 0x36;
const MUSIC_MAGIC = 0x3153554d;
const HEADER_SIZE = 32;
const EVENT_SIZE = 4;
const MAX_EVENTS = (4096 - HEADER_SIZE) / EVENT_SIZE;

let audioContext = null;
let activePreview = null;

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(array, offset, value) {
  array[offset] = value & 0xff;
  array[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(array, offset, value) {
  array[offset] = value & 0xff;
  array[offset + 1] = (value >>> 8) & 0xff;
  array[offset + 2] = (value >>> 16) & 0xff;
  array[offset + 3] = (value >>> 24) & 0xff;
}

function parseScore(text, rhythm) {
  const notes = [];
  const source = String(text || "");
  let octave = 0;
  let closing = "";
  let opening = -1;
  let sharpAt = -1;
  let modifierAllowed = false;
  let dotted = false;
  let extended = false;
  let reductions = 0;
  let explicitDuration = false;
  let skipUntil = 0;

  const fail = (index, message) => {
    throw new Error(`第 ${index + 1} 个字符：${message}`);
  };

  for (let index = 0; index < source.length; index += 1) {
    if (index < skipUntil) continue;
    const char = source[index];
    if (/\s/.test(char) || char === "\ufeff") continue;
    if (char === "|" || char === "｜") {
      modifierAllowed = false;
      continue;
    }
    if (rhythm && char === ":") {
      if (!modifierAllowed || !notes.length || sharpAt >= 0) fail(index, "指定拍数位置无效");
      if (explicitDuration || dotted || extended || reductions) fail(index, "指定拍数不能与其他时值符号混用");
      const match = source.slice(index + 1).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) fail(index, "冒号后面缺少拍数");
      const beats = Number(match[0]);
      if (!(beats > 0 && beats <= 64)) fail(index, "指定拍数须大于 0 且不超过 64 拍");
      notes.at(-1).beats = beats;
      explicitDuration = true;
      skipUntil = index + 1 + match[0].length;
      continue;
    }
    if (rhythm && "-—_.".includes(char)) {
      if (!modifierAllowed || !notes.length || sharpAt >= 0) fail(index, "时值符号位置无效");
      if (explicitDuration) fail(index, "指定拍数不能与其他时值符号混用");
      const previous = notes.at(-1);
      if (char === "_") {
        if (dotted || extended || reductions >= 2) fail(index, "减时符最多两条");
        reductions += 1;
        previous.beats /= 2;
      } else if (char === ".") {
        if (dotted || extended) fail(index, "仅支持一个附点");
        dotted = true;
        previous.beats *= 1.5;
      } else {
        extended = true;
        previous.beats += 1;
      }
      continue;
    }
    if ("【（(".includes(char)) {
      if (closing) fail(index, "不支持嵌套音区括号");
      octave = char === "【" ? 1 : -1;
      closing = char === "【" ? "】" : char === "（" ? "）" : ")";
      opening = index;
    } else if ("】）)".includes(char)) {
      if (char !== closing) fail(index, "结束括号不匹配");
      octave = 0;
      closing = "";
    } else if (char === "#") {
      if (sharpAt >= 0) fail(index, "不支持连续 #");
      sharpAt = index;
    } else if (char >= "0" && char <= "7") {
      const degree = Number(char);
      if (degree === 0 && sharpAt >= 0) fail(index, "休止符不能升半音");
      notes.push({ degree, octave, sharp: sharpAt >= 0, beats: 1 });
      modifierAllowed = true;
      dotted = false;
      extended = false;
      reductions = 0;
      explicitDuration = false;
      sharpAt = -1;
    } else {
      fail(index, `无法识别“${char}”`);
    }
  }
  if (sharpAt >= 0) fail(sharpAt, "# 后面缺少音符");
  if (closing) fail(opening, "缺少结束括号");
  if (!notes.length) throw new Error("没有可演奏的音符");
  return notes;
}

function noteToHid(note) {
  if (note.degree === 0) return { keyUsage: 0, mouseButtons: 0 };
  const keyUsage = note.octave === 1 && note.degree === 1
    ? HIGH_ONE_USAGE
    : DEGREE_USAGES[note.degree - 1];
  let mouseButtons = 0;
  if (note.octave === -1) mouseButtons |= 0x01;
  if (note.octave === 1 && note.degree !== 1) mouseButtons |= 0x02;
  if (note.sharp) mouseButtons |= 0x04;
  return { keyUsage, mouseButtons };
}

function noteSemitone(note) {
  return note.octave * 12 + DEGREE_SEMITONES[note.degree - 1] + (note.sharp ? 1 : 0);
}

function roundHalfEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (Math.abs(fraction - 0.5) < Number.EPSILON * Math.max(1, value) * 2) {
    return lower % 2 === 0 ? lower : lower + 1;
  }
  return Math.round(value);
}

export function compileSong(song) {
  const rhythm = Boolean(song.rhythm);
  const bpm = Number(song.bpm || 120);
  const gapMs = Number(song.gap_ms ?? 20);
  const beatMs = rhythm ? 60000 / bpm : 300;
  const notes = parseScore(song.score, rhythm);
  const events = notes.map((note) => {
    const durationMs = roundHalfEven(note.beats * beatMs);
    const hid = noteToHid(note);
    if (hid.keyUsage && durationMs - gapMs < 40) throw new Error("音符有效时间不足 40 ms");
    return { ...hid, durationMs, note };
  });
  if (events.length > MAX_EVENTS) throw new Error(`曲目事件超过单槽 ${MAX_EVENTS} 个上限`);

  const eventData = new Uint8Array(events.length * EVENT_SIZE);
  events.forEach((event, index) => {
    const offset = index * EVENT_SIZE;
    writeU16(eventData, offset, event.durationMs);
    eventData[offset + 2] = event.keyUsage;
    eventData[offset + 3] = event.mouseButtons;
  });
  const durationMs = events.reduce((sum, event) => sum + event.durationMs, 0);
  const header = new Uint8Array(HEADER_SIZE);
  writeU32(header, 0, MUSIC_MAGIC);
  writeU16(header, 4, 1);
  writeU16(header, 6, HEADER_SIZE);
  writeU16(header, 8, events.length);
  writeU16(header, 10, gapMs);
  writeU32(header, 12, crc32(eventData));
  writeU32(header, 16, durationMs);
  writeU32(header, 20, rhythm ? 1 : 0);
  writeU32(header, 28, crc32(header.slice(0, 28)));
  const packageBytes = new Uint8Array(header.length + eventData.length);
  packageBytes.set(header);
  packageBytes.set(eventData, header.length);
  return { events, notes, durationMs, gapMs, packageBytes };
}

export function formatDuration(milliseconds) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function stopPreview() {
  if (!activePreview) return;
  window.clearTimeout(activePreview.timer);
  for (const source of activePreview.sources) {
    try { source.stop(); } catch { /* already stopped */ }
  }
  const done = activePreview.onDone;
  activePreview = null;
  done?.();
}

export async function startPreview(compiled, onDone) {
  stopPreview();
  audioContext ||= new AudioContext();
  await audioContext.resume();
  const sources = [];
  const startAt = audioContext.currentTime + 0.04;
  let elapsed = 0;
  for (const event of compiled.events) {
    const noteSeconds = Math.max(0.04, (event.durationMs - compiled.gapMs) / 1000);
    if (event.note.degree !== 0) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = 261.626 * 2 ** (noteSemitone(event.note) / 12);
      gain.gain.setValueAtTime(0.0001, startAt + elapsed);
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + elapsed + 0.012);
      gain.gain.setValueAtTime(0.12, startAt + elapsed + Math.max(0.018, noteSeconds - 0.018));
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + elapsed + noteSeconds);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(startAt + elapsed);
      oscillator.stop(startAt + elapsed + noteSeconds + 0.01);
      sources.push(oscillator);
    }
    elapsed += event.durationMs / 1000;
  }
  const timer = window.setTimeout(() => {
    const done = activePreview?.onDone;
    activePreview = null;
    done?.();
  }, Math.ceil(elapsed * 1000) + 100);
  activePreview = { sources, timer, onDone };
}
