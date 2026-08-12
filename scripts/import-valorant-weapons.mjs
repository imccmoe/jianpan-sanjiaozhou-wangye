import fs from "node:fs";
import path from "node:path";

const sourceUrl = "https://ajaxgodlike.github.io/Valorant/weapons.html";
const sourceBase = "https://ajaxgodlike.github.io/Valorant/";
const outputFile = process.argv[2] || "public/data/schemes.json";
const rawOutputFile = process.argv[3] || "data/valorant-weapons-raw.json";

const categoryNames = {
  sidearm: "随身武器",
  smg: "冲锋枪",
  shotgun: "霰弹枪",
  rifle: "步枪",
  sniper: "狙击枪",
  heavy: "重型武器"
};

const englishNames = {
  经典: "classic",
  短炮: "shorty",
  狂弑: "frenzy",
  鬼魅: "ghost",
  正义: "sheriff",
  蜂刺: "stinger",
  骇灵: "spectre",
  雄鹿: "bucky",
  判官: "judge",
  獠犬: "bulldog",
  戍卫: "guardian",
  幻象: "phantom",
  暴徒: "vandal",
  飞将: "marshal",
  间谍: "operator",
  战神: "ares",
  奥丁: "odin"
};

const html = await fetchText(sourceUrl);
const rawWeapons = parseWeapons(html);
const valorantSchemes = rawWeapons.map(toScheme);

const existing = readJson(outputFile, []);
const kept = existing.filter((item) => item.game !== "valorant" || item.source !== "ajaxgodlike-valorant");
const merged = [...kept, ...valorantSchemes];

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.mkdirSync(path.dirname(rawOutputFile), { recursive: true });
fs.writeFileSync(rawOutputFile, `${JSON.stringify(rawWeapons, null, 2)}\n`, "utf8");
fs.writeFileSync(outputFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

console.log(`已导入无畏契约武器 ${valorantSchemes.length} 条 -> ${outputFile}`);
console.log(`原始解析数据 -> ${rawOutputFile}`);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "wy-zfq-config-hub/0.1 (+local import script)"
    }
  });
  if (!response.ok) throw new Error(`请求失败 ${response.status} ${url}`);
  return response.text();
}

function parseWeapons(pageHtml) {
  const cardPattern = /<div class="weapon-card" data-category="([^"]+)">([\s\S]*?)(?=\n\s*<div class="weapon-card" data-category=|\n\s*<\/div>\s*<\/main>)/g;
  const weapons = [];
  for (const match of pageHtml.matchAll(cardPattern)) {
    const [, category, body] = match;
    const name = text(body.match(/<h3 class="weapon-name">([\s\S]*?)<\/h3>/)?.[1]);
    if (!name) continue;
    const image = body.match(/<img src="([^"]+)"/)?.[1] || "";
    const priceText = text(body.match(/<span class="weapon-price(?: free)?">([\s\S]*?)<\/span>/)?.[1]);
    const stats = [...body.matchAll(/<div class="stat-box">\s*<span class="stat-value">([\s\S]*?)<\/span>\s*<span class="stat-label">([\s\S]*?)<\/span>\s*<\/div>/g)]
      .map((stat) => ({ name: text(stat[2]), value: text(stat[1]), change: "-" }));

    weapons.push({
      name,
      slug: englishNames[name] || slugify(name),
      category,
      type: categoryNames[category] || category,
      price: priceText === "免费" ? 0 : number(priceText),
      image: new URL(image, sourceBase).href,
      properties_data: [
        { name: "价格", value: priceText, change: "-" },
        ...stats,
        { name: "默认通道", value: "1-4", change: "-" },
        { name: "导入类型", value: "开镜默认压枪", change: "-" },
        { name: "来源", value: "VAL武器页", change: "-" }
      ]
    });
  }
  return weapons;
}

function toScheme(item, index) {
  const stat = Object.fromEntries(item.properties_data.map((prop) => [prop.name, prop.value]));
  const fireRate = stat["射速"] || "";
  const magazine = stat["弹匣"] || "";
  const recoil = recoilPreset(item);
  return {
    id: `valorant-${item.slug}`,
    source: "ajaxgodlike-valorant",
    sourceUrl,
    sourceId: item.slug,
    game: "valorant",
    mode: "standard",
    weapon: item.name,
    objectName: item.name,
    type: item.type,
    ammo: "VAL信用点",
    map: "任意",
    image: item.image,
    value: item.price,
    price: item.price,
    users: 3000 - index * 97,
    likes: 120 - index * 3,
    author: "VAL武器库",
    status: "active",
    code: `VAL-${item.slug.toUpperCase()}-BASE`,
    sensitivity: "鼠标灵敏度按用户游戏内设置，导入时只绑定通道与默认开镜压枪模板",
    config: `game=valorant;channel={{channel}};weapon=${item.slug};mode=ads-default;pull=${recoil.pull};interval=${recoil.interval};fireRate=${fireRate};magazine=${magazine}`,
    params: {
      control: recoil.control,
      stability: recoil.stability,
      hip: "-",
      range: stat["伤害(身)"] || "-",
      ads: stat["伤害(头)"] || "-",
      recoil: String(recoil.pull),
      interval: `${recoil.interval}ms`,
      scope: item.type === "狙击枪" ? "开镜/连发通道" : "ADS"
    },
    feedback: { invalid: 0, inaccurate: 0, good: 0, weak: 0 },
    raw: item
  };
}

function recoilPreset(item) {
  const byType = {
    随身武器: { pull: 8, interval: 18, control: 42, stability: 55 },
    冲锋枪: { pull: 16, interval: 8, control: 56, stability: 58 },
    霰弹枪: { pull: 13, interval: 22, control: 48, stability: 46 },
    步枪: { pull: 18, interval: 11, control: 62, stability: 66 },
    狙击枪: { pull: 10, interval: 30, control: 70, stability: 74 },
    重型武器: { pull: 22, interval: 9, control: 58, stability: 60 }
  };
  return byType[item.type] || { pull: 15, interval: 12, control: 50, stability: 50 };
}

function text(value = "") {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return encodeURIComponent(value).replace(/%/g, "").toLowerCase();
}

function number(value) {
  const parsed = Number(String(value || 0).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
