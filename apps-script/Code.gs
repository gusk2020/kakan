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

/**
 * Resolve old SmartNews rows in small batches.
 * Run manually from Apps Script while backfilling. It never guesses:
 * only title-verified matches become confirmed.
 */
function resolveUnresolvedSmartNews(limit) {
  limit = Math.max(1, Math.min(Number(limit) || 20, 50));

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CONFIG.ITEMS_SHEET);
  if (!sh) throw new Error('Items sheet not found');

  const last = sh.getLastRow();
  if (last < 2) return { checked: 0, confirmed: 0 };

  const values = sh.getRange(2, 1, last - 1, 19).getDisplayValues();
  let checked = 0;
  let confirmed = 0;

  for (let i = 0; i < values.length && checked < limit; i++) {
    const row = values[i];
    const source = row[2];
    const title = row[3];
    const currentUrl = row[4];
    const smartnewsUrl = row[15] || currentUrl;
    const status = row[17];

    if (source !== 'SmartNews' || status !== 'unresolved' || !smartnewsUrl) continue;

    checked++;
    const resolved = resolveUrl_(smartnewsUrl, title);
    if (resolved.status !== 'confirmed' || !resolved.url) continue;

    const sheetRow = i + 2;
    sh.getRange(sheetRow, 5).setValue(resolved.url);          // E url
    sh.getRange(sheetRow, 16).setValue(smartnewsUrl);         // P smartnews_url
    sh.getRange(sheetRow, 17).setValue(resolved.publisher);   // Q publisher
    sh.getRange(sheetRow, 18).setValue('confirmed');          // R url_resolution
    sh.getRange(sheetRow, 19).setValue(new Date());           // S resolved_at
    confirmed++;
  }

  return { checked, confirmed };
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

    if (res.getResponseCode() >= 400) {
      return { url: '', smartnewsUrl, publisher: '', status: 'unresolved' };
    }

    const html = res.getContentText();
    const candidates = extractExternalCandidates_(html);

    for (const candidate of candidates) {
      const check = verifyCandidate_(candidate, sharedTitle);
      if (check.confirmed) {
        return {
          url: candidate,
          smartnewsUrl,
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
  const seen = {};
  const body = String(html || '');

  const rawMatches = body.match(/https?:\/\/[^"'<>\s]+/g) || [];
  const escapedMatches = body.match(/https?:\\\/\\\/[^"'<>\s]+/g) || [];

  rawMatches.concat(escapedMatches).forEach(raw => {
    const u = raw
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&')
      .replace(/[),\]}]+$/, '');

    const h = hostname_(u);
    if (!h) return;
    if (/(^|\.)smartnews\.com$/i.test(h)) return;
    if (/(^|\.)(google|gstatic|doubleclick)\./i.test(h)) return;

    if (!seen[u]) {
      seen[u] = true;
      out.push(u);
    }
  });

  return out.slice(0, 30);
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
      matchOne_(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
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
  const union = Object.keys(Object.fromEntries([...A, ...B].map(x => [x, true]))).length;
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

  const compact = n.replace(/\s+/g, '');
  for (let i = 0; i < compact.length - 1; i++) {
    set.add(compact.slice(i, i + 2));
  }
  return set;
}

function hostname_(url) {
  const m = String(url || '').match(/^https?:\/\/([^\/:?#]+)/i);
  return m ? m[1].replace(/^www\./i, '').toLowerCase() : '';
}
