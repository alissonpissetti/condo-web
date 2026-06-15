import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { FlashMessageService } from '../../../core/flash-message.service';
import { condoAccessAllowsManagement } from '../../../core/condo-access.util';
import {
  CondominiumLibraryApiService,
  type CondominiumLibraryDocumentRow,
  type CondominiumLibraryDownloadLogRow,
} from '../../../core/condominium-library-api.service';
import {
  PlanningApiService,
  type CondoAccess,
} from '../../../core/planning-api.service';

@Component({
  selector: 'app-painel-biblioteca-documentos',
  standalone: true,
  templateUrl: './painel-biblioteca-documentos.component.html',
  styleUrl: './painel-biblioteca-documentos.component.scss',
})
export class PainelBibliotecaDocumentosComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly api = inject(CondominiumLibraryApiService);
  private readonly planningApi = inject(PlanningApiService);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly docs = signal<CondominiumLibraryDocumentRow[]>([]);
  protected readonly access = signal<CondoAccess | null>(null);
  protected readonly removingId = signal<string | null>(null);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly renameDraft = signal('');
  protected readonly renamingBusy = signal(false);
  protected readonly copiedShareId = signal<string | null>(null);
  protected readonly shareBusyId = signal<string | null>(null);
  protected readonly uploadDisplayName = signal('');
  protected readonly downloadLog = signal<CondominiumLibraryDownloadLogRow[]>([]);
  protected readonly downloadLogLoading = signal(false);
  protected readonly downloadLogError = signal<string | null>(null);

  private condominiumId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      (() => { this.loadError.set('Condomínio inválido.'); this.flash.error('Condomínio inválido.'); })();
      return;
    }
    this.condominiumId = id;
    this.reload();
  }

  /** Enviar / remover: titular, síndico, subsíndico ou administrador. */
  protected canManageUpload(): boolean {
    const a = this.access();
    return a !== null && condoAccessAllowsManagement(a);
  }

  /** Histórico de downloads: só titular do condomínio ou síndico. */
  protected canViewDownloadAudit(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    return a.kind === 'participant' && a.role === 'syndic';
  }

  protected canDelete(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    return a.kind === 'participant' && a.role === 'syndic';
  }

  /** Renomear: titular ou síndico. */
  protected canRename(): boolean {
    return this.canDelete();
  }

  protected formatDateTime(value: string): string {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  }

  protected setUploadDisplayName(v: string): void {
    this.uploadDisplayName.set(v);
  }

  protected onFileSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set(true);
    this.api
      .upload(this.condominiumId, file, this.uploadDisplayName())
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.uploadDisplayName.set('');
          input.value = '';
          this.flash.success('Documento enviado.');
          this.reloadListAndAudit();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected startRename(doc: CondominiumLibraryDocumentRow): void {
    if (!this.canRename()) return;
    this.renamingId.set(doc.id);
    this.renameDraft.set(doc.originalFilename);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
    this.renameDraft.set('');
  }

  protected setRenameDraft(v: string): void {
    this.renameDraft.set(v);
  }

  protected saveRename(doc: CondominiumLibraryDocumentRow): void {
    if (!this.canRename() || this.renamingId() !== doc.id) return;
    const name = this.renameDraft().trim();
    if (!name) {
      this.flash.warning('Informe o nome do documento.');
      return;
    }
    if (name === doc.originalFilename.trim()) {
      this.cancelRename();
      return;
    }
    this.renamingBusy.set(true);
    this.api.rename(this.condominiumId, doc.id, name).subscribe({
      next: (updated) => {
        this.renamingBusy.set(false);
        this.cancelRename();
        this.docs.update((list) =>
          list.map((row) => (row.id === updated.id ? updated : row)),
        );
        this.flash.success('Nome atualizado.');
      },
      error: (err: HttpErrorResponse) => {
        this.renamingBusy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível renomear o documento.');
      },
    });
  }

  protected onRenameKeydown(ev: KeyboardEvent, doc: CondominiumLibraryDocumentRow): void {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      this.saveRename(doc);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.cancelRename();
    }
  }

  protected copyShareLink(doc: CondominiumLibraryDocumentRow): void {
    const cached = doc.fileUrl?.trim();
    if (cached) {
      void this.writeShareToClipboard(doc.id, cached);
      return;
    }
    this.shareBusyId.set(doc.id);
    this.api.resolveShareUrl(this.condominiumId, doc.id).subscribe({
      next: ({ fileUrl }) => {
        this.shareBusyId.set(null);
        const url = fileUrl?.trim();
        if (!url) {
          this.flash.warning(
            'Link de compartilhamento indisponível. Verifique o armazenamento (Nextcloud) na API.',
          );
          return;
        }
        this.docs.update((list) =>
          list.map((row) => (row.id === doc.id ? { ...row, fileUrl: url } : row)),
        );
        void this.writeShareToClipboard(doc.id, url);
      },
      error: (err: HttpErrorResponse) => {
        this.shareBusyId.set(null);
        this.flash.errorFromHttp(err, 'Não foi possível obter o link de compartilhamento.');
      },
    });
  }

  protected download(doc: CondominiumLibraryDocumentRow): void {
    this.busy.set(true);
    this.api.downloadBlob(this.condominiumId, doc.id).subscribe({
      next: (blob) => {
        this.busy.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.originalFilename || 'documento';
        a.click();
        URL.revokeObjectURL(url);
        if (this.canViewDownloadAudit()) {
          this.refreshDownloadLog();
        }
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  protected remove(doc: CondominiumLibraryDocumentRow): void {
    if (!this.canDelete()) return;
    const ok = confirm(`Remover o documento “${doc.originalFilename}”?`);
    if (!ok) return;
    this.removingId.set(doc.id);
    this.api.remove(this.condominiumId, doc.id).subscribe({
      next: () => {
        this.removingId.set(null);
        this.flash.success('Documento removido.');
        this.reloadListAndAudit();
      },
      error: (err: HttpErrorResponse) => {
        this.removingId.set(null);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  private reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.downloadLogError.set(null);
    forkJoin({
      access: this.planningApi.access(this.condominiumId),
      docs: this.api.list(this.condominiumId),
    }).subscribe({
      next: ({ access, docs }) => {
        this.access.set(access.access);
        this.docs.set(docs);
        this.loading.set(false);
        this.loadDownloadLogIfAllowed();
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
  }

  private loadDownloadLogIfAllowed(): void {
    if (!this.canViewDownloadAudit()) {
      this.downloadLog.set([]);
      this.downloadLogLoading.set(false);
      return;
    }
    this.refreshDownloadLog();
  }

  private refreshDownloadLog(): void {
    this.downloadLogLoading.set(true);
    this.downloadLogError.set(null);
    this.api.listDownloadLog(this.condominiumId).subscribe({
      next: (rows) => {
        this.downloadLog.set(rows);
        this.downloadLogLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.downloadLogLoading.set(false);
        this.downloadLogError.set(this.msg(err));
      },
    });
  }

  private reloadListAndAudit(): void {
    this.api.list(this.condominiumId).subscribe({
      next: (docs) => this.docs.set(docs),
      error: () => {
        /* mantém estado atual */
      },
    });
    if (this.canViewDownloadAudit()) {
      this.refreshDownloadLog();
    }
  }

  private async writeShareToClipboard(
    documentId: string,
    url: string,
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copiedShareId.set(documentId);
      this.flash.success('Link copiado.');
      window.setTimeout(() => {
        if (this.copiedShareId() === documentId) {
          this.copiedShareId.set(null);
        }
      }, 2000);
    } catch {
      this.flash.warning('Não foi possível copiar o link.');
    }
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
