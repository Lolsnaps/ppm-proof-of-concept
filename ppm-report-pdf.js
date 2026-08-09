/*
  PPM Report PDF
  --------------
  Builds properly laid-out, printable PDF reports rather than a dump of table rows.

  Every report gets: a branded cover page, a generation and filter summary, an
  optional KPI band, optional charts, then styled tables with headers that repeat
  on each page, a running page header and a "Page X of Y" footer.

  Requires pdfmake.min.js and vfs_fonts.js to be loaded first.

  Usage:
      PPMReportPdf.download({
        title: "Portfolio status report",
        subtitle: "All active projects",
        meta: { filters: ["Portfolio: Foresters"], generatedBy: "A. Taylor" },
        kpis: [{ label: "Projects", value: 24 }, { label: "Red", value: 3, tone: "red" }],
        charts: [{ title: "Overall RAG", type: "bar", data: [{ label: "Green", value: 12, tone: "green" }] }],
        sections: [{ heading: "Project register", table: { columns, rows } }]
      }, "portfolio-status");
*/
(function () {
  "use strict";

  const BRAND = {
    plum: "#5b294f",
    plumDark: "#3f1937",
    plumTint: "#f6eef4",
    ink: "#172033",
    muted: "#64748b",
    line: "#dbe3ef",
    zebra: "#fbfcfe",
    organisation: "Foresters Portfolio"
  };

  // Text and fill colours for RAG-style values, used in KPI boxes, chart bars
  // and any table cell whose value reads as a RAG status.
  const TONES = {
    red: { text: "#991b1b", fill: "#fee2e2", solid: "#dc2626" },
    amber: { text: "#92400e", fill: "#fef3c7", solid: "#d97706" },
    green: { text: "#166534", fill: "#dcfce7", solid: "#16a34a" },
    blue: { text: "#075985", fill: "#e0f2fe", solid: "#0284c7" },
    plum: { text: BRAND.plumDark, fill: BRAND.plumTint, solid: BRAND.plum },
    neutral: { text: "#334155", fill: "#f1f5f9", solid: "#94a3b8" }
  };

  function tone(name) {
    return TONES[String(name || "neutral").toLowerCase()] || TONES.neutral;
  }

  // Guesses a tone from a cell's text, so RAG columns colour themselves.
  function toneFromValue(value) {
    const text = String(value || "")
      .trim()
      .toLowerCase();
    if (/^red$|overdue|rejected|breach|critical|at risk/.test(text)) return "red";
    if (/^amber$|pending|awaiting|requested|watch|deferred/.test(text)) return "amber";
    if (/^green$|approved|complete|on track|realised|closed/.test(text)) return "green";
    return "";
  }

  /* ------------------------------------------------------------------ helpers */

  // Report rows are built for the screen, so they can contain markup and links.
  // Strip all of that back to plain text before it reaches the PDF.
  function plain(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Stored dates are ISO. Readers expect "06 Oct 2026", so convert on the way in.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/;

  function readableDate(value) {
    const text = String(value || "");
    if (!ISO_DATE.test(text)) return text;
    const date = new Date(`${text.slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? text
      : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function today() {
    return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  }

  function stamp() {
    return new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function ready() {
    return typeof window.pdfMake !== "undefined";
  }

  /* ------------------------------------------------------------------- charts */

  // Small inline SVG charts. pdfmake renders SVG natively, so this avoids
  // pulling in a charting library just for a few bars.
  function barChartSvg(data, width, height) {
    const rows = (data || []).filter((row) => row && Number(row.value) >= 0);
    if (!rows.length) return "";
    const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
    const labelWidth = 96;
    const rowHeight = 22;
    const chartHeight = Math.max(height || 0, rows.length * rowHeight + 8);
    const barArea = width - labelWidth - 44;

    const bars = rows
      .map((row, index) => {
        const y = index * rowHeight + 4;
        const value = Number(row.value) || 0;
        const barWidth = Math.max(1, (value / max) * barArea);
        const colour = tone(row.tone || toneFromValue(row.label) || "plum").solid;
        return `<text x="0" y="${y + 12}" font-family="Helvetica" font-size="9" fill="${BRAND.muted}">${escapeXml(row.label)}</text>
        <rect x="${labelWidth}" y="${y + 3}" width="${barWidth}" height="12" rx="3" fill="${colour}"/>
        <text x="${labelWidth + barWidth + 6}" y="${y + 13}" font-family="Helvetica" font-size="9" font-weight="bold" fill="${BRAND.ink}">${value}</text>`;
      })
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${chartHeight}" viewBox="0 0 ${width} ${chartHeight}">${bars}</svg>`;
  }

  function donutChartSvg(data, size) {
    const rows = (data || []).filter((row) => Number(row.value) > 0);
    const total = rows.reduce((sum, row) => sum + Number(row.value), 0);
    if (!total) return "";
    const radius = size / 2 - 6;
    const inner = radius * 0.58;
    const centre = size / 2;
    let angle = -Math.PI / 2;

    const slices = rows
      .map((row) => {
        const share = Number(row.value) / total;
        const end = angle + share * Math.PI * 2;
        const large = share > 0.5 ? 1 : 0;
        const path = [
          `M ${centre + Math.cos(angle) * radius} ${centre + Math.sin(angle) * radius}`,
          `A ${radius} ${radius} 0 ${large} 1 ${centre + Math.cos(end) * radius} ${centre + Math.sin(end) * radius}`,
          `L ${centre + Math.cos(end) * inner} ${centre + Math.sin(end) * inner}`,
          `A ${inner} ${inner} 0 ${large} 0 ${centre + Math.cos(angle) * inner} ${centre + Math.sin(angle) * inner}`,
          "Z"
        ].join(" ");
        angle = end;
        return `<path d="${path}" fill="${tone(row.tone || toneFromValue(row.label) || "plum").solid}"/>`;
      })
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${slices}
      <text x="${centre}" y="${centre + 4}" text-anchor="middle" font-family="Helvetica" font-size="14" font-weight="bold" fill="${BRAND.ink}">${total}</text></svg>`;
  }

  function escapeXml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function chartBlock(chart, availableWidth) {
    const data = (chart.data || []).map((row) => ({ ...row, value: Number(row.value) || 0 }));
    if (!data.some((row) => row.value > 0)) return null;

    if (chart.type === "donut") {
      return {
        columns: [
          { svg: donutChartSvg(data, 120), width: 120 },
          {
            stack: data.map((row) => ({
              columns: [
                {
                  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"><rect width="9" height="9" rx="2" fill="${tone(row.tone || toneFromValue(row.label) || "plum").solid}"/></svg>`,
                  width: 12
                },
                {
                  text: `${plain(row.label)}  ${row.value}`,
                  fontSize: 9,
                  color: BRAND.ink,
                  margin: [0, -1, 0, 0]
                }
              ],
              margin: [0, 0, 0, 5]
            })),
            margin: [12, 6, 0, 0]
          }
        ],
        margin: [0, 4, 0, 10]
      };
    }

    return { svg: barChartSvg(data, availableWidth, 0), margin: [0, 4, 0, 10] };
  }

  /* -------------------------------------------------------------- table build */

  const TABLE_LAYOUT = {
    hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.9 : 0.4),
    vLineWidth: () => 0,
    hLineColor: (i) => (i <= 1 ? BRAND.plum : BRAND.line),
    paddingTop: () => 5,
    paddingBottom: () => 5,
    paddingLeft: () => 6,
    paddingRight: () => 6,
    fillColor: (rowIndex) => (rowIndex === 0 ? BRAND.plum : rowIndex % 2 === 0 ? BRAND.zebra : null)
  };

  // Proportional column widths, weighted by header length and the longest
  // value in the column, so wide free-text columns get the room they need.
  function columnWidths(columns, rows) {
    const weights = columns.map((column, index) => {
      const headerLength = plain(column.label || column.key).length;
      const sample = rows.slice(0, 60).reduce((longest, row) => {
        const cell = plain(Array.isArray(row) ? row[index] : row[column.key]).length;
        return Math.max(longest, cell);
      }, 0);
      return Math.min(46, Math.max(8, headerLength + 2, Math.min(sample, 46)));
    });
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    return weights.map((weight) => `${Math.max(4, Math.round((weight / total) * 100))}%`);
  }

  function tableNode(table, availableWidth) {
    const columns = (table.columns || []).map((column) =>
      typeof column === "string" ? { key: column, label: column } : column
    );
    const rows = table.rows || [];

    if (!columns.length)
      return { text: table.empty || "No information is available for this section.", style: "empty" };
    if (!rows.length)
      return { text: table.empty || "No information matches the selected filters.", style: "empty" };

    const header = columns.map((column) => ({
      text: plain(column.label || column.key),
      style: "th",
      alignment: column.align || "left"
    }));

    const body = rows.map((row) =>
      columns.map((column, index) => {
        const raw = Array.isArray(row) ? row[index] : row[column.key];
        const text = readableDate(plain(raw));
        const cellTone = column.tone === false ? "" : toneFromValue(text);
        return {
          text: text || "—",
          style: "td",
          alignment: column.align || "left",
          color: cellTone ? tone(cellTone).text : BRAND.ink,
          bold: Boolean(cellTone) || Boolean(column.bold)
        };
      })
    );

    return {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: table.widths || columnWidths(columns, rows),
        body: [header, ...body]
      },
      layout: TABLE_LAYOUT,
      margin: [0, 2, 0, 12]
    };
  }

  /* ---------------------------------------------------------------- KPI band */

  function kpiBand(kpis) {
    const cards = (kpis || []).slice(0, 6);
    if (!cards.length) return null;
    return {
      table: {
        widths: cards.map(() => "*"),
        body: [
          cards.map((card) => ({
            stack: [
              {
                text: plain(card.label),
                fontSize: 7.5,
                color: BRAND.muted,
                bold: true,
                margin: [0, 0, 0, 3]
              },
              { text: String(card.value ?? "—"), fontSize: 17, bold: true, color: tone(card.tone).text },
              card.note
                ? { text: plain(card.note), fontSize: 7, color: BRAND.muted, margin: [0, 3, 0, 0] }
                : null
            ].filter(Boolean),
            fillColor: card.tone ? tone(card.tone).fill : "#ffffff",
            margin: [8, 8, 8, 8]
          }))
        ]
      },
      layout: {
        hLineWidth: () => 0.6,
        vLineWidth: () => 0.6,
        hLineColor: () => BRAND.line,
        vLineColor: () => BRAND.line,
        paddingTop: () => 0,
        paddingBottom: () => 0,
        paddingLeft: () => 0,
        paddingRight: () => 0
      },
      margin: [0, 0, 0, 14]
    };
  }

  /* -------------------------------------------------------------- cover page */

  function coverPage(spec, pageWidth) {
    const meta = spec.meta || {};
    const filters = (meta.filters || []).filter(Boolean);

    const detail = [
      ["Report", plain(spec.title)],
      ["Prepared for", plain(meta.preparedFor || BRAND.organisation)],
      ["Generated", `${stamp()}${meta.generatedBy ? ` by ${plain(meta.generatedBy)}` : ""}`],
      ["Reporting period", plain(meta.period || "Current position")],
      ["Classification", plain(meta.classification || "Internal")],
      ["Filters applied", filters.length ? filters.map(plain).join("   ·   ") : "None — full portfolio"]
    ];

    return [
      {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="150" viewBox="0 0 ${pageWidth} 150">
          <rect width="${pageWidth}" height="150" fill="${BRAND.plum}"/>
          <rect x="0" y="140" width="${pageWidth}" height="10" fill="${BRAND.plumDark}"/>
          <text x="26" y="52" font-family="Helvetica" font-size="12" letter-spacing="2" fill="#eadde7">${escapeXml(BRAND.organisation.toUpperCase())}</text>
          <text x="26" y="94" font-family="Helvetica" font-size="24" font-weight="bold" fill="#ffffff">${escapeXml(plain(spec.title).slice(0, 52))}</text>
          <text x="26" y="120" font-family="Helvetica" font-size="11" fill="#eadde7">${escapeXml(plain(spec.subtitle || today()).slice(0, 88))}</text>
        </svg>`,
        margin: [0, 0, 0, 26]
      },
      spec.standfirst
        ? {
            text: plain(spec.standfirst),
            fontSize: 11,
            color: BRAND.ink,
            lineHeight: 1.4,
            margin: [0, 0, 0, 22]
          }
        : null,
      {
        table: {
          widths: [110, "*"],
          body: detail.map(([label, value]) => [
            { text: label, fontSize: 8.5, bold: true, color: BRAND.muted, margin: [0, 5, 0, 5] },
            { text: value, fontSize: 9.5, color: BRAND.ink, margin: [0, 5, 0, 5] }
          ])
        },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => BRAND.line,
          paddingLeft: () => 0,
          paddingRight: () => 8
        },
        margin: [0, 0, 0, 24]
      },
      (spec.sections || []).length > 1
        ? {
            stack: [
              { text: "Contents", style: "h2", margin: [0, 0, 0, 8] },
              {
                ol: (spec.sections || []).map((section) => plain(section.heading || "Section")),
                fontSize: 9.5,
                color: BRAND.ink,
                lineHeight: 1.5
              }
            ]
          }
        : null,
      { text: "", pageBreak: "after" }
    ].filter(Boolean);
  }

  /* ------------------------------------------------------------- document build */

  function build(spec) {
    const settings = spec || {};
    const landscape =
      settings.orientation === "landscape" ||
      (settings.sections || []).some((section) => (section.table?.columns || []).length > 7);
    const pageSize = "A4";
    const margins = [26, landscape ? 52 : 56, 26, 42];
    const pageWidth = (landscape ? 842 : 595) - margins[0] - margins[2];

    const content = [...coverPage(settings, pageWidth)];

    const band = kpiBand(settings.kpis);
    if (band) content.push(band);

    (settings.charts || []).forEach((chart) => {
      const node = chartBlock(chart, pageWidth);
      if (!node) return;
      content.push({ text: plain(chart.title || ""), style: "h3" });
      content.push(node);
    });

    (settings.sections || []).forEach((section, index) => {
      content.push({
        text: plain(section.heading || `Section ${index + 1}`),
        style: "h2",
        pageBreak: index > 0 && section.newPage !== false ? "before" : undefined
      });
      if (section.intro) content.push({ text: plain(section.intro), style: "intro" });
      if (section.kpis) {
        const sectionBand = kpiBand(section.kpis);
        if (sectionBand) content.push(sectionBand);
      }
      (section.charts || []).forEach((chart) => {
        const node = chartBlock(chart, pageWidth);
        if (!node) return;
        content.push({ text: plain(chart.title || ""), style: "h3" });
        content.push(node);
      });
      if (section.table) content.push(tableNode(section.table, pageWidth));
      (section.tables || []).forEach((table) => {
        if (table.heading) content.push({ text: plain(table.heading), style: "h3" });
        content.push(tableNode(table, pageWidth));
      });
      if (section.notes) content.push({ text: plain(section.notes), style: "note" });
    });

    return {
      pageSize,
      pageOrientation: landscape ? "landscape" : "portrait",
      pageMargins: margins,
      info: {
        title: plain(settings.title || "PPM report"),
        author: plain(settings.meta?.generatedBy || BRAND.organisation),
        subject: plain(settings.subtitle || "")
      },
      defaultStyle: { font: "Roboto", fontSize: 9, color: BRAND.ink },
      styles: {
        h2: { fontSize: 15, bold: true, color: BRAND.plum, margin: [0, 6, 0, 8] },
        h3: { fontSize: 10.5, bold: true, color: BRAND.plumDark, margin: [0, 8, 0, 4] },
        intro: { fontSize: 9, color: BRAND.muted, lineHeight: 1.4, margin: [0, 0, 0, 10] },
        note: { fontSize: 8, color: BRAND.muted, italics: true, margin: [0, 2, 0, 12] },
        empty: { fontSize: 9, color: BRAND.muted, italics: true, margin: [0, 4, 0, 14] },
        th: { fontSize: 7.5, bold: true, color: "#ffffff" },
        td: { fontSize: 8 }
      },
      // Page 1 is the cover, so the running header starts on page 2.
      header: (currentPage) =>
        currentPage === 1
          ? null
          : {
              columns: [
                {
                  text: plain(settings.title || ""),
                  fontSize: 8,
                  bold: true,
                  color: BRAND.plum,
                  margin: [26, 22, 0, 0]
                },
                {
                  text: BRAND.organisation,
                  fontSize: 8,
                  color: BRAND.muted,
                  alignment: "right",
                  margin: [0, 22, 26, 0]
                }
              ]
            },
      footer: (currentPage, pageCount) => ({
        columns: [
          {
            text: `${plain(settings.meta?.classification || "Internal")}  ·  Generated ${stamp()}`,
            fontSize: 7,
            color: BRAND.muted,
            margin: [26, 12, 0, 0]
          },
          {
            text: `Page ${currentPage} of ${pageCount}`,
            fontSize: 7,
            color: BRAND.muted,
            alignment: "right",
            margin: [0, 12, 26, 0]
          }
        ]
      }),
      content
    };
  }

  function fileName(base) {
    const safe = String(base || "ppm-report")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "");
    return `${safe || "ppm-report"}-${new Date().toISOString().slice(0, 10)}.pdf`;
  }

  function download(spec, base) {
    if (!ready())
      throw new Error(
        "The PDF engine did not load. Check that pdfmake.min.js and vfs_fonts.js are present in the same folder as this page."
      );
    window.pdfMake.createPdf(build(spec)).download(fileName(base || spec?.title));
  }

  function open(spec) {
    if (!ready())
      throw new Error(
        "The PDF engine did not load. Check that pdfmake.min.js and vfs_fonts.js are present in the same folder as this page."
      );
    window.pdfMake.createPdf(build(spec)).open();
  }

  window.PPMReportPdf = {
    BRAND,
    TONES,
    tone,
    toneFromValue,
    plain,
    readableDate,
    build,
    download,
    open,
    ready
  };
})();
