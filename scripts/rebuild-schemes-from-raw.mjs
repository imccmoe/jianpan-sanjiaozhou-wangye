import fs from "node:fs";
import path from "node:path";

const rawFile = process.argv[2] || "data/orzice-gqm-raw.json";
const outputFile = process.argv[3] || "public/data/schemes.json";
const rawItems = JSON.parse(fs.readFileSync(rawFile, "utf8"));
const schemes = rawItems.map(normalizeScheme);

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(schemes, null, 2)}\n`, "utf8");
console.log(`已重建 ${schemes.length} 条方案 -> ${outputFile}`);

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
  const category = item.m_type || inferType(objectName);
  return {
    id: `orzice-${item._solutionType || item.solutionType || "gun"}-${item.id || index + 1}`,
    sourceId: item.id || null,
    source: "orzice-authorized",
    game: "delta",
    mode: modeOf(item),
    weapon: name,
    objectName,
    type: category,
    ammo: item.ammo || item.bullet || "未知",
    map: item.map || item.mapName || "任意",
    image: item.pic || item.img || item.image || item.objectPic || "",
    value: number(item.zb || item.value || item.valueScore || item.totalPrice),
    price: number(item.price),
    users: number(item.applyNum || item.useCount || item.use_count || item.copyCount || item.hot || item.count),
    likes: number(item.likeNum || item.likeCount || item.likes || item.zan),
    author: item.authorNickname || item.author || item.nickname || "Orzice",
    status: "active",
    code,
    sensitivity: item.authorComment || item.sensitivity || item.desc || "",
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

function modeOf(item) {
  const type = item._solutionType || item.solutionType;
  if (type === "operator") return "warfare";
  if (String(item.solutionCode || "").includes("全面战场")) return "warfare";
  return "operations";
}

function inferType(name) {
  if (name.includes("冲锋")) return "冲锋枪";
  if (name.includes("机枪")) return "轻机枪";
  if (name.includes("霰弹")) return "霰弹枪";
  if (name.includes("狙击")) return "狙击步枪";
  if (name.includes("射手")) return "精确射手步枪";
  if (name.includes("手枪") || ["G17", "G18", "93R", "M1911"].some((key) => name.includes(key))) return "手枪";
  if (name.includes("弓")) return "特殊武器";
  return "步枪";
}

function number(value) {
  const parsed = Number(String(value || 0).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
