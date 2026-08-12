import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const PAGE_URL = "https://orzice.com/v/gun_gqm";
const BASE = "https://orzice.com";
const LIMIT = Number(process.env.LIMIT || 99);
const SLEEP_MS = Number(process.env.SLEEP_MS || 350);

const rawOut = path.join(ROOT, "data", "orzice-gqm-raw.json");
const normalizedOut = path.join(ROOT, "public", "data", "schemes.json");
const apiTraceOut = path.join(ROOT, "data", "orzice-gqm-api-trace.json");

const categories = [
  ["全部", "全部"],
  ["步枪", "全部"],
  ["冲锋枪", "全部"],
  ["轻机枪", "全部"],
  ["霰弹枪", "全部"],
  ["精确射手步枪", "全部"],
  ["狙击步枪", "全部"],
  ["手枪", "全部"],
  ["特殊武器", "全部"]
];

const solutionTypes = [
  { id: "gun", mode: "operations" },
  { id: "operator", mode: "warfare" }
];

const pageHtml = await fetchText(PAGE_URL);
const globals = extractGlobals(pageHtml);
const apiBasePath = discoverGqmApiPath();
const helpers = createBrowserHelpers(globals);
const getPath = helpers.GetPath;

const rawItems = [];
const traces = [];

for (const solution of solutionTypes) {
  for (const [key1, key2] of categories) {
    let page = 1;
    let totalPages = 1;

    do {
      const param = `key1=${key1}&key2=${key2}&p=${page}&limit=${LIMIT}&top=0&top2=0&n=&solutionType=${solution.id}`;

      const url = `${BASE}${apiBasePath}${getPath(param)}`;
      console.log(`[抓取] ${solution.id} ${key1}/${key2} 第 ${page}/${totalPages} 页`);
      const response = await fetchJson(url);
      traces.push({ solutionType: solution.id, key1, key2, page, url, code: response.code, count: response.count });

      if (response.code !== 0) {
        console.warn(`接口返回异常：${response.msg || response.code}`);
        break;
      }

      const data = helpers.GetData01(response.data);
      const list = Array.isArray(data) ? data : data.data || data.list || [];
      const count = Number(response.count || data.count || list.length || 0);
      totalPages = Math.max(1, Math.ceil(count / LIMIT));

      for (const item of list) {
        rawItems.push({ ...item, _solutionType: solution.id, _mode: solution.mode, _category: key1 });
      }

      page += 1;
      await sleep(SLEEP_MS);
    } while (page <= totalPages);
  }
}

const uniqueRaw = uniqueBy(rawItems, (item) => String(item.id || item.code || item.objectName || JSON.stringify(item)));
const schemes = uniqueRaw.map(normalizeScheme);

writeJson(rawOut, uniqueRaw);
writeJson(normalizedOut, schemes);
writeJson(apiTraceOut, traces);

console.log(`完成：原始 ${uniqueRaw.length} 条 -> ${rawOut}`);
console.log(`完成：网站数据 ${schemes.length} 条 -> ${normalizedOut}`);

function discoverGqmApiPath() {
  const source = fs.readFileSync(path.join(ROOT, "orzice-base_2.js"), "utf8");
  const matches = [...source.matchAll(/\/api\/sjz\/[a-z0-9_/-]+/gi)].map((match) => match[0]);
  const gqm = matches.find((item) => item.toLowerCase().includes("gqm"));
  if (gqm) return gqm;

  const known = ["/api/sjz/gun_gqm", "/api/sjz/gqm", "/api/sjz/gqm_list"];
  return known[0];
}

function createBrowserHelpers(globals) {
  const cryptoSource = fs.readFileSync(path.join(ROOT, "orzice-crypto-js.min.js"), "utf8");
  const tokenSource = fs.readFileSync(path.join(ROOT, "orzice-token.js"), "utf8");
  const sandbox = {
    console,
    global: null,
    process,
    setInterval() {},
    clearInterval() {},
    setTimeout() {},
    clearTimeout() {},
    navigator: { userAgent: "Mozilla/5.0" },
    location: { href: PAGE_URL, pathname: "/v/gun_gqm", host: "orzice.com" },
    document: {
      domain: "orzice.com",
      location: { href: PAGE_URL, pathname: "/v/gun_gqm", host: "orzice.com" },
      cookie: "",
      createElement() {
        return {};
      },
      getElementsByTagName() {
        return [{ parentNode: { insertBefore() {} } }];
      }
    },
    AA: globals.AA,
    AB: globals.AB,
    AC: globals.AC,
    TimeUnix: globals.TimeUnix,
    _localBase: Date.now(),
    GetTimeUnix() {
      return globals.TimeUnix;
    },
    AppDataVue: {
      Tips() {}
    },
    base_vue: {
      $message() {}
    }
  };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(cryptoSource, sandbox);
  sandbox.CryptoJS = sandbox.window.CryptoJS || sandbox.CryptoJS;
  vm.runInContext(tokenSource, sandbox);
  if (typeof sandbox.GetPath !== "function" || typeof sandbox.GetData01 !== "function") {
    throw new Error("未能从 token.js 加载 GetPath/GetData01");
  }
  return {
    GetPath: sandbox.GetPath,
    GetData01: sandbox.GetData01
  };
}

function normalizeScheme(item, index) {
  const props = Array.isArray(item.properties_data)
    ? item.properties_data
    : Array.isArray(item.prop)
      ? item.prop
      : Array.isArray(item.props)
        ? item.props
        : [];
  const propMap = Object.fromEntries(props.map((prop) => [prop.name, prop]));
  const name = item.name || item.title || item.weaponName || item.objectName || "未知枪械";
  const objectName = item.objectName || item.weaponName || name;
  const code = item.solutionCode || item.code || item.shareCode || item.gunCode || item.gqm || "";
  const category = item.m_type || (item._category === "全部" ? inferType(objectName) : item._category);
  return {
    id: `orzice-${item._solutionType || "gun"}-${item.id || index + 1}`,
    sourceId: item.id || null,
    source: "orzice-authorized",
    game: "delta",
    mode: item._mode || "operations",
    weapon: name,
    objectName,
    type: category,
    ammo: item.ammo || item.bullet || "未知",
    map: item.map || item.mapName || "任意",
    image: normalizeUrl(item.pic || item.img || item.image || item.objectPic),
    value: number(item.zb || item.value || item.valueScore || item.totalPrice),
    price: number(item.price),
    users: number(item.applyNum || item.useCount || item.use_count || item.copyCount || item.hot || item.count),
    likes: number(item.likeNum || item.likeCount || item.likes || item.zan),
    author: item.authorNickname || item.author || item.nickname || "Orzice",
    status: "active",
    code,
    sensitivity: item.sensitivity || item.desc || "",
    config: code,
    params: {
      control: number(propMap["操控"]?.value || propMap["控制"]?.value || item.control),
      stability: number(propMap["稳定"]?.value || item.stability),
      hip: number(propMap["腰射"]?.value || item.hip),
      range: number(propMap["射程"]?.value || item.range),
      ads: number(propMap["开镜速度"]?.value || item.ads),
      recoil: String(propMap["后座"]?.value || propMap["后坐力控制"]?.value || item.recoil || ""),
      interval: "",
      scope: ""
    },
    feedback: { invalid: 0, inaccurate: 0, good: 0, weak: 0 },
    raw: item
  };
}

function normalizeUrl(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}

function inferType(name) {
  if (name.includes("冲锋")) return "冲锋枪";
  if (name.includes("机枪")) return "轻机枪";
  if (name.includes("霰弹")) return "霰弹枪";
  if (name.includes("狙击")) return "狙击步枪";
  if (name.includes("射手")) return "精确射手步枪";
  if (name.includes("手枪") || ["G17", "G18", "93R", "M1911"].some((key) => name.includes(key))) return "手枪";
  return "步枪";
}

function extractGlobals(html) {
  return {
    AA: mustMatch(html, /var AA = "([^"]+)"/, "AA"),
    AB: mustMatch(html, /var AB = "([^"]+)"/, "AB"),
    AC: mustMatch(html, /var AC = "([^"]+)"/, "AC"),
    TimeUnix: Number(mustMatch(html, /var TimeUnix =\s*(\d+)/, "TimeUnix"))
  };
}

function mustMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`未找到 ${label}`);
  return match[1];
}

async function fetchText(url) {
  const response = await fetch(url, { headers: browserHeaders() });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: browserHeaders() });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function browserHeaders() {
  return {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "accept": "application/json,text/plain,*/*",
    "referer": PAGE_URL
  };
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function number(value) {
  const parsed = Number(String(value || 0).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
