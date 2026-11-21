/* ============================================================
   GoPrint — builds a self-contained, print-ready dictionary of
   terms and proverbs. The browser's print dialog produces the PDF,
   so Chinese fonts and embedded images are handled natively.
   ============================================================ */
(function () {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mediaHtml(media) {
    if (!window.GoMedia || !Array.isArray(media) || !media.length) return '';
    return media.slice(0, 4).map(function (item) {
      if (item.type === 'image') {
        return '<figure><img src="' + esc(item.data) + '" alt="' + esc(item.caption || item.name || 'diagram') + '">' +
          (item.caption ? '<figcaption>' + esc(item.caption) + '</figcaption>' : '') + '</figure>';
      }
      var svg = window.GoMedia.sgfBoardSvg(item.data, 0);
      return svg ? '<figure>' + svg + (item.caption ? '<figcaption>' + esc(item.caption) + '</figcaption>' : '') + '</figure>' : '';
    }).join('');
  }

  function termRows(terms, kind) {
    return terms.map(function (term, index) {
      var notes = [term.notes, term.source ? 'Source: ' + term.source : ''].filter(Boolean).join(' · ');
      var explanation = [term.definition_zh, notes].filter(Boolean).join(' ');
      return '<tr>' +
        '<td class="num">' + (index + 1) + '</td>' +
        '<td class="sec">' + esc(term.letter) + '</td>' +
        '<td class="cn">' + esc(term.simplified) +
          (term.traditional ? ' <span class="trad">' + esc(term.traditional) + '</span>' : '') + '</td>' +
        '<td class="py">' + esc(term.pinyin) + '</td>' +
        '<td class="en">' + esc(term.senses && term.senses.length ? term.senses.join('; ') : term.english) + '</td>' +
        '<td class="note">' + esc(explanation) + '</td>' +
        '<td class="diagram">' + mediaHtml(term.media) + '</td>' +
        '</tr>';
    }).join('');
  }

  function proverbRows(proverbs) {
    return proverbs.map(function (proverb, index) {
      var notes = [proverb.notes, proverb.source ? 'Source: ' + proverb.source : ''].filter(Boolean).join(' · ');
      var explanation = [proverb.explanation_zh, notes].filter(Boolean).join(' ');
      return '<tr>' +
        '<td class="num">' + (index + 1) + '</td>' +
        '<td class="sec">' + esc(proverb.category) + '</td>' +
        '<td class="cn">' + esc(proverb.simplified) +
          (proverb.traditional ? ' <span class="trad">' + esc(proverb.traditional) + '</span>' : '') + '</td>' +
        '<td class="py">' + esc(proverb.pinyin) + '</td>' +
        '<td class="en">' + esc(proverb.english) + '</td>' +
        '<td class="note">' + esc(explanation) + '</td>' +
        '<td class="diagram">' + mediaHtml(proverb.media) + '</td>' +
        '</tr>';
    }).join('');
  }

  function groupProverbs(proverbs) {
    var groups = [];
    var byCategory = {};
    proverbs.forEach(function (proverb) {
      var category = proverb.category || '其他';
      if (!byCategory[category]) {
        byCategory[category] = [];
        groups.push(category);
      }
      byCategory[category].push(proverb);
    });
    return groups.map(function (category) {
      var rows = byCategory[category];
      return '<section class="proverb-group">' +
        '<h3>' + esc(category) + ' <span class="count">' + rows.length + '</span></h3>' +
        '<table class="dict"><thead><tr>' +
        '<th class="num">#</th><th class="sec">组</th><th class="cn">谚语 / Chinese</th>' +
        '<th class="py">Pinyin</th><th class="en">English</th><th class="note">简释 / Notes</th><th class="diagram">图</th>' +
        '</tr></thead><tbody>' + proverbRows(rows) + '</tbody></table></section>';
    }).join('');
  }

  function coverBoardSvg() {
    var size = 13;
    var cell = 8.2;
    var pad = 15;
    var stones = [
      [3, 3, 1], [9, 3, 2], [6, 6, 1], [3, 9, 2], [9, 9, 1], [6, 3, 2], [3, 6, 1], [9, 6, 2], [6, 9, 1],
    ];
    var parts = ['<svg viewBox="0 0 130 130" class="cover-board" role="img" aria-label="Go board">'];
    parts.push('<rect x="0" y="0" width="130" height="130" rx="8" fill="#e7c98f"/>');
    for (var i = 0; i < size; i += 1) {
      var at = pad + i * cell;
      parts.push('<line x1="' + pad + '" y1="' + at + '" x2="' + (pad + (size - 1) * cell) + '" y2="' + at + '" stroke="#6b4b24" stroke-width="0.7" opacity="0.6"/>');
      parts.push('<line x1="' + at + '" y1="' + pad + '" x2="' + at + '" y2="' + (pad + (size - 1) * cell) + '" stroke="#6b4b24" stroke-width="0.7" opacity="0.6"/>');
    }
    [[2, 2], [8, 2], [2, 8], [8, 8], [5, 5]].forEach(function (point) {
      parts.push('<circle cx="' + (pad + point[0] * cell) + '" cy="' + (pad + point[1] * cell) + '" r="1.3" fill="#4d3517"/>');
    });
    stones.forEach(function (stone) {
      parts.push('<circle cx="' + (pad + stone[0] * cell) + '" cy="' + (pad + stone[1] * cell) + '" r="3.5" fill="' +
        (stone[2] === 1 ? '#1b1b1b' : '#fbf7ea') + '" stroke="' + (stone[2] === 1 ? '#000' : '#4a4132') + '" stroke-width="0.5"/>');
    });
    parts.push('</svg>');
    return parts.join('');
  }

  function buildHtml(context) {
    var terms = context.terms || [];
    var proverbs = context.proverbs || [];
    var kind = context.kind || 'base';
    var generated = new Date();
    var dateText = generated.toLocaleDateString(context.locale || undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    var title = '围棋词典';
    var subtitle = 'Go Dictionary';
    var termLabel = kind === 'merged' ? '合并术语库' : '术语库';
    var termEnglish = kind === 'merged' ? 'Merged glossary' : 'Base glossary';

    var defColumn = kind === 'merged';

    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + title + ' · ' + subtitle + ' — PDF</title>' +
      '<style>' + printCss() + '</style></head><body>' +
      '<button type="button" class="print-button" onclick="window.print()">打印 / Print / Save as PDF</button>' +
      '<section class="cover">' +
        '<div class="cover-cn">围 棋 词 典</div>' +
        '<h1>Go Dictionary</h1>' +
        '<p class="cover-sub">围棋术语 · 围棋棋谚 — Chinese–English Go reference</p>' +
        coverBoardSvg() +
        '<div class="cover-meta">' +
          '<div><span>术语 Terms</span><strong>' + terms.length + '</strong></div>' +
          '<div><span>棋谚 Proverbs</span><strong>' + proverbs.length + '</strong></div>' +
          '<div><span>分类 Groups</span><strong>' + new Set(proverbs.map(function (p) { return p.category; })).size + '</strong></div>' +
        '</div>' +
        '<p class="cover-edition">' + esc(context.editionLabel || termEnglish) + ' · ' + esc(termLabel) + '</p>' +
        '<p class="cover-date">' + esc(dateText) + '</p>' +
        '<p class="cover-note">Personal reference edition. Chinese entries include traditional forms where they differ; ' +
        'pinyin and English renderings are provided for study.</p>' +
      '</section>' +

      '<section class="chapter">' +
        '<div class="chapter-head"><div><span class="chapter-cn">围棋术语</span><h2>Terms</h2></div>' +
        '<span class="chapter-count">' + terms.length + '</span></div>' +
        '<table class="dict"><thead><tr>' +
          '<th class="num">#</th><th class="sec">Sec</th><th class="cn">中文 / Chinese</th>' +
          '<th class="py">Pinyin</th><th class="en">English</th><th class="note">' +
          (defColumn ? '简释 / Notes' : 'Notes') + '</th><th class="diagram">图</th>' +
        '</tr></thead><tbody>' + termRows(terms, kind) + '</tbody></table>' +
      '</section>' +

      '<section class="chapter proverbs">' +
        '<div class="chapter-head"><div><span class="chapter-cn">围棋棋谚</span><h2>Go Proverbs</h2></div>' +
        '<span class="chapter-count">' + proverbs.length + '</span></div>' +
        '<p class="chapter-intro">A proverb states a rule of thumb; a term names a thing. ' +
        'Pinyin is given with tone marks, and the English is a working rendering rather than a literal gloss.</p>' +
        groupProverbs(proverbs) +
      '</section>' +

      '<section class="colophon">' +
        '<h2>Sources & licence</h2>' +
        '<p>Terms: Yee Fan Tan, <em>Chinese Go Terms</em> (OpenContent License); the merged glossary also draws on ' +
        'Sensei\'s Library and Go Magic, which do not grant redistribution rights.</p>' +
        '<p>Proverbs: a curated list assembled from zh.wikipedia (CC BY-SA 4.0), the public-domain ' +
        '<em>棋经十三篇</em>, Sensei\'s Library, Baidu Baike and Sohu. Explanations are paraphrases; every row ' +
        'points back to the page it was checked against.</p>' +
        '<p>Personal reference use only. Generated by Go Term Manager.</p>' +
      '</section>' +

      '<div class="print-footer"><span>围棋词典 · Go Dictionary</span><span>' +
        esc(context.editionLabel || '') + ' · ' + esc(dateText) + '</span></div>' +
      '</body></html>';
  }

  function printCss() {
    return [
      ':root { --ink:#1d211c; --muted:#6d726a; --line:#d8d2c4; --accent:#1e6b57; --gold:#a87a2a; }',
      '* { box-sizing: border-box; }',
      'html, body { margin:0; padding:0; color:var(--ink); background:#fff; }',
      'body { font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; font-size:9.2pt; line-height:1.45; padding-bottom:10mm; }',
      '.print-button { position:fixed; right:18px; bottom:18px; z-index:20; padding:10px 16px; border:0; border-radius:999px; background:#1e6b57; color:#fff; font:600 12px "Segoe UI",sans-serif; cursor:pointer; box-shadow:0 8px 24px rgba(0,0,0,.25); }',
      '.cover { min-height: 250mm; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; page-break-after:always; }',
      '.cover-cn { font-family:"Songti SC","STSong","SimSun",serif; font-size:30pt; letter-spacing:0.3em; color:#1e6b57; }',
      '.cover h1 { margin:4mm 0 2mm; font-family:Georgia,"Times New Roman",serif; font-size:34pt; font-weight:500; letter-spacing:0.04em; }',
      '.cover-sub { margin:0 0 10mm; color:var(--muted); font-size:10.5pt; letter-spacing:0.05em; }',
      '.cover-board { width:78mm; height:78mm; display:block; margin:4mm auto 10mm; }',
      '.cover-meta { display:flex; gap:10mm; padding:4mm 8mm; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }',
      '.cover-meta div { display:flex; flex-direction:column; gap:1mm; min-width:24mm; }',
      '.cover-meta span { color:var(--muted); font-size:8.5pt; letter-spacing:0.04em; }',
      '.cover-meta strong { font-size:18pt; font-weight:600; color:var(--accent); }',
      '.cover-edition { margin:8mm 0 1mm; font-size:10pt; }',
      '.cover-date { margin:0; color:var(--muted); font-size:9pt; }',
      '.cover-note { max-width:120mm; margin:9mm 0 0; color:var(--muted); font-size:8.3pt; line-height:1.6; }',
      '.chapter { page-break-before:auto; }',
      '.proverbs { page-break-before:always; }',
      '.chapter-head { display:flex; align-items:flex-end; justify-content:space-between; gap:6mm; border-bottom:2px solid var(--ink); padding-bottom:2.5mm; margin-bottom:4mm; }',
      '.chapter-cn { display:block; font-family:"Songti SC","STSong","SimSun",serif; font-size:15pt; color:var(--accent); letter-spacing:0.18em; }',
      '.chapter-head h2 { margin:0.5mm 0 0; font-family:Georgia,serif; font-size:20pt; font-weight:500; }',
      '.chapter-count { font-size:22pt; font-weight:600; color:var(--gold); }',
      '.chapter-intro { margin:0 0 5mm; color:var(--muted); font-size:8.6pt; max-width:150mm; }',
      'table.dict { width:100%; border-collapse:collapse; table-layout:fixed; }',
      'table.dict thead { display:table-header-group; }',
      'table.dict th { padding:2mm 1.6mm; border-bottom:1.2px solid var(--ink); text-align:left; font-size:7.6pt; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); }',
      'table.dict td { padding:1.8mm 1.6mm; border-bottom:0.5px solid var(--line); vertical-align:top; }',
      'table.dict tr { break-inside:avoid; page-break-inside:avoid; }',
      'table.dict tbody tr:nth-child(even) { background:#faf8f2; }',
      '.num { width:7mm; color:var(--muted); font-size:7.5pt; }',
      '.sec { width:11mm; color:var(--muted); font-size:7.5pt; }',
      'table.dict th.cn { width:34mm; }',
      'table.dict th.py { width:32mm; }',
      'table.dict th.en { width:55mm; }',
      'table.dict th.note { width:auto; }',
      'table.dict th.diagram { width:28mm; text-align:center; }',
      '.cn { font-family:"Songti SC","STSong","SimSun","Noto Serif CJK SC",serif; font-size:10.5pt; line-height:1.35; }',
      '.trad { color:var(--muted); font-size:8pt; }',
      '.py { font-size:8.2pt; color:#255f4f; }',
      '.en { font-size:8.6pt; }',
      '.note { color:#4e544c; font-size:7.8pt; line-height:1.45; }',
      '.diagram { text-align:center; }',
      '.diagram figure { margin:0 0 1mm; }',
      '.diagram img, .diagram svg { max-width:22mm; max-height:22mm; width:auto; height:auto; display:block; margin:0 auto; }',
      '.diagram figcaption { display:none; }',
      '.sgf-board { border-radius:1mm; }',
      '.proverb-group { margin-bottom:5mm; }',
      '.proverb-group h3 { margin:0 0 2mm; font-family:"Songti SC","STSong","SimSun",serif; font-size:11pt; letter-spacing:0.08em; color:var(--ink); }',
      '.proverb-group h3 .count { margin-left:2mm; color:var(--muted); font-family:"Segoe UI",sans-serif; font-size:7.5pt; font-weight:400; }',
      '.colophon { page-break-before:always; padding-top:8mm; border-top:1px solid var(--line); }',
      '.colophon h2 { font-family:Georgia,serif; font-weight:500; font-size:15pt; }',
      '.colophon p { max-width:155mm; color:var(--muted); font-size:8.4pt; line-height:1.6; }',
      '.print-footer { position:fixed; left:0; right:0; bottom:4mm; display:flex; justify-content:space-between; color:#8b8f86; font-size:7pt; border-top:0.5px solid var(--line); padding-top:1.5mm; }',
      '@page { size: A4 portrait; margin: 14mm 12mm 18mm; }',
      '@media print { .print-button { display:none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }',
    ].join('\n');
  }

  window.GoPrint = {
    buildHtml: buildHtml,
    buildPrintCss: printCss,
  };
})();
