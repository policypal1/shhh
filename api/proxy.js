const dns = require("dns").promises;
const net = require("net");

const MAX_RESPONSE_BYTES = 4_500_000;

/*
  ADD ONLY YOUR OWN / CLIENT / TEST DOMAINS HERE.

  Example:
  const DEFAULT_ALLOWED_HOSTS = [
    "yourwebsite.com",
    "www.yourwebsite.com",
    "clientsite.com",
    "www.clientsite.com"
  ];
*/
const DEFAULT_ALLOWED_HOSTS = [
  "instagram.com",
  "chatgpt.com"
];

function getAllowedHosts() {
  const envHosts = String(process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return new Set([
    ...DEFAULT_ALLOWED_HOSTS.map((host) => host.toLowerCase()),
    ...envHosts
  ]);
}

function isAllowedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  const allowedHosts = getAllowedHosts();

  for (const allowed of allowedHosts) {
    if (host === allowed || host.endsWith("." + allowed)) {
      return true;
    }
  }

  return false;
}

function isPrivateIp(ip) {
  if (!ip) return true;

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;

    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();

    if (lower === "::1") return true;
    if (lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80")) return true;

    return false;
  }

  return true;
}

async function validateTargetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Missing URL.");
  }

  let target;

  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  if (target.username || target.password) {
    throw new Error("Username/password URLs are not allowed.");
  }

  if (target.port && target.port !== "80" && target.port !== "443") {
    throw new Error("Only normal HTTP and HTTPS ports are allowed.");
  }

  if (!isAllowedHost(target.hostname)) {
    throw new Error(
      `Host is not allowlisted: ${target.hostname}. Add it to DEFAULT_ALLOWED_HOSTS or the ALLOWED_HOSTS env variable.`
    );
  }

  const records = await dns.lookup(target.hostname, { all: true });

  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error("Blocked private/internal network address.");
    }
  }

  return target;
}

function escapeHtmlAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function shouldSkipUrl(value) {
  const clean = String(value || "").trim().toLowerCase();

  return (
    !clean ||
    clean.startsWith("#") ||
    clean.startsWith("javascript:") ||
    clean.startsWith("mailto:") ||
    clean.startsWith("tel:") ||
    clean.startsWith("data:") ||
    clean.startsWith("blob:")
  );
}

function makeProxyUrl(rawUrl, baseUrl) {
  try {
    if (shouldSkipUrl(rawUrl)) {
      return rawUrl;
    }

    const absolute = new URL(rawUrl, baseUrl);

    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
      return rawUrl;
    }

    if (!isAllowedHost(absolute.hostname)) {
      return rawUrl;
    }

    return `/api/proxy?url=${encodeURIComponent(absolute.href)}`;
  } catch {
    return rawUrl;
  }
}

function rewriteSrcset(srcset, baseUrl) {
  return String(srcset || "")
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return "";

      const pieces = trimmed.split(/\s+/);
      const url = pieces.shift();
      const rewritten = makeProxyUrl(url, baseUrl);

      return [rewritten, ...pieces].join(" ");
    })
    .join(", ");
}

function rewriteCssUrls(cssText, baseUrl) {
  return String(cssText || "").replace(
    /url\((['"]?)(.*?)\1\)/gi,
    (match, quote, rawUrl) => {
      const cleanUrl = String(rawUrl || "").trim();

      if (shouldSkipUrl(cleanUrl)) {
        return match;
      }

      const rewritten = makeProxyUrl(cleanUrl, baseUrl);
      return `url("${rewritten}")`;
    }
  );
}

function injectNavigationHelper(html) {
  const helper = `
<script>
(function () {
  const proxyPath = "/api/proxy?url=";

  function proxify(rawUrl) {
    try {
      const url = new URL(rawUrl, document.baseURI);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return rawUrl;
      }

      return proxyPath + encodeURIComponent(url.href);
    } catch {
      return rawUrl;
    }
  }

  document.addEventListener("click", function (event) {
    const link = event.target.closest("a[href]");
    if (!link) return;

    const href = link.getAttribute("href");

    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      return;
    }

    event.preventDefault();
    window.location.href = proxify(href);
  }, true);

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!form || form.tagName !== "FORM") return;

    const method = String(form.method || "GET").toUpperCase();

    if (method !== "GET") {
      event.preventDefault();
      alert("POST forms are disabled in this preview tool.");
      return;
    }

    event.preventDefault();

    const action = form.getAttribute("action") || window.location.href;
    const url = new URL(action, document.baseURI);
    const formData = new FormData(form);

    for (const [key, value] of formData.entries()) {
      url.searchParams.set(key, value);
    }

    window.location.href = proxify(url.href);
  }, true);
})();
</script>
`;

  if (html.includes("</body>")) {
    return html.replace("</body>", helper + "</body>");
  }

  return html + helper;
}

function rewriteHtml(html, baseUrl) {
  let rewritten = String(html || "");

  if (/<head([^>]*)>/i.test(rewritten)) {
    rewritten = rewritten.replace(/<head([^>]*)>/i, (match, attrs) => {
      return `<head${attrs}><base href="${escapeHtmlAttr(baseUrl)}">`;
    });
  }

  rewritten = rewritten.replace(
    /\s(href|src|action|poster)=("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, attr, fullValue, doubleQuoted, singleQuoted, unquoted) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";

      if (shouldSkipUrl(value)) {
        return match;
      }

      const rewrittenUrl = makeProxyUrl(value, baseUrl);
      return ` ${attr}="${escapeHtmlAttr(rewrittenUrl)}"`;
    }
  );

  rewritten = rewritten.replace(
    /\s(srcset)=("([^"]*)"|'([^']*)')/gi,
    (match, attr, fullValue, doubleQuoted, singleQuoted) => {
      const value = doubleQuoted ?? singleQuoted ?? "";
      const rewrittenValue = rewriteSrcset(value, baseUrl);
      return ` ${attr}="${escapeHtmlAttr(rewrittenValue)}"`;
    }
  );

  rewritten = rewriteCssUrls(rewritten, baseUrl);
  rewritten = injectNavigationHelper(rewritten);

  return rewritten;
}

function copySafeHeaders(upstreamResponse, res) {
  const contentType = upstreamResponse.headers.get("content-type");

  if (contentType) {
    res.setHeader("content-type", contentType);
  }

  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex, nofollow");
  res.setHeader("x-content-type-options", "nosniff");
}

async function responseToLimitedBuffer(response) {
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_RESPONSE_BYTES) {
    throw new Error("Response too large for preview.");
  }

  return buffer;
}

function sendPlain(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(message);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("allow", "GET, HEAD");
      res.end("Only GET and HEAD are allowed.");
      return;
    }

    const target = await validateTargetUrl(req.query.url);

    const upstreamResponse = await fetch(target.href, {
      method: req.method,
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "accept": req.headers.accept || "*/*",
        "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9"
      }
    });

    if (
      upstreamResponse.status >= 300 &&
      upstreamResponse.status < 400 &&
      upstreamResponse.headers.get("location")
    ) {
      const location = upstreamResponse.headers.get("location");
      const redirectTarget = new URL(location, target.href);
      const safeRedirectTarget = await validateTargetUrl(redirectTarget.href);

      res.statusCode = upstreamResponse.status;
      res.setHeader(
        "location",
        `/api/proxy?url=${encodeURIComponent(safeRedirectTarget.href)}`
      );
      res.end();
      return;
    }

    copySafeHeaders(upstreamResponse, res);

    if (req.method === "HEAD") {
      res.statusCode = upstreamResponse.status;
      res.end();
      return;
    }

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const buffer = await responseToLimitedBuffer(upstreamResponse);

    res.statusCode = upstreamResponse.status;

    if (contentType.includes("text/html")) {
      const html = buffer.toString("utf8");
      const rewrittenHtml = rewriteHtml(html, target.href);
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(rewrittenHtml);
      return;
    }

    if (contentType.includes("text/css")) {
      const css = buffer.toString("utf8");
      const rewrittenCss = rewriteCssUrls(css, target.href);
      res.setHeader("content-type", "text/css; charset=utf-8");
      res.end(rewrittenCss);
      return;
    }

    res.end(buffer);
  } catch (error) {
    console.error("Proxy error:", error);
    sendPlain(res, 400, error.message || "Proxy request failed.");
  }
};
