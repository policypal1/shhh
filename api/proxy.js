// /api/proxy.js — Vercel serverless function
// Fetches a target URL, spoofs a mobile User-Agent, strips iframe-blocking headers,
// and rewrites links/forms so clicks inside the iframe stay routed through the proxy.

export default async function handler(req, res) {
  const target = req.query.url;

  if (!target) {
    res.status(400).send('Missing url parameter');
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      res.status(400).send('Only http/https URLs are allowed');
      return;
    }
  } catch {
    res.status(400).send('Invalid URL');
    return;
  }

  const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

  try {
    const upstream = await fetch(targetUrl.href, {
      headers: {
        'User-Agent': mobileUA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const contentType = upstream.headers.get('content-type') || '';

    // Strip headers that would prevent iframing
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (res.removeHeader) res.removeHeader('Content-Security-Policy');

    if (contentType.includes('text/html')) {
      let html = await upstream.text();

      const origin = targetUrl.origin;
      const basePath = targetUrl.pathname.replace(/[^/]*$/, '');

      // Helper: turn a (possibly relative) URL into an absolute URL using the target page as the base
      const absolutize = (href) => {
        if (!href) return null;
        if (href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) {
          return null; // leave alone
        }
        try {
          return new URL(href, origin + basePath).href;
        } catch {
          return null;
        }
      };

      // Inject <base> so images, CSS, scripts (non-anchor URLs) resolve from the real origin.
      // We rewrite anchors and forms BELOW to go through the proxy.
      const baseTag = `<base href="${origin}${basePath}">`;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => m + baseTag);
      } else {
        html = baseTag + html;
      }

      // Remove inline CSP meta tags that could block resources
      html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

      // Strip basic frame-busting scripts
      html = html.replace(/if\s*\(\s*(?:self|window)\s*!==?\s*(?:top|parent)\s*\)[^;{]*[;{]/gi, '/* frame-bust removed */');

      // Rewrite <a href="..."> to route through the proxy
      html = html.replace(/<a\b([^>]*?)\shref=(["'])([^"']+)\2/gi, (match, attrs, quote, href) => {
        const abs = absolutize(href);
        if (!abs) return match;
        const proxied = '/api/proxy?url=' + encodeURIComponent(abs);
        return `<a${attrs} href=${quote}${proxied}${quote}`;
      });

      // Rewrite <form action="..."> to route through the proxy
      html = html.replace(/<form\b([^>]*?)\saction=(["'])([^"']+)\2/gi, (match, attrs, quote, action) => {
        const abs = absolutize(action);
        if (!abs) return match;
        const proxied = '/api/proxy?url=' + encodeURIComponent(abs);
        return `<form${attrs} action=${quote}${proxied}${quote}`;
      });

      // Forms with no action (submit to current URL) need an action added pointing back to current proxied URL
      const currentProxied = '/api/proxy?url=' + encodeURIComponent(targetUrl.href);
      html = html.replace(/<form\b((?:(?!action=)[^>])*?)>/gi, (match, attrs) => {
        return `<form${attrs} action="${currentProxied}">`;
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(upstream.status).send(html);
      return;
    }

    // Non-HTML: pass through
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buffer);

  } catch (err) {
    res.status(500).send('Proxy error: ' + (err.message || 'unknown'));
  }
}
