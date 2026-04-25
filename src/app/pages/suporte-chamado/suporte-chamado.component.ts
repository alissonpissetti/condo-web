import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';
import { AuthService } from '../../core/auth.service';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';
import {
  SupportTicketsApiService,
  type SupportTicketAttachmentMeta,
  type SupportTicketCategory,
  type SupportTicketMessageRow,
  type SupportTicketStatus,
  type SupportTicketTarget,
} from '../../core/support-tickets-api.service';
import {
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES,
  supportFormatFileSize,
} from '../../core/support-upload-limits';

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Erro / comportamento inesperado',
  correction: 'Correção de dados ou texto',
  improvement: 'Melhoria em algo existente',
  feature: 'Nova funcionalidade',
  other: 'Outro',
  condo_complaint: 'Reclamação',
  condo_request: 'Solicitação',
  condo_order: 'Pedido',
  condo_information: 'Informação',
  condo_agenda_suggestion: 'Sugestão de pauta condominial',
  condo_other: 'Outros',
};

function statusLabelPt(s: SupportTicketStatus): string {
  switch (s) {
    case 'open':
      return 'Aberto';
    case 'triaged':
      return 'Triado';
    case 'in_progress':
      return 'Em andamento';
    case 'resolved':
      return 'Resolvido';
    case 'closed':
      return 'Encerrado';
    default:
      return s;
  }
}

export type ChamadoTicketView = {
  id: string;
  title: string;
  body: string;
  status: SupportTicketStatus;
  target: SupportTicketTarget;
  category: SupportTicketCategory;
  createdAt: string;
  condominiumName: string | null;
  updatedAt?: string;
};

@Component({
  selector: 'app-suporte-chamado',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './suporte-chamado.component.html',
  styleUrl: './suporte-chamado.component.scss',
})
export class SuporteChamadoComponent implements OnInit {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;
  protected readonly categoryLabel = (c: SupportTicketCategory) =>
    CATEGORY_LABELS[c] ?? c;
  protected readonly statusLabelPt = statusLabelPt;
  protected readonly formatBytes = supportFormatFileSize;
  protected readonly maxAttachments = SUPPORT_MAX_FILES;
  protected readonly maxFileBytes = SUPPORT_MAX_FILE_BYTES;

  protected targetLabel(target: SupportTicketTarget): string {
    if (target === 'condominium') {
      return 'Solicitação ao meu condomínio';
    }
    return 'Solicitação à plataforma Meu Condomínio';
  }

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(SupportTicketsApiService);
  protected readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly ticket = signal<ChamadoTicketView | null>(null);
  protected readonly messages = signal<SupportTicketMessageRow[]>([]);
  protected readonly painelContext = signal(false);
  /** Token `vt` do link por e-mail (download público de anexos). */
  protected readonly publicViewToken = signal<string | null>(null);

  protected readonly replyError = signal<string | null>(null);
  /** Erros ao baixar anexos no histórico (evita misturar com o formulário de resposta). */
  protected readonly threadError = signal<string | null>(null);
  protected readonly replyBusy = signal(false);
  protected readonly replySuccess = signal<string | null>(null);
  protected readonly pendingFiles = signal<File[]>([]);
  protected readonly downloadBusyKey = signal<string | null>(null);

  protected readonly replyForm = this.fb.nonNullable.group({
    body: ['', [Validators.maxLength(20000)]],
  });

  ngOnInit(): void {
    combineLatest([
      this.route.paramMap.pipe(map((p) => p.get('ticketId'))),
      this.route.queryParamMap.pipe(map((q) => q.get('vt'))),
    ]).subscribe(([ticketId, vt]) => {
      if (!ticketId) {
        this.loadError.set('Chamado inválido.');
        this.loading.set(false);
        return;
      }
      const path = this.router.url.split('?')[0] ?? '';
      this.painelContext.set(path.startsWith('/painel/'));
      this.load(ticketId, vt?.trim() ?? null);
    });
  }

  private load(ticketId: string, vt: string | null): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.replySuccess.set(null);
    this.threadError.set(null);
    this.publicViewToken.set(vt);
    const painel = this.painelContext();
    if (painel && this.auth.isAuthenticated()) {
      this.api.getConversation(ticketId).subscribe({
        next: (res) => {
          this.ticket.set({
            id: res.ticket.id,
            title: res.ticket.title,
            body: res.ticket.body,
            status: res.ticket.status,
            target: res.ticket.target ?? 'platform',
            category: res.ticket.category,
            createdAt: res.ticket.createdAt,
            condominiumName: res.ticket.condominiumName,
            updatedAt: res.ticket.updatedAt,
          });
          this.messages.set(this.normalizeMessages(res.messages));
          this.loading.set(false);
        },
        error: (err: unknown) => this.failLoad(err),
      });
      return;
    }
    if (vt) {
      this.api.getPublicConversation(ticketId, vt).subscribe({
        next: (res) => {
          this.ticket.set({
            id: res.ticket.id,
            title: res.ticket.title,
            body: res.ticket.body,
            status: res.ticket.status,
            target: res.ticket.target ?? 'platform',
            category: res.ticket.category,
            createdAt: res.ticket.createdAt,
            condominiumName: res.ticket.condominiumName,
          });
          this.messages.set(this.normalizeMessages(res.messages));
          this.loading.set(false);
        },
        error: (err: unknown) => this.failLoad(err),
      });
      return;
    }
    this.loading.set(false);
    this.publicViewToken.set(null);
    this.loadError.set(
      painel
        ? 'Faça login para ver este chamado.'
        : 'Use o link completo enviado por e-mail (inclui o parâmetro de segurança no endereço).',
    );
  }

  private normalizeMessages(
    list: SupportTicketMessageRow[],
  ): SupportTicketMessageRow[] {
    return list.map((m) => ({
      ...m,
      attachments: m.attachments?.length ? m.attachments : [],
    }));
  }

  private failLoad(err: unknown): void {
    this.loading.set(false);
    this.loadError.set(
      err instanceof HttpErrorResponse
        ? translateHttpErrorMessage(err, {
            network:
              'Sem conexão com o servidor. Verifique a internet e tente novamente.',
            default: 'Não foi possível carregar o chamado.',
          })
        : 'Não foi possível carregar o chamado.',
    );
  }

  protected canReply(): boolean {
    return this.painelContext() && this.auth.isAuthenticated();
  }

  protected goLogin(): void {
    void this.router.navigate(['/auth', 'login'], {
      queryParams: { returnUrl: this.router.url },
    });
  }

  protected onFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  protected onDropFiles(ev: DragEvent): void {
    ev.preventDefault();
    const dt = ev.dataTransfer;
    if (!dt?.files?.length) {
      return;
    }
    this.addFiles(Array.from(dt.files));
  }

  protected onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'copy';
    }
  }

  protected addFiles(files: File[]): void {
    this.replyError.set(null);
    const next = [...this.pendingFiles()];
    for (const f of files) {
      if (next.length >= SUPPORT_MAX_FILES) {
        this.replyError.set(
          `No máximo ${SUPPORT_MAX_FILES} arquivos por mensagem.`,
        );
        break;
      }
      if (f.size > SUPPORT_MAX_FILE_BYTES) {
        this.replyError.set(
          `Cada arquivo deve ter no máximo ${supportFormatFileSize(SUPPORT_MAX_FILE_BYTES)} (${f.name}).`,
        );
        continue;
      }
      next.push(f);
    }
    this.pendingFiles.set(next);
  }

  protected removePendingFile(index: number): void {
    const next = [...this.pendingFiles()];
    next.splice(index, 1);
    this.pendingFiles.set(next);
  }

  protected clearPendingFiles(): void {
    this.pendingFiles.set([]);
  }

  protected mimeKind(mime: string): 'image' | 'video' | 'audio' | 'pdf' | 'file' {
    if (mime.startsWith('image/')) {
      return 'image';
    }
    if (mime.startsWith('video/')) {
      return 'video';
    }
    if (mime.startsWith('audio/')) {
      return 'audio';
    }
    if (mime.includes('pdf')) {
      return 'pdf';
    }
    return 'file';
  }

  protected downloadMeta(meta: SupportTicketAttachmentMeta): void {
    const id = this.route.snapshot.paramMap.get('ticketId');
    if (!id) {
      return;
    }
    const vt = this.publicViewToken();
    this.downloadBusyKey.set(meta.storageKey);
    this.threadError.set(null);
    const obs =
      vt != null && vt.length > 0
        ? this.api.downloadPublicAttachment(id, vt, meta.storageKey)
        : this.auth.isAuthenticated()
          ? this.api.downloadAttachment(id, meta.storageKey)
          : null;
    if (!obs) {
      this.downloadBusyKey.set(null);
      this.threadError.set(
        'Não é possível baixar este arquivo com o acesso atual.',
      );
      return;
    }
    obs.subscribe({
      next: (blob) => {
        this.triggerBlobDownload(blob, meta.originalFilename);
        this.downloadBusyKey.set(null);
      },
      error: (err: unknown) => {
        this.downloadBusyKey.set(null);
        this.threadError.set(
          err instanceof HttpErrorResponse
            ? translateHttpErrorMessage(err, {
                network:
                  'Sem conexão com o servidor. Verifique a internet e tente novamente.',
                default: 'Não foi possível baixar o arquivo.',
              })
            : 'Não foi possível baixar o arquivo.',
        );
      },
    });
  }

  private triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.click();
    URL.revokeObjectURL(url);
  }

  protected submitReply(): void {
    const id = this.route.snapshot.paramMap.get('ticketId');
    if (!id || !this.canReply()) {
      return;
    }
    this.replyError.set(null);
    this.replySuccess.set(null);
    const text = this.replyForm.controls.body.value.trim();
    const files = this.pendingFiles();
    if (!text.length && files.length === 0) {
      this.replyForm.controls.body.markAsTouched();
      this.replyError.set('Escreva uma mensagem ou anexe pelo menos um arquivo.');
      return;
    }
    if (this.replyForm.controls.body.invalid) {
      this.replyForm.markAllAsTouched();
      return;
    }
    this.replyBusy.set(true);
    this.api.postMessage(id, text, files).subscribe({
      next: (res) => {
        this.ticket.set({
          id: res.ticket.id,
          title: res.ticket.title,
          body: res.ticket.body,
          status: res.ticket.status,
          target: res.ticket.target ?? 'platform',
          category: res.ticket.category,
          createdAt: res.ticket.createdAt,
          condominiumName: res.ticket.condominiumName,
          updatedAt: res.ticket.updatedAt,
        });
        this.messages.set(this.normalizeMessages(res.messages));
        this.replyForm.reset({ body: '' });
        this.pendingFiles.set([]);
        this.replyBusy.set(false);
        this.replySuccess.set('Sua mensagem foi enviada.');
      },
      error: (err: unknown) => {
        this.replyBusy.set(false);
        this.replyError.set(
          err instanceof HttpErrorResponse
            ? translateHttpErrorMessage(err, {
                network:
                  'Sem conexão com o servidor. Verifique a internet e tente novamente.',
                default: 'Não foi possível enviar a mensagem.',
              })
            : 'Não foi possível enviar.',
        );
      },
    });
  }
}
