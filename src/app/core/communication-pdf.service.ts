import { Injectable } from '@angular/core';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export interface CommunicationPdfInput {
  condominiumName: string;
  title: string;
  bodyHtml: string | null | undefined;
  sentAtLabel: string | null;
  attachments?: { originalFilename: string; sizeBytes: number }[];
}

@Injectable({ providedIn: 'root' })
export class CommunicationPdfService {
  async download(input: CommunicationPdfInput): Promise<void> {
    const root = document.createElement('div');
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '794px',
      zIndex: '-1',
      pointerEvents: 'none',
    });
    root.innerHTML = this.buildDocumentHtml(input);
    document.body.appendChild(root);

    const page = root.querySelector('.comm-pdf-page') as HTMLElement | null;
    if (!page) {
      document.body.removeChild(root);
      throw new Error('Não foi possível montar o documento para PDF.');
    }

    try {
      const canvas = await html2canvas(page, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 794,
      });

      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageWidthMm = pdf.internal.pageSize.getWidth();
      const pageHeightMm = pdf.internal.pageSize.getHeight();
      const marginMm = 0;
      const contentWidthMm = pageWidthMm - marginMm * 2;

      const imgWidthPx = canvas.width;
      const imgHeightPx = canvas.height;
      const sliceHeightPx = Math.floor(
        (imgHeightPx * (pageHeightMm - marginMm * 2)) / contentWidthMm,
      );

      let offsetY = 0;
      let pageIndex = 0;

      while (offsetY < imgHeightPx) {
        const slicePx = Math.min(sliceHeightPx, imgHeightPx - offsetY);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = imgWidthPx;
        sliceCanvas.height = slicePx;
        const ctx = sliceCanvas.getContext('2d');
        if (!ctx) {
          throw new Error('Não foi possível gerar o PDF.');
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, imgWidthPx, slicePx);
        ctx.drawImage(
          canvas,
          0,
          offsetY,
          imgWidthPx,
          slicePx,
          0,
          0,
          imgWidthPx,
          slicePx,
        );

        const sliceData = sliceCanvas.toDataURL('image/png');
        const sliceHeightMm =
          (slicePx * contentWidthMm) / imgWidthPx;

        if (pageIndex > 0) {
          pdf.addPage();
        }
        pdf.addImage(
          sliceData,
          'PNG',
          marginMm,
          marginMm,
          contentWidthMm,
          sliceHeightMm,
        );

        offsetY += slicePx;
        pageIndex += 1;
      }

      pdf.save(this.buildFilename(input.title));
    } finally {
      document.body.removeChild(root);
    }
  }

  private buildFilename(title: string): string {
    const base =
      title
        .trim()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 60) || 'comunicado';
    const stamp = new Date().toISOString().slice(0, 10);
    return `comunicado-${base}-${stamp}.pdf`;
  }

  private buildDocumentHtml(input: CommunicationPdfInput): string {
    const condo = this.escapeHtml(input.condominiumName.trim() || 'Condomínio');
    const title = this.escapeHtml(input.title.trim() || 'Informativo');
    const sent = input.sentAtLabel
      ? `<p class="comm-pdf-meta__line"><span class="comm-pdf-meta__label">Enviado em</span> ${this.escapeHtml(input.sentAtLabel)}</p>`
      : '';
    const generated = this.escapeHtml(
      new Date().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );

    const body = (input.bodyHtml ?? '').trim()
      ? input.bodyHtml!.trim()
      : '<p class="comm-pdf-empty">(Sem texto neste comunicado.)</p>';

    const attachments = (input.attachments ?? []).filter(
      (a) => a.originalFilename?.trim(),
    );
    const attBlock =
      attachments.length > 0
        ? `<section class="comm-pdf-attachments">
        <h2 class="comm-pdf-attachments__title">Anexos</h2>
        <ul class="comm-pdf-attachments__list">
          ${attachments
            .map(
              (a) =>
                `<li><span class="comm-pdf-attachments__name">${this.escapeHtml(a.originalFilename)}</span><span class="comm-pdf-attachments__meta">${this.formatSize(a.sizeBytes)}</span></li>`,
            )
            .join('')}
        </ul>
      </section>`
        : '';

    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
<style>${this.documentStyles()}</style></head><body>
<div class="comm-pdf-page">
  <header class="comm-pdf-header">
    <div class="comm-pdf-header__brand">
      <span class="comm-pdf-header__badge">Informativo</span>
      <p class="comm-pdf-header__condo">${condo}</p>
    </div>
    <div class="comm-pdf-header__rule" aria-hidden="true"></div>
  </header>
  <main class="comm-pdf-main">
    <h1 class="comm-pdf-title">${title}</h1>
    <div class="comm-pdf-meta">${sent}</div>
    <article class="comm-pdf-body">${body}</article>
    ${attBlock}
  </main>
  <footer class="comm-pdf-footer">
    <span>Documento gerado em ${generated}</span>
    <span class="comm-pdf-footer__hint">Para impressão — A4</span>
  </footer>
</div>
</body></html>`;
  }

  private formatSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '—';
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
      return `${Math.round(kb)} KB`;
    }
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private documentStyles(): string {
    return `
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        color: #0f172a;
        background: #fff;
      }
      .comm-pdf-page {
        width: 794px;
        min-height: 1123px;
        padding: 48px 52px 56px;
        background: #fff;
        display: flex;
        flex-direction: column;
      }
      .comm-pdf-header {
        margin-bottom: 28px;
      }
      .comm-pdf-header__badge {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #1d4ed8;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        padding: 4px 10px;
        border-radius: 999px;
      }
      .comm-pdf-header__condo {
        margin: 10px 0 0;
        font-size: 13px;
        font-weight: 600;
        color: #64748b;
        letter-spacing: 0.02em;
      }
      .comm-pdf-header__rule {
        height: 3px;
        margin-top: 16px;
        border-radius: 2px;
        background: linear-gradient(90deg, #2563eb 0%, #6366f1 55%, #e2e8f0 100%);
      }
      .comm-pdf-main { flex: 1 1 auto; }
      .comm-pdf-title {
        margin: 0 0 12px;
        font-size: 26px;
        font-weight: 700;
        line-height: 1.25;
        letter-spacing: -0.02em;
        color: #0f172a;
      }
      .comm-pdf-meta {
        margin-bottom: 22px;
        padding: 10px 14px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        font-size: 12px;
        color: #475569;
      }
      .comm-pdf-meta__line { margin: 0; }
      .comm-pdf-meta__label {
        font-weight: 600;
        color: #334155;
      }
      .comm-pdf-body {
        font-size: 14px;
        line-height: 1.6;
        color: #1e293b;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .comm-pdf-body p { margin: 0 0 0.75em; }
      .comm-pdf-body p:last-child { margin-bottom: 0; }
      .comm-pdf-body ul, .comm-pdf-body ol {
        margin: 0.35em 0 0.75em;
        padding-left: 1.35em;
      }
      .comm-pdf-body li { margin: 0.2em 0; }
      .comm-pdf-body h1, .comm-pdf-body h2, .comm-pdf-body h3 {
        margin: 1em 0 0.4em;
        line-height: 1.3;
        color: #0f172a;
      }
      .comm-pdf-body h1 { font-size: 1.35em; }
      .comm-pdf-body h2 { font-size: 1.2em; }
      .comm-pdf-body h3 { font-size: 1.05em; }
      .comm-pdf-body blockquote {
        margin: 0.75em 0;
        padding: 0.5em 0 0.5em 1em;
        border-left: 3px solid #93c5fd;
        color: #475569;
      }
      .comm-pdf-body a { color: #2563eb; text-decoration: underline; }
      .comm-pdf-body img {
        max-width: 100%;
        height: auto;
        border-radius: 4px;
      }
      .comm-pdf-body strong { font-weight: 700; }
      .comm-pdf-empty {
        margin: 0;
        color: #94a3b8;
        font-style: italic;
      }
      .comm-pdf-attachments {
        margin-top: 28px;
        padding-top: 18px;
        border-top: 1px solid #e2e8f0;
      }
      .comm-pdf-attachments__title {
        margin: 0 0 10px;
        font-size: 14px;
        font-weight: 700;
        color: #0f172a;
      }
      .comm-pdf-attachments__list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .comm-pdf-attachments__list li {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid #f1f5f9;
        font-size: 12px;
      }
      .comm-pdf-attachments__name { font-weight: 600; color: #334155; }
      .comm-pdf-attachments__meta { color: #64748b; white-space: nowrap; }
      .comm-pdf-footer {
        margin-top: 32px;
        padding-top: 14px;
        border-top: 1px solid #e2e8f0;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 10px;
        color: #94a3b8;
      }
      .comm-pdf-footer__hint { text-align: right; }
    `;
  }
}
