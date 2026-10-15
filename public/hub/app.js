// 配装站前端主控：哈希路由 + 事件委托渲染。
import { api, errorText } from "./api.js";
import {
  barWidth, copyText, count, dateTime, debounce, escapeHtml, money,
  paramEntries, shareUrl, showToast, statusLabel
} from "./format.js";

const TOKEN_STORAGE = "hub_admin_token";
const PAGE_SIZE = 24;

// 预览脚本会在没有 sessionStorage 的环境里导入本模块，因此访问要做兜底。
const tokenStore = {
  get() {
    try {
      return globalThis.sessionStorage?.getItem(TOKEN_STORAGE) || "";
    } catch {
      return "";
    }
  },
  set(value) {
    try {
      if (value) globalThis.sessionStorage?.setItem(TOKEN_STORAGE, value);
      else globalThis.sessionStorage?.removeItem(TOKEN_STORAGE);
    } catch {
      /* 存储不可用时只在内存里保留 */
    }
  }
};

const TYPE_ICON = {
  步枪: "🔫", 冲锋枪: "🔫", 轻机枪: "🔫", 霰弹枪: "🔫",
  狙击步枪: "🎯", 狙击枪: "🎯", 精确射手步枪: "🎯", 手枪: "🔧",
  特殊武器: "⚙️", 随身武器: "🔧", 重型武器: "⚙️"
};

const state = {
  route: "browse",
  routeId: null,
  meta: null,
  items: [],
  total: 0,
  offset: 0,
  filters: { game: "", mode: "", type: "", q: "", sort: "hot", author: "", minValue: 0 },
  loading: false,
  facets: null,
  detail: null,
  detailLoading: false,
  adminToken: tokenStore.get(),
  adminError: "",
  admin: { items: [], stats: {}, status: "pending", total: 0, offset: 0, loading: false },
  submitBusy: false
};

/* ---------------- 路由 ---------------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [head, ...rest] = raw.split("?");
  const query = new URLSearchParams(rest.join("?"));
  const segments = head.split("/").filter(Boolean);
  if (segments[0] === "s" && segments[1]) return { route: "detail", id: decodeURIComponent(segments[1]), query };
  if (segments[0] === "submit") return { route: "submit", id: null, query };
  if (segments[0] === "admin") return { route: "admin", id: null, query };
  return { route: "browse", id: null, query };
}

function readFilters(query) {
  return {
    game: query.get("game") || "",
    mode: query.get("mode") || "",
    type: query.get("type") || "",
    q: query.get("q") || "",
    sort: query.get("sort") || "hot",
    author: query.get("author") || "",
    minValue: Number(query.get("minValue")) || 0
  };
}

function writeHash({ replace = false } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    if (!value || (key === "sort" && value === "hot")) continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  const base = state.route === "detail" && state.routeId
    ? `#/s/${encodeURIComponent(state.routeId)}`
    : state.route === "submit" ? "#/submit"
      : state.route === "admin" ? "#/admin" : "#/";
  const next = `${base}${query ? `?${query}` : ""}`;
  if (location.hash === next) return;
  if (replace) history.replaceState(null, "", next);
  else location.hash = next;
}

/* ---------------- 数据 ---------------- */

async function loadMeta() {
  try {
    state.meta = await api.meta();
    state.facets = state.meta.facets;
  } catch (error) {
    showToast(`站点信息读取失败：${errorText(error)}`, "error");
  }
}

async function loadList({ reset = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  // 每次请求带一个序号，迟到的响应不能覆盖更新的筛选结果。
  const token = (state.listToken = (state.listToken || 0) + 1);
  if (reset) {
    state.offset = 0;
    state.items = [];
    render();
  }
  try {
    const payload = await api.list({ ...state.filters, limit: PAGE_SIZE, offset: state.offset });
    if (token !== state.listToken) return;
    state.items = state.offset === 0 ? payload.items : [...state.items, ...payload.items];
    state.total = payload.total;
    state.facets = payload.facets;
    state.offset = state.items.length;
  } catch (error) {
    if (token !== state.listToken) return;
    showToast(`方案列表读取失败：${errorText(error)}`, "error");
    if (state.offset === 0) state.items = [];
  } finally {
    if (token === state.listToken) {
      state.loading = false;
      render();
    }
  }
}

async function loadDetail(id) {
  state.detailLoading = true;
  state.detail = null;
  render();
  try {
    const payload = await api.detail(id);
    state.detail = payload;
  } catch (error) {
    showToast(`方案详情读取失败：${errorText(error)}`, "error");
  } finally {
    state.detailLoading = false;
    render();
  }
}

async function loadAdmin(reset = false) {
  if (!state.adminToken) return;
  if (reset) {
    state.admin.offset = 0;
    state.admin.items = [];
  }
  state.admin.loading = true;
  render();
  try {
    const payload = await api.adminList(
      { status: state.admin.status, limit: 40, offset: state.admin.offset, sort: "new" },
      state.adminToken
    );
    state.admin.items = state.admin.offset === 0 ? payload.items : [...state.admin.items, ...payload.items];
    state.admin.stats = payload.stats || {};
    state.admin.total = payload.total;
    state.admin.offset = state.admin.items.length;
  } catch (error) {
    if (error.status === 401) {
      // 令牌错误时回到登录页，并把原因写在表单里（toast 会随重渲染消失）。
      state.adminToken = "";
      state.adminError = "令牌无效，请重新输入。本地令牌见 .dev.vars 的 ADMIN_TOKEN。";
      tokenStore.set("");
    } else {
      showToast(`审核队列读取失败：${errorText(error)}`, "error");
    }
  } finally {
    state.admin.loading = false;
    render();
  }
}

/* ---------------- 渲染片段 ---------------- */

function header() {
  const links = [
    ["browse", "#/", "配装广场"],
    ["submit", "#/submit", "投稿方案"],
    ["admin", "#/admin", "审核台"]
  ];
  return `<header class="topbar">
    <div class="brand"><strong>ZFQ 配装方案站</strong><span>三角洲行动 / 无畏契约 · 社区方案库</span></div>
    <nav>${links.map(([id, href, label]) =>
      `<a href="${href}" class="${state.route === id ? "active" : ""}">${label}</a>`).join("")}
      <a href="/keyboard">SJZ 键盘网页</a></nav>
  </header>`;
}

function chip(label, active, attrs, extra = "") {
  return `<button class="chip ${active ? "active" : ""}" ${attrs}>${escapeHtml(label)}${extra}</button>`;
}

function sidebar() {
  const facets = state.facets || { games: [], modes: [], types: [] };
  const games = state.meta?.games || facets.games;
  const modes = state.meta?.modes || facets.modes;
  const counts = Object.fromEntries(facets.types.map((item) => [item.name, item.count]));
  return `<aside class="sidebar">
    <div class="filter-card">
      <h3>游戏</h3>
      <div class="chip-list">
        ${chip("全部", !state.filters.game, 'data-filter="game" data-value=""')}
        ${games.map((game) => chip(
          game.label, state.filters.game === (game.id || game.name),
          `data-filter="game" data-value="${escapeHtml(game.id || game.name)}"`,
          game.count ? `<em>${count(game.count)}</em>` : ""
        )).join("")}
      </div>
    </div>
    <div class="filter-card">
      <h3>模式</h3>
      <div class="chip-list">
        ${chip("全部", !state.filters.mode, 'data-filter="mode" data-value=""')}
        ${modes.map((mode) => chip(
          mode.label, state.filters.mode === (mode.id || mode.name),
          `data-filter="mode" data-value="${escapeHtml(mode.id || mode.name)}"`,
          mode.count ? `<em>${count(mode.count)}</em>` : ""
        )).join("")}
      </div>
    </div>
    <div class="filter-card">
      <h3>武器类型</h3>
      <div class="chip-list">
        ${chip("全部", !state.filters.type, 'data-filter="type" data-value=""')}
        ${facets.types.map((type) => chip(
          type.label, state.filters.type === type.name,
          `data-filter="type" data-value="${escapeHtml(type.name)}"`,
          `<em>${count(counts[type.name])}</em>`
        )).join("")}
      </div>
    </div>
    <div class="filter-card">
      <h3>热门作者</h3>
      <div class="chip-list">
        ${(state.meta?.topAuthors || []).map((author) => chip(
          author.name, state.filters.author === author.name,
          `data-filter="author" data-value="${escapeHtml(author.name)}"`,
          `<em>${count(author.count)}</em>`
        )).join("") || "<span class=\"hint\">暂无数据</span>"}
      </div>
    </div>
    <div class="filter-card">
      <h3>操作</h3>
      <button class="button ghost" data-action="reset-filters">重置全部筛选</button>
    </div>
  </aside>`;
}

function metricsRow(scheme) {
  return `<div class="metrics">
    <span>价值 <b>${money(scheme.value)}</b></span>
    <span>造价 <b>${money(scheme.price)}</b></span>
    <span>使用 <b>${count(scheme.users)}</b></span>
    <span>点赞 <b>${count(scheme.likes)}</b></span>
  </div>`;
}

function card(scheme) {
  return `<button class="card" data-action="open-detail" data-id="${escapeHtml(scheme.id)}">
    <div class="card-media">${scheme.image
      ? `<img src="${escapeHtml(scheme.image)}" alt="${escapeHtml(scheme.weapon)}" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="fallback">${TYPE_ICON[scheme.type] || "🔧"}</span>`}</div>
    <div class="card-body">
      <div class="card-title">${escapeHtml(scheme.weapon)}</div>
      <div class="tag-row">
        <span class="tag game">${escapeHtml(scheme.gameLabel || scheme.game)}</span>
        <span class="tag mode">${escapeHtml(scheme.modeLabel || scheme.mode)}</span>
        <span class="tag">${escapeHtml(scheme.type)}</span>
      </div>
      ${metricsRow(scheme)}
      <div class="card-foot"><span>${escapeHtml(scheme.author || "匿名")}</span><span>${escapeHtml(scheme.code.slice(0, 14))}…</span></div>
    </div>
  </button>`;
}

function skeletons() {
  return `<div class="grid">${Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join("")}</div>`;
}

function browseView() {
  const facets = state.facets || { types: [] };
  const activeTags = [
    state.filters.game && (state.meta?.games.find((g) => g.id === state.filters.game)?.label || state.filters.game),
    state.filters.mode && (state.meta?.modes.find((m) => m.id === state.filters.mode)?.label || state.filters.mode),
    state.filters.type,
    state.filters.author && `作者 ${state.filters.author}`,
    state.filters.q && `关键词「${state.filters.q}」`
  ].filter(Boolean);

  return `${header()}
  <div class="layout">
    ${sidebar()}
    <main>
      <div class="search-strip">
        <input type="search" id="search-input" placeholder="搜索武器、类型、作者或分享码" value="${escapeHtml(state.filters.q)}">
        <select id="sort-select" aria-label="排序">
          ${[["hot", "按热度"], ["new", "按最新"], ["value", "按价值"], ["price", "按造价"], ["name", "按名称"]]
            .map(([value, label]) => `<option value="${value}" ${state.filters.sort === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <select id="min-value" aria-label="最低价值">
          <option value="0">不限价值</option>
          ${[100000, 300000, 500000, 800000].map((value) =>
            `<option value="${value}" ${state.filters.minValue === value ? "selected" : ""}>价值 ≥ ${count(value)}</option>`).join("")}
        </select>
        <button class="button" data-action="share">复制当前筛选链接</button>
        <span class="stats">共 ${count(state.total || state.meta?.total || 0)} 条 · 已显示 ${state.items.length}</span>
      </div>
      <div class="heading">
        <h1>${escapeHtml(state.filters.type || "全部武器")} 配装方案</h1>
        <p>${activeTags.length ? `筛选：${activeTags.map(escapeHtml).join(" · ")}` : "点击卡片查看改装参数与分享码"}</p>
      </div>
      ${state.loading && !state.items.length ? skeletons()
        : state.items.length
          ? `<div class="grid">${state.items.map(card).join("")}</div>
             <div class="pager">
               <span>${state.items.length} / ${count(state.total)}</span>
               ${state.items.length < state.total
                 ? `<button class="button primary" data-action="load-more" ${state.loading ? "disabled" : ""}>${state.loading ? "加载中…" : "加载更多"}</button>`
                 : "<span>已经到底了</span>"}
             </div>`
          : `<div class="empty">没有匹配的方案。<br>换个关键词，或<a href="#/submit">投稿你自己的配装</a>。</div>`}
      <p class="hint" style="margin-top:18px">
        方案数据来自社区与公开分享码，参数仅供参考；游戏版本更新后数值可能失效，请以游戏内实际手感为准。
        类型分布：${facets.types.slice(0, 6).map((t) => `${escapeHtml(t.label)} ${count(t.count)}`).join(" · ")}
      </p>
    </main>
  </div>`;
}

function paramsSection(params) {
  const entries = paramEntries(params);
  if (!entries.length) return "";
  return `<div class="section"><h3>改装参数</h3>
    <div class="bars">${entries.map((entry) => {
      const numeric = entry.numeric && Number.isFinite(Number(entry.value));
      // 非数值行不能用 grid-column 跨越，否则会占掉进度条那一列并把后续行挤错位。
      return numeric
        ? `<div class="bar"><span>${escapeHtml(entry.label)}</span><i><span style="width:${barWidth(entry.value)}%"></span></i><b>${escapeHtml(entry.value)}</b></div>`
        : `<div class="bar"><span>${escapeHtml(entry.label)}</span><b class="wide">${escapeHtml(entry.value)}</b></div>`;
    }).join("")}</div>
  </div>`;
}

function detailDrawer() {
  if (!state.detail && !state.detailLoading) return "";
  const scheme = state.detail?.scheme;
  const related = state.detail?.related || [];
  return `<div class="drawer-backdrop" data-action="close-detail">
    <div class="drawer" data-stop>
      ${state.detailLoading || !scheme ? "<div class=\"skeleton\" style=\"height:300px\"></div>" : `
      <header>
        <div>
          <h2>${escapeHtml(scheme.weapon)}</h2>
          <p class="hint">${escapeHtml(scheme.objectName)} · ${escapeHtml(scheme.type)} · ${escapeHtml(scheme.author || "匿名")}</p>
        </div>
        <button class="close" data-action="close-detail">关闭</button>
      </header>
      <div class="tag-row">
        <span class="tag game">${escapeHtml(scheme.gameLabel)}</span>
        <span class="tag mode">${escapeHtml(scheme.modeLabel)}</span>
        ${scheme.ammo ? `<span class="tag">弹药 ${escapeHtml(scheme.ammo)}</span>` : ""}
        ${scheme.map ? `<span class="tag">地图 ${escapeHtml(scheme.map)}</span>` : ""}
      </div>
      ${metricsRow(scheme)}
      <div class="section"><h3>方案分享码</h3>
        <div class="code-box">
          <code>${escapeHtml(scheme.code)}</code>
          <button class="button" data-action="copy-code" data-value="${escapeHtml(scheme.code)}">复制</button>
        </div>
        <p class="hint">在游戏内“配装方案 → 导入”中粘贴即可加载。</p>
      </div>
      ${paramsSection(scheme.params)}
      ${scheme.sensitivity ? `<div class="section"><h3>作者备注</h3><p class="hint">${escapeHtml(scheme.sensitivity)}</p></div>` : ""}
      <div class="section"><h3>方案反馈（${count(Object.values(scheme.feedback || {}).reduce((sum, n) => sum + (Number(n) || 0), 0))} 条）</h3>
        <div class="feedback-row">
          ${[["good", "好用"], ["inaccurate", "参数不准"], ["weak", "效果偏弱"], ["invalid", "已失效"]]
            .map(([type, label]) => `<button class="button" data-action="feedback" data-type="${type}">${label} ${count(scheme.feedback?.[type] || 0)}</button>`).join("")}
        </div>
      </div>
      ${related.length ? `<div class="section"><h3>同类方案</h3>
        <div class="chip-list">${related.map((item) =>
          `<button class="chip" data-action="open-detail" data-id="${escapeHtml(item.id)}">${escapeHtml(item.weapon)}</button>`).join("")}</div>
      </div>` : ""}
      <p class="hint">收录时间 ${escapeHtml(dateTime(scheme.createdAt))}${scheme.sourceUrl ? ` · <a href="${escapeHtml(scheme.sourceUrl)}" target="_blank" rel="noopener noreferrer">原始来源</a>` : ""}</p>
      `}
    </div>
  </div>`;
}

function submitView() {
  return `${header()}
  <div class="layout" style="grid-template-columns:1fr">
    <main>
      <div class="heading"><h1>投稿配装方案</h1><p>提交后进入待审队列，审核通过即可在配装广场被搜索到。</p></div>
      <form class="form" id="submit-form">
        <div class="field-row">
          <div class="field"><label for="f-author">作者昵称</label><input id="f-author" maxlength="40" placeholder="留空显示为匿名玩家"></div>
          <div class="field"><label for="f-game">游戏</label>
            <select id="f-game">
              <option value="delta">三角洲行动</option>
              <option value="valorant">无畏契约</option>
            </select>
          </div>
          <div class="field"><label for="f-mode">模式</label>
            <select id="f-mode">
              <option value="operations">烽火地带</option>
              <option value="warfare">全面战场</option>
              <option value="standard">标准模式</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label for="f-weapon">方案名称 *</label><input id="f-weapon" maxlength="60" required placeholder="例如：腰射真神 QCQ171"></div>
          <div class="field"><label for="f-object">武器名</label><input id="f-object" maxlength="60" placeholder="例如：QCQ171冲锋枪"></div>
          <div class="field"><label for="f-type">武器类型</label><input id="f-type" maxlength="40" placeholder="步枪 / 冲锋枪 / 狙击步枪…" value="步枪"></div>
        </div>
        <div class="field"><label for="f-code">方案分享码 *（游戏内复制，需包含 “-”）</label>
          <input id="f-code" maxlength="160" required placeholder="QCQ171冲锋枪-烽火地带-6KSG9S403H2RB8ICKNGCF">
        </div>
        <div class="field-row">
          <div class="field"><label for="f-ammo">弹药</label><input id="f-ammo" maxlength="20"></div>
          <div class="field"><label for="f-map">适用地图</label><input id="f-map" maxlength="30" placeholder="任意"></div>
          <div class="field"><label for="f-value">价值分</label><input id="f-value" type="number" min="0" step="1" value="0"></div>
          <div class="field"><label for="f-price">造价（哈夫币）</label><input id="f-price" type="number" min="0" step="1" value="0"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="f-control">操控</label><input id="f-control" type="number" min="0" max="999"></div>
          <div class="field"><label for="f-stability">稳定</label><input id="f-stability" type="number" min="0" max="999"></div>
          <div class="field"><label for="f-hip">腰射</label><input id="f-hip" type="number" min="0" max="999"></div>
          <div class="field"><label for="f-range">射程</label><input id="f-range" type="number" min="0" max="999"></div>
          <div class="field"><label for="f-ads">开镜速度</label><input id="f-ads" type="number" min="0" max="999"></div>
          <div class="field"><label for="f-recoil">后座（可文本）</label><input id="f-recoil" maxlength="80"></div>
        </div>
        <div class="field"><label for="f-sensitivity">备注 / 手感说明</label><textarea id="f-sensitivity" rows="3" maxlength="200"></textarea></div>
        <div class="field"><label for="f-image">配件图链接（可选，http(s) 或站内路径）</label><input id="f-image" maxlength="600"></div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="button primary" type="submit" ${state.submitBusy ? "disabled" : ""}>${state.submitBusy ? "提交中…" : "提交审核"}</button>
          <span class="hint">同一客户端每小时最多 8 条，分享码重复会被拒绝。</span>
        </div>
        <p class="error-text" id="submit-error"></p>
      </form>
      <p class="hint">投稿仅收录你自己整理或获授权分享的方案，请勿批量搬运他人内容。</p>
    </main>
  </div>`;
}

function adminView() {
  if (!state.adminToken) {
    return `${header()}
    <div class="layout" style="grid-template-columns:1fr">
      <main>
        <div class="heading"><h1>审核台</h1><p>审核社区投稿：通过、拒绝、下架或恢复方案。需要服务端配置的 ADMIN_TOKEN。</p></div>
        <div class="filter-card" style="max-width:560px;margin-bottom:16px">
          <h3>令牌从哪来</h3>
          <p class="hint" style="margin:0 0 8px">
            本地开发：令牌由 <code>npm run dev</code> 首次运行时写入仓库根目录的 <code>.dev.vars</code>，
            启动日志里也会打印。查看当前值：
          </p>
          <div class="code-box"><code>Select-String -Path .dev.vars -Pattern ADMIN_TOKEN</code>
            <span class="hint">PowerShell</span></div>
          <p class="hint" style="margin:10px 0 0">
            生产环境：用 <code>npx wrangler pages secret put ADMIN_TOKEN</code> 设置。<br>
            令牌只保存在本标签页的 sessionStorage，刷新页面不需要重新输入，关闭标签页即失效。
          </p>
        </div>
        <form class="form" id="admin-login" style="max-width:420px">
          <div class="field"><label for="admin-token">管理令牌</label><input id="admin-token" type="password" autocomplete="current-password" required placeholder="粘贴 .dev.vars 里的令牌"></div>
          <button class="button primary" type="submit">进入审核台</button>
          <p class="error-text" id="admin-error">${escapeHtml(state.adminError || "")}</p>
        </form>
      </main>
    </div>`;
  }
  const stats = state.admin.stats || {};
  return `${header()}
  <div class="layout" style="grid-template-columns:1fr">
    <main>
      <div class="heading"><h1>审核台</h1>
        <p>已发布 ${count(stats.active || 0)} · 待审 ${count(stats.pending || 0)} · 已拒绝 ${count(stats.rejected || 0)} · 已下架 ${count(stats.hidden || 0)}</p>
        <button class="button ghost" data-action="admin-logout" style="margin-left:auto">退出登录</button>
      </div>
      <div class="search-strip">
        <select id="admin-status">
          ${["pending", "active", "rejected", "hidden"].map((status) =>
            `<option value="${status}" ${state.admin.status === status ? "selected" : ""}>${statusLabel(status)} (${count(stats[status] || 0)})</option>`).join("")}
        </select>
        <button class="button" data-action="admin-reload">刷新队列</button>
        <span class="stats">共 ${count(state.admin.total)} 条</span>
      </div>
      ${state.admin.items.length ? `<div class="admin-scroll"><table class="admin-table">
        <colgroup>
          <col class="c-scheme"><col class="c-code"><col class="c-author">
          <col class="c-status"><col class="c-time"><col class="c-actions">
        </colgroup>
        <thead><tr><th>方案</th><th>分享码</th><th>作者</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
        <tbody>${state.admin.items.map((item) => `<tr>
          <td class="wrap-anywhere"><b>${escapeHtml(item.weapon)}</b><br><span class="hint">${escapeHtml(item.objectName)} · ${escapeHtml(item.type)}</span></td>
          <td><code>${escapeHtml(item.code)}</code></td>
          <td class="wrap-anywhere">${escapeHtml(item.author || "匿名")}</td>
          <td><span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
          <td class="hint">${escapeHtml(dateTime(item.createdAt))}</td>
          <td><div class="admin-actions">
            ${item.status !== "active" ? `<button class="button" data-action="review" data-id="${escapeHtml(item.id)}" data-review="approve">通过</button>` : ""}
            ${item.status === "pending" || item.status === "active" ? `<button class="button danger" data-action="review" data-id="${escapeHtml(item.id)}" data-review="reject">拒绝</button>` : ""}
            ${item.status === "active" ? `<button class="button" data-action="review" data-id="${escapeHtml(item.id)}" data-review="hide">下架</button>` : ""}
            ${item.status === "hidden" || item.status === "rejected" ? `<button class="button" data-action="review" data-id="${escapeHtml(item.id)}" data-review="restore">恢复</button>` : ""}
            <button class="button ghost" data-action="open-detail" data-id="${escapeHtml(item.id)}">预览</button>
          </div></td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="pager">        <span>${state.admin.items.length} / ${count(state.admin.total)}</span>
        ${state.admin.items.length < state.admin.total
          ? `<button class="button primary" data-action="admin-more" ${state.admin.loading ? "disabled" : ""}>加载更多</button>` : ""}
      </div>` : `<div class="empty">该状态下没有方案。</div>`}
    </main>
  </div>
  ${detailDrawer()}`;
}

/* ---------------- 主渲染 ---------------- */

function render() {
  const app = document.querySelector("#app");
  if (!app) return;
  let body;
  if (state.route === "submit") body = submitView();
  else if (state.route === "admin") body = adminView();
  else body = `${browseView()}${detailDrawer()}`;
  app.innerHTML = body;
}

/* ---------------- 预览钩子 ---------------- */
// 只供 scripts/build-hub-preview.mjs 在静态预览中使用：把渲染函数暴露出去，
// 用真实接口数据生成截图页，避免「预览和线上不一致」。
export function applyForPreview(patch = {}) {
  if (patch.meta) {
    state.meta = patch.meta;
    state.facets = patch.meta.facets;
  }
  if (patch.list) {
    state.items = patch.list.items || [];
    state.total = patch.list.total || state.items.length;
    state.offset = state.items.length;
    if (patch.list.facets) state.facets = patch.list.facets;
  }
  // undefined 表示「不改动」，null 表示「显式关闭详情抽屉」。
  if (patch.detail !== undefined) state.detail = patch.detail;
  if (patch.admin) {
    state.adminToken = patch.admin.token || "";
    state.admin.items = patch.admin.items || [];
    state.admin.stats = patch.admin.stats || {};
    state.admin.total = patch.admin.total || state.admin.items.length;
    state.admin.offset = state.admin.items.length;
    if (patch.admin.status) state.admin.status = patch.admin.status;
  }
  if (patch.route) state.route = patch.route;
  if (patch.filters) state.filters = { ...state.filters, ...patch.filters };
  if (patch.routeId) state.routeId = patch.routeId;
}

export function renderPreview(route) {
  if (route === "submit") return submitView();
  if (route === "admin") return adminView();
  if (route === "detail") return detailDrawer();
  return `${browseView()}${detailDrawer()}`;
}

function syncRoute() {
  const { route, id, query } = parseHash();
  const routeChanged = route !== state.route || id !== state.routeId;
  state.route = route;
  state.routeId = id;
  if (route === "browse" || route === "detail") {
    state.filters = readFilters(query);
  }
  if (route === "detail" && id) {
    loadDetail(id);
    // 直接打开详情链接时仍需一份列表数据，便于关闭抽屉后回到广场。
    if (!state.items.length && !state.loading) loadList({ reset: true });
    return;
  }
  if (route === "browse") {
    // 只有筛选条件变化时 hashchange 也会触发，这里只在路由真正变化或数据为空时加载，
    // 避免和交互处理器里的显式 loadList 重复请求。
    if (routeChanged || !state.items.length) loadList({ reset: true });
    else render();
    return;
  }
  if (route === "admin" && state.adminToken && !state.admin.items.length) loadAdmin(true);
  render();
}

/* ---------------- 交互 ---------------- */

function collectSubmission() {
  const value = (id) => document.querySelector(id)?.value?.trim() || "";
  const numberValue = (id) => Number(value(id)) || 0;
  return {
    author: value("#f-author"),
    game: value("#f-game"),
    mode: value("#f-mode"),
    weapon: value("#f-weapon"),
    objectName: value("#f-object"),
    type: value("#f-type"),
    ammo: value("#f-ammo"),
    map: value("#f-map"),
    code: value("#f-code"),
    image: value("#f-image"),
    sensitivity: value("#f-sensitivity"),
    value: numberValue("#f-value"),
    price: numberValue("#f-price"),
    params: {
      control: numberValue("#f-control"),
      stability: numberValue("#f-stability"),
      hip: numberValue("#f-hip"),
      range: numberValue("#f-range"),
      ads: numberValue("#f-ads"),
      recoil: value("#f-recoil")
    }
  };
}

async function submitForm() {
  const errorNode = document.querySelector("#submit-error");
  if (errorNode) errorNode.textContent = "";
  const payload = collectSubmission();
  if (!payload.weapon || !payload.code) {
    if (errorNode) errorNode.textContent = "方案名称与分享码必填。";
    return;
  }
  state.submitBusy = true;
  render();
  try {
    const result = await api.submit(payload);
    showToast(result.message || "投稿已提交", "success");
    location.hash = "#/";
    state.submitBusy = false;
    loadList({ reset: true });
  } catch (error) {
    state.submitBusy = false;
    render();
    const node = document.querySelector("#submit-error");
    if (node) node.textContent = errorText(error);
    else showToast(errorText(error), "error");
  }
}

async function sendFeedback(type) {
  const id = state.routeId || state.detail?.scheme?.id;
  if (!id) return;
  try {
    const result = await api.feedback({ schemeId: id, type });
    showToast(result.message || "反馈已记录", "success");
    await loadDetail(id);
  } catch (error) {
    showToast(errorText(error), "error");
  }
}

async function review(action, id) {
  try {
    const result = await api.review({ schemeId: id, action }, state.adminToken);
    showToast(`${statusLabel(result.from)} → ${statusLabel(result.status)}`, "success");
    loadAdmin(true);
  } catch (error) {
    showToast(errorText(error), "error");
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (target) {
      const action = target.dataset.action;
      if (action === "open-detail") {
        state.detail = null;
        location.hash = `#/s/${encodeURIComponent(target.dataset.id)}`;
        return;
      }
      if (action === "close-detail") {
        if (event.target.closest("[data-stop]") && !event.target.classList.contains("close")) return;
        state.detail = null;
        state.routeId = null;
        history.replaceState(null, "", "#/");
        state.route = "browse";
        render();
        return;
      }
      if (action === "load-more") {
        loadList();
        return;
      }
      if (action === "copy-code") {
        copyText(target.dataset.value || "").then((ok) => showToast(ok ? "分享码已复制" : "复制失败，请手动选择", ok ? "success" : "error"));
        return;
      }
      if (action === "feedback") {
        sendFeedback(target.dataset.type);
        return;
      }
      if (action === "share") {
        const url = shareUrl(state.filters);
        copyText(url).then((ok) => showToast(ok ? "筛选链接已复制" : url, ok ? "success" : "info"));
        return;
      }
      if (action === "reset-filters") {
        state.filters = { game: "", mode: "", type: "", q: "", sort: "hot", author: "", minValue: 0 };
        writeHash();
        loadList({ reset: true });
        return;
      }
      if (action === "review") {
        review(target.dataset.review, target.dataset.id);
        return;
      }
      if (action === "admin-reload") {
        loadAdmin(true);
        return;
      }
      if (action === "admin-more") {
        loadAdmin();
        return;
      }
      if (action === "admin-logout") {
        state.adminToken = "";
        tokenStore.set("");
        state.admin = { items: [], stats: {}, status: "pending", total: 0, offset: 0, loading: false };
        render();
        return;
      }
    }

    const filter = event.target.closest("[data-filter]");
    if (filter) {
      const key = filter.dataset.filter;
      const value = filter.dataset.value || "";
      state.filters[key] = state.filters[key] === value ? "" : value;
      writeHash();
      loadList({ reset: true });
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "sort-select") {
      state.filters.sort = event.target.value;
      writeHash();
      loadList({ reset: true });
    }
    if (event.target.id === "min-value") {
      state.filters.minValue = Number(event.target.value);
      writeHash();
      loadList({ reset: true });
    }
    if (event.target.id === "admin-status") {
      state.admin.status = event.target.value;
      loadAdmin(true);
    }
  });

  const search = document.querySelector("#search-input");
  if (search) {
    search.addEventListener("input", debounce((event) => {
      state.filters.q = event.target.value.trim();
      writeHash({ replace: true });
      loadList({ reset: true });
    }, 320));
  }

  const submitFormNode = document.querySelector("#submit-form");
  if (submitFormNode) {
    submitFormNode.addEventListener("submit", (event) => {
      event.preventDefault();
      submitForm();
    });
  }

  const loginForm = document.querySelector("#admin-login");
  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const token = document.querySelector("#admin-token")?.value?.trim();
      if (!token) return;
      state.adminToken = token;
      state.adminError = "";
      tokenStore.set(token);
      loadAdmin(true);
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (state.detail || state.detailLoading)) {
      state.detail = null;
      state.detailLoading = false;
      state.routeId = null;
      history.replaceState(null, "", "#/");
      state.route = "browse";
      render();
    }
  });
}

/* ---------------- 启动 ---------------- */

// 预览模式：由 scripts/build-hub-preview.mjs 导入时不做任何初始化，
// 页面会显式调用 applyForPreview() / renderPreview()。
if (!globalThis.__HUB_PREVIEW__) {
  window.addEventListener("hashchange", syncRoute);
  bindEvents();
  syncRoute();
  render();
  loadMeta().then(() => {
    if (!state.items.length) loadList({ reset: true });
    else render();
  });
}
