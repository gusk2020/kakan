const CONFIG = {
  SPREADSHEET_ID: '1jWW79evANFfp3wa9gAqwb-8w_b9zLP5dxz4ASkkEz_A',
  ITEMS_SHEET: 'Items',
  LABELS_SHEET: 'Labels',
};

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('index');
  t.sharedTitle = (e && e.parameter && e.parameter.title) || '';
  t.sharedText = (e && e.parameter && e.parameter.text) || '';
  t.sharedUrl = (e && e.parameter && e.parameter.url) || '';
  return t.evaluate()
    .setTitle('情報保存')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getLabels() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CONFIG.LABELS_SHEET);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 1).getDisplayValues()
    .flat()
    .map(x => x.trim())
    .filter(Boolean);
}

function saveItem(payload) {
  if (!payload) throw new Error('payload is required');

  const title = String(payload.title || '').trim();
  const text = String(payload.text || '').trim();
  const incomingUrl = extractFirstUrl(String(payload.url || '') + '\n' + text);
  const labels = Array.isArray(payload.labels) ? payload.labels.filter(Boolean) : [];

  const resolved = resolveUrl_(incomingUrl, title);

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CONFIG.ITEMS_SHEET);
  if (!sh) throw new Error('Items sheet not found');

  const id = Utilities.getUuid();
  const now = new Date();
  const source = detectSource_(incomingUrl, resolved.url);

  // Items schema:
  // A id, B saved_at, C source, D title, E url, F labels, G note,
  // H original_share_text, I added_via, J processed_state,
  // K source_created_at, L source_updated_at, M pinned, N archived, O trashed,
  // P smartnews_url, Q publisher, R url_resolution, S resolved_at
  sh.appendRow([
    id,
    now,
    source,
    title,
    resolved.url || incomingUrl,
    labels.join(' | '),
    String(payload.note || ''),
    text,
    'share_bridge',
    'imported',
    '',
    '',
    false,
    false,
    false,
    resolved.smartnewsUrl || '',
    resolved.publisher || '',
    resolved.status,
    resolved.status === 'confirmed' ? now : ''
  ]);

  return {
    ok: true,
    id,
    source,
    url: resolved.url || incomingUrl,
    resolution: resolved.status,
  };
}

function detectSource_(incomingUrl, finalUrl) {
  const u = (incomingUrl || finalUrl || '').toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'YouTube';
  if (u.includes('smartnews.com') || u.includes('l.smartnews.com')) return 'SmartNews';
  return 'Web';
}

function extractFirstUrl(s) {
  const m = String(s || '').match(/https?:\/\/[^\s<>"]+/i);
  return m ? m[0].replace(/[)\]}>。、，]+$/, '') : '';
}

function resolveUrl_(incomingUrl, sharedTitle) {
  if (!incomingUrl) {
    return { url: '', smartnewsUrl: '', publisher: '', status: 'unresolved' };
  }

  if (!/smartnews\.com/i.test(incomingUrl)) {
    return { url: incomingUrl, smartnewsUrl: '', publisher: hostname_(incomingUrl), status: 'direct' };
  }

  const smartnewsUrl = incomingUrl;

  try {
    const res = UrlFetchApp.fetch(incomingUrl, {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const html = res.getContentText();
    const finalSmartnewsUrl = res.getAllHeaders()['Location'] || incomingUrl;
    const candidates = extractExternalCandidates_(html);

    for (const candidate of candidates) {
      const check = verifyCandidate_(candidate, sharedTitle);
      if (check.confirmed) {
        return {
          url: candidate,
          smartnewsUrl: finalSmartnewsUrl || smartnewsUrl,
          publisher: hostname_(candidate),
          status: 'confirmed',
        };
      }
    }
  } catch (err) {
    console.log('resolveUrl_ failed: ' + err);
  }

  return {
    url: '',
    smartnewsUrl,
    publisher: '',
    status: 'unresolved',
  };
}

function extractExternalCandidates_(html) {
  const out = [];
  const seen = new Set();
  const regex = /https?:\\?\/\\?\/[^"'<>\\\s]+/g;
  const matches = String(html || '').match(regex) || [];

  matches.forEach(raw => {
    let u = raw
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&');

    try {
      const h = new URL(u).hostname;
      if (!/smartnews\.com$/i.test(h) && !/google|gstatic|doubleclick/i.test(h)) {
        if (!seen.has(u)) {
          seen.add(u);
          out.push(u);
        }
      }
    } catch (_) {}
  });

  return out.slice(0, 20);
}

function verifyCandidate_(url, sharedTitle) {
  if (!sharedTitle) return { confirmed: false };
  try {
    const r = UrlFetchApp.fetch(url, {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (r.getResponseCode() >= 400) return { confirmed: false };

    const html = r.getContentText();
    const title =
      matchOne_(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      matchOne_(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
      '';

    return { confirmed: titleSimilarity_(sharedTitle, title) >= 0.72 };
  } catch (_) {
    return { confirmed: false };
  }
}

function matchOne_(s, re) {
  const m = String(s || '').match(re);
  return m ? decodeHtml_(m[1]).trim() : '';
}

function decodeHtml_(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function titleSimilarity_(a, b) {
  const A = tokenSet_(a);
  const B = tokenSet_(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}

function tokenSet_(s) {
  const n = String(s || '')
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .replace(/[「」『』【】（）()［］\[\]、。,.!！?？:：;；"'“”‘’]/g, ' ')
    .trim();

  const set = new Set();
  if (!n) return set;

  // Japanese titles do not split cleanly by spaces, so use character bigrams.
  const compact = n.replace(/\s+/g, '');
  for (let i = 0; i < compact.length - 1; i++) {
    set.add(compact.slice(i, i + 2));
  }
  return set;
}

function hostname_(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}
