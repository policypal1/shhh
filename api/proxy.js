// /api/proxy.js — Vercel serverless function
// Fetches a target URL, spoofs a mobile User-Agent, strips headers that block iframing,
// and rewrites relative URLs so the page renders properly inside the iframe.

export default async function handler(req, res) {
  const target = req.query.url;

  if (!target) {
    res.status(400).send('Missing url parameter');
    return;
  }

  // Basic safety: only allow http/https
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

  // Mobile User-Agent (iPhone Safari) — change if you want to spoof Android instead
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
    // (We don't forward upstream's X-Frame-Options or frame-ancestors CSP)
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.removeHeader && res.removeHeader('Content-Security-Policy');

    // For HTML, rewrite so relative URLs resolve correctly
    if (contentType.includes('text/html')) {
      let html = await upstream.text();

      // Inject a <base> tag so relative paths resolve to the original domain
      const baseTag = `<base href="${targetUrl.origin}${targetUrl.pathname.replace(/[^/]*$/, '')}">`;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (match) => match + baseTag);
      } else {
        html = baseTag + html;
      }

      // Strip any inline CSP meta tags that would block resources
      html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

      // Strip frame-busting scripts (basic — catches the common patterns)
      html = html.replace(/if\s*\(\s*(?:self|window)\s*!==?\s*(?:top|parent)\s*\)[^;{]*[;{]/gi, '/* frame-bust removed */');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(upstream.status).send(html);
      return;
    }

    // Non-HTML: pass through as-is (images, CSS, etc. won't normally hit here
    // since the <base> tag sends those requests directly to the origin server)
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buffer);

  } catch (err) {
    res.status(500).send('Proxy error: ' + (err.message || 'unknown'));
  }
}
