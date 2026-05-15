const dns = require("dns").promises;
const net = require("net");

const ALLOWED_HOSTS = [
  "example.com",
  "www.example.com",

  // Add your own/client domains here:
  "theoneclearchoiceautoglass.com",
  "www.theoneclearchoiceautoglass.com",
  "keizermobiledetailing.com",
  "www.keizermobiledetailing.com"
];

const MAX_RESPONSE_BYTES = 4_500_000;

function isAllowedHost(hostname) {
  const cleanHost = hostname.toLowerCase();

  return ALLOWED_HOSTS.some((allowedHost) => {
    const cleanAllowed = allowedHost.toLowerCase().trim();

    if (cleanAllowed.startsWith("*.")) {
      const root = cleanAllowed.slice(2);
      return cleanHost === root || cleanHost.endsWith("." + root);
    }

    return cleanHost === cleanAllowed;
  });
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
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80")) return true;
    if (lower === "::") return true;

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

  if (!isAllowedHost(target.hostname)) {
    throw new Error(`This domain is not allowed: ${target.hostname}`);
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

function makeProxyUrl(rawUrl, baseUrl) {
  try {
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
  return srcset
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
  return cssText.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, rawUrl) => {
    const cleanUrl = rawUrl.trim();

    if (
      !cleanUrl ||
      cleanUrl.startsWith("data:") ||
      cleanUrl.startsWith("blob:") ||
      cleanUrl.startsWith("#")
    ) {
      return match;
    }

    const rewritten = makeProxyUrl(cleanUrl, baseUrl);
    return `url("${rewritten}")`;
  });
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
      alert("POST forms are disabled in this learning preview tool.");
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
  let rewritten = html;

  rewritten = rewritten.replace(/<head([^>]*)>/i, (match, attrs) => {
    return `<head${attrs}><base href="${escapeHtmlAttr(baseUrl)}">`;
  });

  rewritten = rewritten.replace(
    /\s(href|src|action|poster)=("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, attr, fullValue, doubleQuoted, singleQuoted, unquoted) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";

      if (
        !value ||
        value.startsWith("#") ||
        value.startsWith("javascript:") ||
        value.startsWith("mailto:") ||
        value.startsWith("tel:") ||
        value.startsWith("data:") ||
        value.startsWith("blob:")
      ) {
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

  // Do not pass upstream CSP/X-Frame-Options because this is a controlled preview frame.
}

async function responseToLimitedBuffer(response) {
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_RESPONSE_BYTES) {
    throw new Error("Response too large for preview.");
  }

  return buffer;
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

      if (!isAllowedHost(redirectTarget.hostname)) {
        res.statusCode = 403;
        res.end("Redirect blocked because the target domain is not allowlisted.");
        return;
      }

      res.statusCode = upstreamResponse.status;
      res.setHeader(
        "location",
        `/api/proxy?url=${encodeURIComponent(redirectTarget.href)}`
      );
      res.end();
      return;
    }

    copySafeHeaders(upstreamResponse, res);

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const buffer = await responseToLimitedBuffer(upstreamResponse);

    res.statusCode = upstreamResponse.status;

    if (contentType.includes("text/html")) {
      const html = buffer.toString("utf8");
      const rewrittenHtml = rewriteHtml(html, target.href);
      res.end(rewrittenHtml);
      return;
    }

    if (
      contentType.includes("text/css") ||
      target.pathname.toLowerCase().endsWith(".css")
    ) {
      const css = buffer.toString("utf8");
      const rewrittenCss = rewriteCssUrls(css, target.href);
      res.end(rewrittenCss);
      return;
    }

    res.end(buffer);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`
      <div style="font-family: system-ui, sans-serif; padding: 24px;">
        <h2>Preview blocked</h2>
        <p>${escapeHtmlAttr(error.message)}</p>
        <p style="color:#666;font-size:14px;">
          Add the site to <code>ALLOWED_HOSTS</code> in <code>api/proxy.js</code> if you own it or have permission to test it.
        </p>
      </div>
    `);
  }
};
