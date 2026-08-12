import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("orzice-gun_gqm.html", "utf8");
const token = fs.readFileSync("orzice-token.js", "utf8");
const base = fs.readFileSync("orzice-base_2.js", "utf8");
const crypto = fs.readFileSync("orzice-crypto-js.min.js", "utf8");

const globals = {
  AA: html.match(/var AA = "([^"]+)"/)?.[1],
  AB: html.match(/var AB = "([^"]+)"/)?.[1],
  AC: html.match(/var AC = "([^"]+)"/)?.[1],
  TimeUnix: Number(html.match(/var TimeUnix =\s*(\d+)/)?.[1])
};

const urls = [];
const diagnostics = [];
const sandbox = {
  console,
  global: null,
  process,
  setInterval() {},
  clearInterval() {},
  setTimeout(fn) {
    if (typeof fn === "function") fn();
  },
  clearTimeout() {},
  navigator: { userAgent: "Mozilla/5.0" },
  location: { href: "https://orzice.com/v/gun_gqm", pathname: "/v/gun_gqm", host: "orzice.com" },
  document: {
    hidden: false,
    body: {},
    domain: "orzice.com",
    location: { href: "https://orzice.com/v/gun_gqm", pathname: "/v/gun_gqm", host: "orzice.com" },
    cookie: "",
    addEventListener() {},
    createElement() {
      return {};
    },
    querySelectorAll() {
      return [];
    },
    getElementsByTagName() {
      return [{ parentNode: { insertBefore() {} } }];
    }
  },
  window: null,
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {}
  },
  BaseApiHost: "",
  ISNOT: false,
  ...globals,
  _localBase: Date.now(),
  GetTimeUnix() {
    return globals.TimeUnix;
  },
  AppDataVue: {
    data: [],
    count: 0,
    loading: false,
    Tips() {}
  },
  base_vue: {
    $message(payload) {
      console.log("[message]", payload);
    },
    $loading() {
      return { close() {} };
    }
  },
  axios: {
    get(url) {
      urls.push(url);
      return {
        then(fn) {
          return {
            catch() {
              return {
                finally(fn2) {
                  if (fn2) fn2();
                }
              };
            }
          };
        }
      };
    },
    post(url) {
      urls.push(url);
      return {
        then() {
          return { catch() {} };
        }
      };
    },
    request(config) {
      urls.push(config?.url || config);
      return {
        then() {
          return { catch() {} };
        }
      };
    }
  },
  $() {
    return {
      attr() {},
      addClass() {},
      removeClass() {},
      hide() {},
      show() {},
      html() {},
      on() {},
      ready(fn) {
        if (fn) fn();
      }
    };
  }
};
sandbox.global = sandbox;
sandbox.window = sandbox;

vm.createContext(sandbox);
for (const [name, source] of [
  ["crypto", crypto],
  ["token", token],
  ["base", base]
]) {
  try {
    vm.runInContext(source, sandbox);
    diagnostics.push(`${name}: ok`);
  } catch (error) {
    diagnostics.push(`${name}: ${error.stack || error.message}`);
  }
}

if (typeof sandbox.FuncGetGqm !== "function") {
  diagnostics.push("FuncGetGqm: missing");
} else {
  diagnostics.push("FuncGetGqm: function");
  try {
    sandbox.FuncGetGqm("key1=全部&key2=全部&p=1&limit=9&top=0&top2=0&n=&solutionType=gun");
  } catch (error) {
    diagnostics.push(`FuncGetGqm call: ${error.stack || error.message}`);
  }
}

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/orzice-probed-urls.json", `${JSON.stringify({ urls, diagnostics }, null, 2)}\n`, "utf8");
