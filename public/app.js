if (typeof window === "undefined" || typeof document === "undefined") {
  console.log("public/app.js 是浏览器端脚本，请通过本地网页服务打开。");
  console.log("推荐命令：python -m http.server 8788 --directory public");
  console.log("然后访问：http://localhost:8788");
  if (typeof process !== "undefined") process.exit(0);
}

const games = [
  { id: "delta", name: "三角洲行动", subtitle: "改枪码 / 枪械方案 / 转发器配置" },
  { id: "pubg", name: "PUBG", subtitle: "开镜压枪方案" },
  { id: "valorant", name: "无畏契约", subtitle: "多通道枪械配置" },
  { id: "calabiyau", name: "卡拉比丘", subtitle: "待扩展配置库" }
];

const deltaModes = [
  { id: "warfare", name: "全面战场" },
  { id: "operations", name: "烽火地带" }
];

let schemes = [
  {
    id: "delta-m4a1-ops-001",
    game: "delta",
    mode: "operations",
    weapon: "M4A1",
    type: "突击步枪",
    ammo: "5.56x45mm",
    map: "航天基地",
    value: 625000,
    price: 138000,
    users: 2842,
    likes: 428,
    author: "DeltaLab",
    status: "active",
    code: "M4A1-OPS-7H2K-9QPM",
    sensitivity: "全局 38 / 开镜 31 / 垂直 0.92",
    config: "profile=m4a1;mode=ads;pull=31;interval=9;curve=stable",
    params: { control: 77, stability: 71, hip: 62, range: 58, ads: 226, recoil: "31", interval: "9ms", scope: "1x/2x" },
    feedback: { invalid: 2, inaccurate: 5, good: 126, weak: 9 }
  },
  {
    id: "delta-akm-ops-001",
    game: "delta",
    mode: "operations",
    weapon: "AKM",
    type: "突击步枪",
    ammo: "7.62x39mm",
    map: "零号大坝",
    value: 486000,
    price: 92000,
    users: 1920,
    likes: 236,
    author: "北山仓库",
    status: "active",
    code: "AKM-OPS-5L8A-2KQ7",
    sensitivity: "全局 35 / 开镜 28 / 垂直 1.05",
    config: "profile=akm;mode=ads;pull=38;interval=10;curve=heavy",
    params: { control: 68, stability: 64, hip: 54, range: 63, ads: 251, recoil: "38", interval: "10ms", scope: "1x" },
    feedback: { invalid: 6, inaccurate: 11, good: 88, weak: 16 }
  },
  {
    id: "delta-scarh-ops-001",
    game: "delta",
    mode: "operations",
    weapon: "SCAR-H",
    type: "战斗步枪",
    ammo: "7.62x51mm",
    map: "长弓溪谷",
    value: 768000,
    price: 166000,
    users: 3215,
    likes: 516,
    author: "方案编辑组",
    status: "active",
    code: "SCARH-OPS-4P6N-X120",
    sensitivity: "全局 40 / 开镜 32 / 垂直 0.98",
    config: "profile=scarh;mode=ads;pull=34;interval=11;curve=burst",
    params: { control: 82, stability: 74, hip: 49, range: 79, ads: 286, recoil: "34", interval: "11ms", scope: "2x/3x" },
    feedback: { invalid: 1, inaccurate: 3, good: 163, weak: 4 }
  },
  {
    id: "delta-m7-warfare-001",
    game: "delta",
    mode: "warfare",
    weapon: "M7",
    type: "突击步枪",
    ammo: "6.8x51mm",
    map: "攀升",
    value: 0,
    price: 0,
    users: 2440,
    likes: 309,
    author: "战场模板",
    status: "active",
    code: "M7-WAR-8J3P-QT20",
    sensitivity: "全局 39 / 开镜 30 / 垂直 1.00",
    config: "profile=m7;mode=ads;pull=33;interval=10;curve=mid",
    params: { control: 74, stability: 69, hip: 57, range: 70, ads: 242, recoil: "33", interval: "10ms", scope: "1x/2x" },
    feedback: { invalid: 2, inaccurate: 4, good: 91, weak: 8 }
  },
  {
    id: "delta-vector-ops-001",
    game: "delta",
    mode: "operations",
    weapon: "Vector",
    type: "冲锋枪",
    ammo: ".45 ACP",
    map: "巴克什",
    value: 352000,
    price: 74000,
    users: 1688,
    likes: 191,
    author: "近战优先",
    status: "active",
    code: "VECTOR-OPS-CQB-45A",
    sensitivity: "全局 42 / 开镜 34 / 垂直 0.88",
    config: "profile=vector;mode=ads;pull=24;interval=6;curve=fast",
    params: { control: 61, stability: 59, hip: 82, range: 37, ads: 188, recoil: "24", interval: "6ms", scope: "1x" },
    feedback: { invalid: 4, inaccurate: 8, good: 72, weak: 12 }
  },
  {
    id: "delta-sr25-ops-001",
    game: "delta",
    mode: "operations",
    weapon: "SR-25",
    type: "射手步枪",
    ammo: "7.62x51mm",
    map: "航天基地",
    value: 840000,
    price: 214000,
    users: 1106,
    likes: 153,
    author: "远点架枪",
    status: "active",
    code: "SR25-OPS-DMR-762",
    sensitivity: "全局 36 / 开镜 26 / 垂直 1.12",
    config: "profile=sr25;mode=tap;pull=19;interval=18;curve=single",
    params: { control: 88, stability: 81, hip: 32, range: 91, ads: 318, recoil: "19", interval: "18ms", scope: "4x/6x" },
    feedback: { invalid: 0, inaccurate: 2, good: 66, weak: 3 }
  },
  {
    id: "valorant-vandal-001",
    game: "valorant",
    mode: "standard",
    weapon: "Vandal",
    type: "步枪",
    ammo: "N/A",
    map: "任意",
    value: 0,
    price: 2900,
    users: 1398,
    likes: 77,
    author: "ChannelOps",
    status: "active",
    code: "VAL-VANDAL-CH1-BASE",
    sensitivity: "鼠标 0.31 / ADS 1.0",
    config: "channel=1;weapon=vandal;burst=6;pull=18;interval=12",
    params: { control: 60, stability: 65, hip: 50, range: 55, ads: 0, recoil: "18", interval: "12ms", scope: "ADS" },
    feedback: { invalid: 0, inaccurate: 4, good: 77, weak: 5 }
  },
  {
    id: "pubg-m416-001",
    game: "pubg",
    mode: "standard",
    weapon: "M416",
    type: "突击步枪",
    ammo: "5.56mm",
    map: "任意",
    value: 0,
    price: 0,
    users: 906,
    likes: 51,
    author: "PUBGBase",
    status: "active",
    code: "PUBG-M416-ADS-35",
    sensitivity: "常规 42 / 垂直 1.0 / 3倍 32",
    config: "profile=m416;scope=3x;pull=35;interval=8",
    params: { control: 70, stability: 70, hip: 52, range: 61, ads: 0, recoil: "35", interval: "8ms", scope: "1x/3x" },
    feedback: { invalid: 3, inaccurate: 6, good: 51, weak: 7 }
  }
];

const state = {
  user: JSON.parse(localStorage.getItem("zfq_user") || "null"),
  game: "delta",
  deltaMode: "operations",
  search: "",
  weapon: "all",
  weaponName: "all",
  pickerOpen: false,
  pickerCategory: "all",
  ammo: "all",
  value: "all",
  sort: "popular",
  page: 1,
  pageSize: 24,
  selected: null,
  channel: 1,
  view: "library",
  adminCategory: "submissions"
};

async function loadSchemes() {
  try {
    const response = await fetch("./data/schemes.json", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      schemes = data;
    }
  } catch (error) {
    console.warn("本地方案数据加载失败，使用内置示例数据。", error);
  }
}

function saveUser(user) {
  state.user = user;
  localStorage.setItem("zfq_user", JSON.stringify(user));
}

function visitCount() {
  const count = Number(localStorage.getItem("zfq_visits") || "0") + 1;
  localStorage.setItem("zfq_visits", String(count));
  return count;
}

function needsCaptcha() {
  return Number(localStorage.getItem("zfq_visits") || "0") >= 3;
}

function money(value) {
  if (!value) return "-";
  if (value >= 10000) return `${Math.round(value / 10000)}万`;
  return String(value);
}

function exactMoney(value) {
  if (!value) return "-";
  return Number(value).toLocaleString("zh-CN");
}

function activeSchemes() {
  return schemes.filter((item) => item.game === state.game && item.status === "active");
}

function filteredSchemes() {
  let items = activeSchemes();

  if (state.game === "delta") {
    items = items.filter((item) => item.mode === state.deltaMode);
  }

  if (state.search) {
    const keyword = state.search.toLowerCase();
    items = items.filter((item) => `${item.weapon} ${item.objectName || ""} ${item.type} ${item.ammo} ${item.map} ${item.code}`.toLowerCase().includes(keyword));
  }

  if (state.weapon !== "all") items = items.filter((item) => item.type === state.weapon);
  if (state.weaponName !== "all") items = items.filter((item) => (item.objectName || item.weapon) === state.weaponName);
  if (state.ammo !== "all") items = items.filter((item) => item.ammo === state.ammo);

  if (state.value !== "all") {
    items = items.filter((item) => {
      if (state.value === "p10") return item.price > 0 && item.price < 150000;
      if (state.value === "p20") return item.price >= 150000 && item.price < 250000;
      if (state.value === "p30") return item.price >= 250000 && item.price < 350000;
      if (state.value === "p40") return item.price >= 350000 && item.price < 450000;
      return item.price >= 500000;
    });
  }

  return items.sort((a, b) => {
    if (state.sort === "priceAsc") return a.price - b.price;
    if (state.sort === "priceDesc") return b.price - a.price;
    if (state.sort === "valueDesc") return b.value - a.value;
    if (state.sort === "likes") return b.likes - a.likes;
    return b.users - a.users;
  });
}

function paged(items) {
  const start = (state.page - 1) * state.pageSize;
  return items.slice(start, start + state.pageSize);
}

function mountLogin() {
  visitCount();
  const mustVerify = needsCaptcha();
  document.querySelector("#app").innerHTML = `
    <main class="login">
      <section class="login-panel">
        <h1>转发器配置方案库</h1>
        <p>游客可直接测试浏览与导入流程。频繁访问时会触发人机验证，后续可替换为 Cloudflare Turnstile。</p>
        <div class="field">
          <label for="username">账号</label>
          <input id="username" placeholder="测试阶段可留空" />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input id="password" type="password" placeholder="测试阶段可留空" />
        </div>
        ${
          mustVerify
            ? `<label class="captcha"><input id="captcha" type="checkbox" /> 我已完成人机验证</label>`
            : `<div class="notice">当前可直接游客登录。第 3 次访问后会显示验证步骤。</div>`
        }
        <div class="actions">
          <button class="btn" id="guestLogin">游客登录</button>
          <button class="btn secondary" id="accountLogin">账号登录</button>
        </div>
      </section>
    </main>
  `;

  document.querySelector("#guestLogin").addEventListener("click", () => {
    if (mustVerify && !document.querySelector("#captcha").checked) return toast("请先完成人机验证");
    saveUser({ id: `guest-${Date.now()}`, name: "游客", role: "guest" });
    renderApp();
  });

  document.querySelector("#accountLogin").addEventListener("click", () => {
    if (mustVerify && !document.querySelector("#captcha").checked) return toast("请先完成人机验证");
    const name = document.querySelector("#username").value.trim() || "测试用户";
    saveUser({ id: `user-${Date.now()}`, name, role: "user" });
    renderApp();
  });
}

function renderApp() {
  if (!state.user) return mountLogin();

  if (!state.selected || state.selected.game !== state.game) {
    state.selected = activeSchemes()[0] || null;
  }

  const game = games.find((item) => item.id === state.game);
  document.querySelector("#app").innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">Z</div>
          <div>
            <h1>配置方案库</h1>
            <p>Pages + Worker 范本</p>
          </div>
        </div>
        <nav class="nav">
          <button data-view="library" class="${state.view === "library" ? "active" : ""}">方案库</button>
          <button data-view="submit" class="${state.view === "submit" ? "active" : ""}">上传方案</button>
          <button data-view="admin" class="${state.view === "admin" ? "active" : ""}">后台审核</button>
        </nav>
        <div class="userbox">
          <strong>${state.user.name}</strong>
          <p>${state.user.role === "guest" ? "游客模式" : "账号模式"}</p>
          <button class="btn ghost" id="logout">退出登录</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <h2>${game.name}</h2>
            <span>${game.subtitle}</span>
          </div>
          <div class="actions">
            <button class="btn secondary" id="copyCurrent">复制当前改枪码</button>
            <button class="btn" id="importCurrent">导入当前配置</button>
          </div>
        </header>
        <section class="content">
          ${renderGameTabs()}
          ${state.view === "library" ? renderLibrary() : ""}
          ${state.view === "submit" ? renderSubmit() : ""}
          ${state.view === "admin" ? renderAdmin() : ""}
          ${state.pickerOpen ? renderWeaponPicker() : ""}
        </section>
      </main>
    </div>
  `;

  bindAppEvents();
}

function renderGameTabs() {
  return `
    <div class="tabs">
      ${games.map((game) => `<button class="tab ${state.game === game.id ? "active" : ""}" data-game="${game.id}">${game.name}</button>`).join("")}
    </div>
  `;
}

function renderLibrary() {
  const items = filteredSchemes();
  const pages = Math.max(1, Math.ceil(items.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  return `
    ${state.game === "delta" ? renderDeltaHero(items.length) : ""}
    <div class="toolbar">
      <input class="search" id="search" value="${state.search}" placeholder="搜索枪械、弹药、地图或改枪码" />
      ${state.game === "delta" ? renderDeltaFilters() : ""}
      ${state.game === "valorant" ? renderValorantFilters() : ""}
    </div>
    <div class="board">
      <section>
        <div class="result-head">
          <strong>共 ${items.length} 个方案</strong>
          <span>当前第 ${state.page} / ${pages} 页</span>
        </div>
        <div class="grid">
          ${paged(items).map(renderCard).join("") || `<div class="notice">暂无符合条件的方案</div>`}
        </div>
        <div class="pager">
          <button class="btn secondary" id="prevPage" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
          <button class="btn secondary" id="nextPage" ${state.page >= pages ? "disabled" : ""}>下一页</button>
        </div>
      </section>
      ${renderSidePanel()}
    </div>
  `;
}

function renderDeltaHero(total) {
  return `
    <section class="delta-hero">
      <div>
        <h3>三角洲改枪码方案</h3>
        <p>按模式、枪械、弹药、价值和价格筛选，复制改枪码后可导入对应转发器配置。</p>
      </div>
      <div class="mode-tabs">
        ${deltaModes.map((mode) => `<button class="${state.deltaMode === mode.id ? "active" : ""}" data-delta-mode="${mode.id}">${mode.name}</button>`).join("")}
      </div>
      <div class="hero-stat"><strong>${total}</strong><span>当前结果</span></div>
    </section>
  `;
}

function renderDeltaFilters() {
  const deltaItems = schemes.filter((item) => item.game === "delta" && item.mode === state.deltaMode);
  const ammoTypes = ["all", ...new Set(deltaItems.map((item) => item.ammo))];
  return `
    <div class="delta-filter-bar">
      <button class="filter-trigger" id="openWeaponPicker">${weaponFilterLabel()}</button>
      <div class="price-menu">
        <button class="filter-trigger">${priceFilterLabel()}</button>
        <div class="price-dropdown">
          ${[
            ["all", "全部价格"],
            ["p10", "10w左右"],
            ["p20", "20w左右"],
            ["p30", "30w左右"],
            ["p40", "40w左右"],
            ["p50", "50w以上"]
          ].map(([value, label]) => `<button class="${state.value === value ? "active" : ""}" data-price-filter="${value}">${label}</button>`).join("")}
        </div>
      </div>
      <label class="compact-filter">弹药类型
        <select id="ammoFilter">
          ${ammoTypes.map((type) => `<option value="${type}" ${state.ammo === type ? "selected" : ""}>${type === "all" ? "全部" : type}</option>`).join("")}
        </select>
      </label>
      <label class="compact-filter">排序
        <select id="sortFilter">
          <option value="popular" ${state.sort === "popular" ? "selected" : ""}>最多人用</option>
          <option value="likes" ${state.sort === "likes" ? "selected" : ""}>最多点赞</option>
          <option value="priceAsc" ${state.sort === "priceAsc" ? "selected" : ""}>价格升序</option>
          <option value="priceDesc" ${state.sort === "priceDesc" ? "selected" : ""}>价格倒序</option>
          <option value="valueDesc" ${state.sort === "valueDesc" ? "selected" : ""}>价值优先</option>
        </select>
      </label>
    </div>
  `;
}

function weaponFilterLabel() {
  if (state.weaponName !== "all") return state.weaponName;
  if (state.weapon !== "all") return state.weapon;
  return "选择枪械分类";
}

function priceFilterLabel() {
  return {
    all: "全部价格",
    p10: "10w左右",
    p20: "20w左右",
    p30: "30w左右",
    p40: "40w左右",
    p50: "50w以上"
  }[state.value] || "全部价格";
}

function renderWeaponPicker() {
  const sourceItems = schemes.filter((item) => {
    if (item.game !== state.game) return false;
    return state.game !== "delta" || item.mode === state.deltaMode;
  });
  const categories = ["all", ...new Set(sourceItems.map((item) => item.type).filter(Boolean))];
  const currentItems = state.pickerCategory === "all" ? sourceItems : sourceItems.filter((item) => item.type === state.pickerCategory);
  const weapons = ["all", ...new Set(currentItems.map((item) => item.objectName || item.weapon).filter(Boolean))];
  return `
    <div class="picker-overlay" id="weaponPickerOverlay">
      <section class="weapon-picker">
        <header>
          <strong>选择枪械分类</strong>
          <button id="closeWeaponPicker">×</button>
        </header>
        <div class="weapon-picker-body">
          <nav>
            ${categories.map((category) => `<button class="${state.pickerCategory === category ? "active" : ""}" data-picker-category="${category}">${category === "all" ? "全部" : category}</button>`).join("")}
          </nav>
          <div class="weapon-list">
            ${weapons.map((weapon) => `<button class="${state.weaponName === weapon || (weapon === "all" && state.weaponName === "all") ? "active" : ""}" data-picker-weapon="${weapon}">${weapon === "all" ? "全部" : weapon}</button>`).join("")}
          </div>
        </div>
        <footer>
          <button class="picker-cancel" id="cancelWeaponPicker">取消</button>
          <button class="picker-confirm" id="confirmWeaponPicker">确认</button>
        </footer>
      </section>
    </div>
  `;
}

function renderValorantFilters() {
  return `
    <div class="valorant-filter-bar">
      <button class="filter-trigger" id="openWeaponPicker">${weaponFilterLabel()}</button>
      <label class="compact-filter">排序
        <select id="sortFilter">
          <option value="popular" ${state.sort === "popular" ? "selected" : ""}>最多人用</option>
          <option value="likes" ${state.sort === "likes" ? "selected" : ""}>最多点赞</option>
          <option value="priceAsc" ${state.sort === "priceAsc" ? "selected" : ""}>价格升序</option>
          <option value="priceDesc" ${state.sort === "priceDesc" ? "selected" : ""}>价格倒序</option>
        </select>
      </label>
      ${renderValorantChannels()}
    </div>
  `;
}

function renderValorantChannels() {
  return `
    <div class="channel-row">
      ${[1, 2, 3, 4].map((channel) => `<button class="chip ${state.channel === channel ? "active" : ""}" data-channel="${channel}">通道 ${channel}</button>`).join("")}
      <span class="meta">一局多枪械时可把不同枪械绑定到不同通道。</span>
    </div>
  `;
}

function renderCard(item) {
  const total = item.feedback.invalid + item.feedback.good + item.feedback.inaccurate + item.feedback.weak;
  const audit = feedbackAudit(item);
  const subtitle = item.objectName || item.type || item.weapon;
  return `
    <article class="gqm-card ${state.selected?.id === item.id ? "selected" : ""}" data-select="${item.id}">
      <div class="gqm-title">
        <span class="star">★</span>
        <strong>${item.weapon}</strong>
      </div>
      <div class="gqm-body">
        <div class="gqm-subtitle">${subtitle}</div>
        <div class="gqm-image-wrap">
          ${item.image ? `<img class="gqm-image" src="${item.image}" alt="${item.weapon}" loading="lazy" />` : `<div class="gqm-image empty">暂无图片</div>`}
        </div>
        <div class="gqm-meta-line">
          <span>作者: ${item.author || "未知"}</span>
          <strong class="gqm-price">◉ ${exactMoney(item.price)}</strong>
        </div>
      </div>
      <div class="gqm-stats">
        ${renderStatCells(item)}
      </div>
      ${audit.flagged ? `<div class="gqm-warning">${audit.message}</div>` : ""}
      <div class="gqm-actions">
        <button data-copy="${item.id}">复制|改枪码</button>
        <button data-import="${item.id}">导入配置</button>
      </div>
    </article>
  `;
}

function renderStatCells(item) {
  const rawProps = Array.isArray(item.raw?.properties_data) ? item.raw.properties_data : [];
  const props = rawProps.length
    ? rawProps.slice(0, 8)
    : [
        { name: "价格", value: money(item.price), change: "-" },
        { name: "价值", value: money(item.value), change: "-" },
        { name: "后座", value: item.params.recoil || "-", change: "-" },
        { name: "操控", value: item.params.control || "-", change: "-" },
        { name: "稳定性", value: item.params.stability || "-", change: "-" },
        { name: "腰射", value: item.params.hip || "-", change: "-" },
        { name: "射程", value: item.params.range || "-", change: "-" },
        { name: "开镜", value: item.params.ads || "-", change: "-" }
      ];

  return props
    .map((prop) => {
      const change = prop.change === undefined || prop.change === "" ? "-" : prop.change;
      const changeClass = String(change).startsWith("+") ? "up" : String(change).startsWith("-") && change !== "-" ? "down" : "";
      return `
        <div class="gqm-stat">
          <span>${prop.name}</span>
          <strong>${prop.value ?? "-"}</strong>
          <em class="${changeClass}">${change}</em>
        </div>
      `;
    })
    .join("");
}

function renderSidePanel() {
  const item = state.selected;
  if (!item) return `<aside class="side-panel"><h3>配置详情</h3><p class="meta">请选择一个枪械方案。</p></aside>`;
  const config = channelConfig(item);
  return `
    <aside class="side-panel">
      <h3>${item.weapon} 方案详情</h3>
      <div class="detail-row"><span>改枪码</span><strong>${item.code}</strong></div>
      ${item.game === "valorant" ? `<div class="detail-row"><span>当前通道</span><strong>通道 ${state.channel}</strong></div>` : ""}
      <div class="detail-row"><span>转发器配置</span><code>${config}</code></div>
      <div class="detail-row"><span>灵敏度</span><strong>${item.sensitivity}</strong></div>
      <div class="detail-row"><span>压枪参数</span><strong>${item.params.recoil} / ${item.params.interval} / ${item.params.scope}</strong></div>
      <div class="feedback-row">
        <button class="chip" data-feedback="invalid" ${hasVotedFeedback(item, "invalid") ? "disabled" : ""}>改枪码无效 ${item.feedback.invalid}</button>
        <button class="chip" data-feedback="inaccurate" ${hasVotedFeedback(item, "inaccurate") ? "disabled" : ""}>数据不准 ${item.feedback.inaccurate}</button>
        <button class="chip" data-feedback="good" ${hasVotedFeedback(item, "good") ? "disabled" : ""}>这个真棒 ${item.feedback.good}</button>
        <button class="chip" data-feedback="weak" ${hasVotedFeedback(item, "weak") ? "disabled" : ""}>不太好用 ${item.feedback.weak}</button>
      </div>
      <div class="notice">${feedbackAudit(item).message}</div>
    </aside>
  `;
}

function renderSubmit() {
  return `
    <form class="toolbar" id="submitForm">
      <div class="field"><label>游戏</label><select><option>三角洲行动</option><option>PUBG</option><option>无畏契约</option><option>卡拉比丘</option></select></div>
      <div class="field"><label>枪械名称</label><input required placeholder="例如 M4A1" /></div>
      <div class="field"><label>改枪码</label><input required placeholder="粘贴改枪码" /></div>
      <div class="field"><label>转发器配置</label><input required placeholder="profile=m4a1;pull=31;interval=9" /></div>
      <button class="btn" type="submit">提交审核</button>
    </form>
  `;
}

function renderAdmin() {
  const categories = [
    { id: "submissions", name: "他人提供的枪械审核" },
    { id: "feedback", name: "反馈自动复核" },
    { id: "reserved", name: "待定" }
  ];
  const rows = adminRows();
  return `
    <div class="admin-panel">
      <div class="tabs">
        ${categories.map((item) => `<button class="tab ${state.adminCategory === item.id ? "active" : ""}" data-admin-category="${item.id}">${item.name}</button>`).join("")}
      </div>
      <table class="admin-table">
        <thead><tr><th>方案</th><th>分类</th><th>状态</th><th>审核原因</th><th>操作</th></tr></thead>
        <tbody>
          ${rows.map((item) => `
            <tr>
              <td>${item.weapon} / ${item.code}</td>
              <td>${item.type}</td>
              <td>${item.status === "active" ? "已上线" : "已下架"}</td>
              <td>${adminReason(item)}</td>
              <td><button class="btn secondary" data-admin="${item.id}">复核</button></td>
            </tr>
          `).join("") || `<tr><td colspan="5">当前分类暂无数据</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function adminRows() {
  if (state.adminCategory === "feedback") {
    return schemes.filter((item) => feedbackAudit(item).flagged).slice(0, 200);
  }
  if (state.adminCategory === "reserved") return [];
  return schemes.filter((item) => item.source !== "orzice-authorized" || item.raw?.status === "pending").slice(0, 200);
}

function adminReason(item) {
  if (state.adminCategory === "feedback") return feedbackAudit(item).message;
  if (state.adminCategory === "reserved") return "待定义";
  return item.source === "orzice-authorized" ? "授权同步数据" : "用户投稿待审核";
}

function bindAppEvents() {
  document.querySelector("#logout").addEventListener("click", () => {
    localStorage.removeItem("zfq_user");
    state.user = null;
    mountLogin();
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      renderApp();
    });
  });

  document.querySelectorAll("[data-admin-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.adminCategory = button.dataset.adminCategory;
      renderApp();
    });
  });

  document.querySelectorAll("[data-game]").forEach((button) => {
    button.addEventListener("click", () => {
      state.game = button.dataset.game;
      state.weapon = "all";
      state.weaponName = "all";
      state.pickerCategory = "all";
      state.ammo = "all";
      state.value = "all";
      state.search = "";
      state.page = 1;
      state.selected = null;
      renderApp();
    });
  });

  document.querySelectorAll("[data-delta-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.deltaMode = button.dataset.deltaMode;
      state.weapon = "all";
      state.weaponName = "all";
      state.pickerCategory = "all";
      state.ammo = "all";
      state.value = "all";
      state.page = 1;
      state.selected = null;
      renderApp();
    });
  });

  document.querySelector("#copyCurrent").addEventListener("click", () => copyScheme(state.selected));
  document.querySelector("#importCurrent").addEventListener("click", () => importScheme(state.selected));

  bindInput("#search", "input", (event) => {
    state.search = event.target.value;
    state.page = 1;
    renderApp();
  });
  bindInput("#openWeaponPicker", "click", () => {
    state.pickerOpen = true;
    state.pickerCategory = state.weapon;
    renderApp();
  });

  document.querySelectorAll("[data-picker-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.pickerCategory = button.dataset.pickerCategory;
      state.weapon = state.pickerCategory;
      state.weaponName = "all";
      renderApp();
    });
  });

  document.querySelectorAll("[data-picker-weapon]").forEach((button) => {
    button.addEventListener("click", () => {
      state.weaponName = button.dataset.pickerWeapon;
      renderApp();
    });
  });

  bindInput("#closeWeaponPicker", "click", closeWeaponPicker);
  bindInput("#cancelWeaponPicker", "click", closeWeaponPicker);
  bindInput("#confirmWeaponPicker", "click", () => {
    state.pickerOpen = false;
    state.page = 1;
    renderApp();
  });
  bindInput("#weaponPickerOverlay", "click", (event) => {
    if (event.target.id === "weaponPickerOverlay") closeWeaponPicker();
  });

  document.querySelectorAll("[data-price-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.value = button.dataset.priceFilter;
      state.page = 1;
      renderApp();
    });
  });
  bindInput("#ammoFilter", "change", (event) => {
    state.ammo = event.target.value;
    state.page = 1;
    renderApp();
  });
  bindInput("#sortFilter", "change", (event) => {
    state.sort = event.target.value;
    state.page = 1;
    renderApp();
  });

  document.querySelectorAll("[data-channel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.channel = Number(button.dataset.channel);
      toast(`已选择通道 ${state.channel}`);
      renderApp();
    });
  });

  document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    copyScheme(findScheme(button.dataset.copy));
  }));
  document.querySelectorAll("[data-import]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    importScheme(findScheme(button.dataset.import));
  }));
  document.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selected = findScheme(button.dataset.select);
      renderApp();
    });
  });

  document.querySelectorAll("[data-feedback]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.selected) return;
      const type = button.dataset.feedback;
      if (!recordFeedbackVote(state.selected, type)) return;
      state.selected.feedback[type] += 1;
      toast(feedbackAudit(state.selected).flagged ? "反馈已记录，该方案已进入自动复核提示" : "反馈已记录，同一用户同一项只能点击一次");
      renderApp();
    });
  });

  bindInput("#prevPage", "click", () => {
    state.page = Math.max(1, state.page - 1);
    renderApp();
  });
  bindInput("#nextPage", "click", () => {
    state.page += 1;
    renderApp();
  });

  bindInput("#submitForm", "submit", (event) => {
    event.preventDefault();
    toast("已提交到后台待审核");
  });

  document.querySelectorAll("[data-admin]").forEach((button) => {
    button.addEventListener("click", () => toast("后台复核动作已预留，后续接 D1 数据库"));
  });
}

function bindInput(selector, eventName, handler) {
  const node = document.querySelector(selector);
  if (node) node.addEventListener(eventName, handler);
}

function closeWeaponPicker() {
  state.pickerOpen = false;
  renderApp();
}

function findScheme(id) {
  return schemes.find((item) => item.id === id);
}

function currentActorId() {
  let deviceId = localStorage.getItem("zfq_device_id");
  if (!deviceId) {
    deviceId = `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("zfq_device_id", deviceId);
  }
  return `${state.user?.id || "anonymous"}:${deviceId}`;
}

function feedbackVoteKey(item, type) {
  return `zfq_feedback:${currentActorId()}:${item.id}:${type}`;
}

function hasVotedFeedback(item, type) {
  return localStorage.getItem(feedbackVoteKey(item, type)) === "1";
}

function recordFeedbackVote(item, type) {
  if (hasVotedFeedback(item, type)) {
    toast("这项反馈你已经点过了，本次不会重复计数");
    return false;
  }

  const burstKey = `zfq_feedback_burst:${item.id}:${type}`;
  const now = Date.now();
  const previous = Number(localStorage.getItem(burstKey) || "0");
  if (now - previous < 2500) {
    toast("同一方案同一反馈点击过快，本次仅作一次处理");
    localStorage.setItem(feedbackVoteKey(item, type), "1");
    return false;
  }

  localStorage.setItem(burstKey, String(now));
  localStorage.setItem(feedbackVoteKey(item, type), "1");
  return true;
}

function feedbackAudit(item) {
  const total = item.feedback.invalid + item.feedback.good + item.feedback.inaccurate + item.feedback.weak;
  const invalidRatio = total ? item.feedback.invalid / total : 0;
  const inaccurateRatio = total ? item.feedback.inaccurate / total : 0;
  if (item.feedback.invalid >= 10 && invalidRatio >= 0.35) {
    return { flagged: true, message: "改枪码无效反馈超过门槛，后台应自动屏蔽并进入复核。" };
  }
  if (item.feedback.inaccurate >= 15 && inaccurateRatio >= 0.4) {
    return { flagged: true, message: "数据不准反馈偏高，后台应提示风险并进入复核。" };
  }
  return { flagged: false, message: "反馈设有门槛：同一用户、同一设备、同一方案、同一反馈只能计一次。" };
}

async function copyScheme(item) {
  if (!item) return;
  await navigator.clipboard.writeText(item.code);
  toast("改枪码已复制");
}

function importScheme(item) {
  if (!item) return;
  const channelText = state.game === "valorant" ? `，通道 ${state.channel}` : "";
  toast(`${item.weapon} 配置已导入${channelText}`);
  console.info("导入转发器配置", channelConfig(item));
}

function channelConfig(item) {
  if (!item) return "";
  return String(item.config || "").replaceAll("{{channel}}", String(state.channel));
}

function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 2200);
}

async function boot() {
  await loadSchemes();
  renderApp();
}

boot();
