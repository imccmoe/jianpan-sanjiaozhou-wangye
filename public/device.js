const VID = 0x1a86;
const APP_PID = 0xfe01;
const BOOT_PID = 0xfe02;
const REPORT_ID = 0;
const PACKET_SIZE = 63;
const MUSIC_DATA_SIZE = 48;

const MUSIC = {
  magic: [0x53, 0x42, 0x4d, 0x31],
  ping: 0x01,
  status: 0x02,
  begin: 0x10,
  data: 0x11,
  commit: 0x12,
  abort: 0x13,
  play: 0x20,
  stop: 0x21,
  enterIap: 0x30,
};

export const webHidSupported = "hid" in navigator;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function crc16(bytes) {
  let crc = 0xffff;
  for (const value of bytes) {
    crc ^= value << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function writeU16(array, offset, value) {
  array[offset] = value & 0xff;
  array[offset + 1] = (value >>> 8) & 0xff;
}

function buildMusicPacket(command, options = {}) {
  const data = options.data || new Uint8Array();
  const packet = new Uint8Array(PACKET_SIZE);
  packet.set(MUSIC.magic);
  packet[4] = command;
  packet[5] = options.session || 0;
  packet[6] = options.sequence || 0;
  packet[7] = options.slot ?? 0xff;
  writeU16(packet, 8, options.offset || 0);
  writeU16(packet, 10, options.total || 0);
  packet[12] = data.length;
  packet.set(data, 13);
  writeU16(packet, 61, crc16(packet.slice(0, 61)));
  return packet;
}

function viewBytes(dataView) {
  return new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
}

function parseMusicResponse(dataView) {
  let bytes = viewBytes(dataView);
  if (bytes.length >= 64 && bytes[0] === 0) bytes = bytes.slice(1, 64);
  if (bytes.length < 63 || !MUSIC.magic.every((value, index) => bytes[index] === value)) {
    throw new Error("设备响应格式无效");
  }
  if ((bytes[61] | (bytes[62] << 8)) !== crc16(bytes.slice(0, 61))) throw new Error("设备响应 CRC 无效");
  const u16 = (offset) => bytes[offset] | (bytes[offset + 1] << 8);
  const u32 = (offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  return {
    command: bytes[4], session: bytes[5], sequence: bytes[6], status: bytes[7],
    expectedSequence: bytes[8], validMask: bytes[9], protocolVersion: bytes[11],
    activeSlot: bytes[12], playing: Boolean(bytes[13] & 1), eventIndex: u16(14),
    eventCount: u16(16), elapsedMs: u32(18), durationMs: u32(22),
    received: u16(26), total: u16(28), keyMask: bytes[31] & 7,
    detail: bytes[32], firmwareVersion: u32(33),
  };
}

function statusError(response) {
  const messages = {
    0x80: "通信包格式错误", 0x81: "通信包 CRC 校验失败", 0x82: "传输会话不存在或已超时",
    0x83: "通信包顺序不正确", 0x84: "通信包长度或槽位超出范围", 0x85: "音乐数据无效",
    0x86: "音乐数据尚未接收完整", 0x87: "Flash 写入失败", 0x88: "传输超时",
    0x89: "设备忙，请先停止播放", 0x8a: "设备不支持该命令",
  };
  return new Error(`${messages[response.status] || `设备错误 0x${response.status.toString(16)}`}（详情 0x${response.detail.toString(16)}）`);
}

export class MusicHidDevice {
  constructor(onDisconnect) {
    this.device = null;
    this.onDisconnect = onDisconnect;
    if (webHidSupported) {
      navigator.hid.addEventListener("disconnect", (event) => {
        if (event.device === this.device) {
          this.device = null;
          this.onDisconnect?.();
        }
      });
    }
  }

  async authorizedDevices() {
    if (!webHidSupported) return [];
    return (await navigator.hid.getDevices()).filter((device) => device.vendorId === VID && device.productId === APP_PID);
  }

  async connect({ request = false } = {}) {
    if (!webHidSupported) throw new Error("当前浏览器不支持 WebHID，请使用桌面版 Chrome 或 Edge");
    const devices = request
      ? await navigator.hid.requestDevice({ filters: [{ vendorId: VID, productId: APP_PID }] })
      : await this.authorizedDevices();
    if (!devices.length) throw new Error("未发现已授权的 GXM 键盘");
    this.device = devices[0];
    if (!this.device.opened) await this.device.open();
    return this.ping();
  }

  async exchange(packet, timeout = 900) {
    if (!this.device?.opened) throw new Error("请先连接 GXM 键盘");
    const expected = [packet[4], packet[5], packet[6]];
    await this.device.sendFeatureReport(REPORT_ID, packet);
    const deadline = performance.now() + timeout;
    let lastError = null;
    while (performance.now() < deadline) {
      try {
        const response = parseMusicResponse(await this.device.receiveFeatureReport(REPORT_ID));
        if (response.command === expected[0] && response.session === expected[1] && response.sequence === expected[2]) {
          if (response.protocolVersion !== 1) throw new Error(`USB 协议版本不一致：${response.protocolVersion}`);
          if (response.status >= 0x80) throw statusError(response);
          return response;
        }
      } catch (error) {
        lastError = error;
      }
      await delay(12);
    }
    throw new Error(`设备未确认 USB 通信包${lastError ? `：${lastError.message}` : ""}`);
  }

  ping() { return this.exchange(buildMusicPacket(MUSIC.ping)); }
  getStatus() { return this.exchange(buildMusicPacket(MUSIC.status)); }
  play(slot) { return this.exchange(buildMusicPacket(MUSIC.play, { slot })); }
  stop() { return this.exchange(buildMusicPacket(MUSIC.stop)); }

  async upload(slot, packageBytes, onProgress) {
    if (packageBytes.length < 32 || packageBytes.length > 4096) throw new Error("音乐数据长度无效");
    await this.stop();
    const session = Math.floor(Math.random() * 255) + 1;
    let sequence = 0;
    let response = await this.exchange(buildMusicPacket(MUSIC.begin, {
      session, sequence, slot, data: new TextEncoder().encode("MUSICPKG\x01"),
    }));
    if (response.status !== 1) throw new Error("设备没有进入音乐接收模式");
    sequence = 1;
    try {
      for (let offset = 0; offset < packageBytes.length; offset += MUSIC_DATA_SIZE) {
        const chunk = packageBytes.slice(offset, offset + MUSIC_DATA_SIZE);
        response = await this.exchange(buildMusicPacket(MUSIC.data, {
          session, sequence, slot, offset, total: packageBytes.length, data: chunk,
        }));
        sequence = (sequence + 1) & 0xff;
        onProgress?.(Math.min(offset + chunk.length, packageBytes.length), packageBytes.length);
      }
      if (response.status !== 2) throw new Error("设备未确认完整音乐数据");
      response = await this.exchange(buildMusicPacket(MUSIC.commit, {
        session, sequence, slot, data: new TextEncoder().encode("FLASHNOW"),
      }), 5200);
      if (response.status !== 3 || !(response.validMask & (1 << slot))) throw new Error("设备未确认音乐已写入 Flash");
      return response;
    } catch (error) {
      try { await this.exchange(buildMusicPacket(MUSIC.abort, { session, sequence, slot }), 350); } catch { /* best effort */ }
      throw error;
    }
  }

  async enterIap() {
    const response = await this.exchange(buildMusicPacket(MUSIC.enterIap, {
      data: new TextEncoder().encode("ENTERIAP"),
    }), 1400);
    if (response.status !== 4) throw new Error("设备没有确认进入更新模式");
    return response;
  }
}

export async function requestBootloader() {
  if (!webHidSupported) throw new Error("当前浏览器不支持 WebHID");
  const authorized = (await navigator.hid.getDevices()).filter((device) => device.vendorId === VID && device.productId === BOOT_PID);
  const devices = authorized.length ? authorized : await navigator.hid.requestDevice({ filters: [{ vendorId: VID, productId: BOOT_PID }] });
  if (!devices.length) throw new Error("未发现 GXM Bootloader");
  const device = devices[0];
  if (!device.opened) await device.open();
  return device;
}

const IAP = {
  magic: [0x53, 0x42, 0x49, 0x31],
  ping: 0x01,
  status: 0x02,
  begin: 0x10,
  data: 0x11,
  end: 0x12,
};

function writeU32(array, offset, value) {
  array[offset] = value & 0xff;
  array[offset + 1] = (value >>> 8) & 0xff;
  array[offset + 2] = (value >>> 16) & 0xff;
  array[offset + 3] = (value >>> 24) & 0xff;
}

function buildIapPacket(command, options = {}) {
  const data = options.data || new Uint8Array();
  const packet = new Uint8Array(PACKET_SIZE);
  packet.set(IAP.magic);
  packet[4] = command;
  packet[5] = options.session || 0;
  packet[6] = options.sequence || 0;
  writeU32(packet, 8, options.offset || 0);
  writeU32(packet, 12, options.total || 0);
  packet[16] = data.length;
  packet.set(data, 17);
  writeU16(packet, 61, crc16(packet.slice(0, 61)));
  return packet;
}

function parseIapResponse(dataView) {
  let bytes = viewBytes(dataView);
  if (bytes.length >= 64 && bytes[0] === 0) bytes = bytes.slice(1, 64);
  if (bytes.length < 63 || !IAP.magic.every((value, index) => bytes[index] === value)) throw new Error("Bootloader 响应格式无效");
  if ((bytes[61] | (bytes[62] << 8)) !== crc16(bytes.slice(0, 61))) throw new Error("Bootloader 响应 CRC 无效");
  const u32 = (offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  return {
    command: bytes[4], session: bytes[5], sequence: bytes[6], status: bytes[7],
    progressOffset: u32(8), imageSize: u32(12), phase: bytes[18],
    erasedPages: bytes[19], totalPages: bytes[20], imageCrc32: u32(21),
    errorCode: u32(25), errorOffset: u32(29), bootVersion: u32(33),
  };
}

async function iapExchange(device, packet, timeout = 900, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await device.sendFeatureReport(REPORT_ID, packet);
      const deadline = performance.now() + timeout;
      while (performance.now() < deadline) {
        try {
          const response = parseIapResponse(await device.receiveFeatureReport(REPORT_ID));
          if (response.command === packet[4] && response.session === packet[5] && response.sequence === packet[6]) {
            if (response.status >= 0x80) throw new Error(`Bootloader 错误 0x${response.status.toString(16)}，位置 0x${response.errorOffset.toString(16)}`);
            return response;
          }
        } catch (error) {
          lastError = error;
        }
        await delay(8);
      }
      throw new Error("Bootloader 未确认通信包");
    } catch (error) {
      lastError = error;
      await delay(30);
    }
  }
  throw lastError || new Error("Bootloader 通信失败");
}

export async function uploadFirmware(device, image, onProgress) {
  let sequence = 0;
  const nextSequence = () => {
    const value = sequence;
    sequence = (sequence + 1) & 0xff;
    return value;
  };
  const command = (cmd, options = {}, timeout = 900) => iapExchange(device, buildIapPacket(cmd, {
    ...options,
    sequence: nextSequence(),
  }), timeout);
  const ping = await command(IAP.ping);
  if (ping.bootVersion < 0x0001000a) throw new Error("Bootloader 版本过旧，禁止网页升级以保护音乐区");

  const session = Math.floor(Math.random() * 255) + 1;
  const metadata = new Uint8Array(16);
  writeU32(metadata, 0, image.data.length);
  writeU32(metadata, 4, image.crc32);
  writeU32(metadata, 8, 0x00003100);
  writeU32(metadata, 12, image.firmwareVersion || 0);
  let response = await command(IAP.begin, { session, data: metadata });
  onProgress?.(2, "正在准备 APP 分区");
  const started = performance.now();
  while (response.phase !== 2) {
    if (performance.now() - started > 90000) throw new Error("固件升级超时");
    await delay(45);
    response = await command(IAP.status, { session });
    if (response.phase === 5) throw new Error("Bootloader 擦除 APP 分区失败");
    const pages = response.totalPages || 10;
    onProgress?.(2 + Math.floor(13 * response.erasedPages / pages), `正在擦除 APP：${response.erasedPages}/${pages}`);
  }

  let offset = response.progressOffset;
  while (offset < image.data.length) {
    const chunk = image.data.slice(offset, offset + 44);
    response = await command(IAP.data, { session, offset, total: image.data.length, data: chunk }, 700);
    if (response.progressOffset <= offset) throw new Error(`固件下载在 ${offset} 字节处没有进展`);
    offset = response.progressOffset;
    const percent = Math.floor(offset * 100 / image.data.length);
    onProgress?.(15 + Math.floor(offset * 75 / image.data.length), `正在下载固件：${percent}%`);
  }

  response = await command(IAP.end, { session });
  if (response.status !== 4) throw new Error("Bootloader 未进入校验阶段");
  onProgress?.(90, "正在校验设备内固件");
  while (response.phase !== 4) {
    await delay(40);
    response = await command(IAP.status, { session });
    if (response.phase === 5) throw new Error("设备端固件校验失败");
    onProgress?.(90 + Math.floor(9 * response.progressOffset / image.data.length), "正在校验设备内固件");
  }
  if (response.imageCrc32 !== image.crc32) throw new Error("设备端 CRC32 与更新文件不一致");
  onProgress?.(100, "固件升级完成，等待 APP 重新连接");
  return response;
}
