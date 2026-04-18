import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  CommunicationsApiService,
  type Communication,
  type CommunicationAttachmentRow,
  type CommunicationRecipientRow,
  type DeliveryChannelStatus,
} from '../../../core/communications-api.service';
import { formatDateTimeDdMmYyyyHhMm } from '../../../core/date-display';
import { PlanningApiService } from '../../../core/planning-api.service';
import { PollBodyEditorComponent } from '../poll-body-editor/poll-body-editor.component';

@Component({
  selector: 'app-painel-comunicacao',
  standalone: true,
  imports: [ReactiveFormsModule, PollBodyEditorComponent, NgClass, DecimalPipe],
  templateUrl: './painel-comunicacao.component.html',
  styleUrl: './painel-comunicacao.component.scss',
})
export class PainelComunicacaoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(CommunicationsApiService);
  private readonly planning = inject(PlanningApiService);
  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly items = signal<Communication[]>([]);
  protected readonly selected = signal<Communication | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly access = signal<{ kind: string; role?: string } | null>(
    null,
  );
  protected readonly readConfirmedBanner = signal(false);

  protected readonly draftForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
    body: [''],
  });

  private condominiumId = '';

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => {
        if (q.get('leitura') === '1') {
          this.readConfirmedBanner.set(true);
        }
      });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.planning.access(id).subscribe({
      next: (a) =>
        this.access.set(a.access as { kind: string; role?: string }),
      error: () => this.access.set(null),
    });

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((pm: ParamMap) => {
        const commId = pm.get('communicationId');
        if (commId) {
          this.reloadList({ silent: true });
          this.openDetail(commId);
        } else {
          this.selected.set(null);
          this.reloadList();
        }
      });
  }

  protected isMgmt(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    if (a.kind !== 'participant') return false;
    return (
      a.role === 'syndic' || a.role === 'sub_syndic' || a.role === 'admin'
    );
  }

  protected dismissReadBanner(): void {
    this.readConfirmedBanner.set(false);
  }

  protected reloadList(opts?: { silent?: boolean }): void {
    if (!opts?.silent) {
      this.loadError.set(null);
      this.loading.set(true);
    }
    this.api.list(this.condominiumId).subscribe({
      next: (list) => {
        this.items.set(list);
        if (!opts?.silent) {
          this.loading.set(false);
        }
      },
      error: (err: HttpErrorResponse) => {
        if (!opts?.silent) {
          this.loading.set(false);
        }
        this.loadError.set(this.msg(err));
      },
    });
  }

  protected navigateToDetail(id: string): void {
    void this.router.navigate([
      '/painel/condominio',
      this.condominiumId,
      'comunicacao',
      id,
    ]);
  }

  private openDetail(id: string): void {
    this.actionError.set(null);
    this.busy.set(true);
    this.api.getOne(this.condominiumId, id).subscribe({
      next: (c) => {
        this.busy.set(false);
        this.selected.set(c);
        if (this.isMgmt() && c.status === 'draft') {
          this.draftForm.patchValue({
            title: c.title,
            body: c.body ?? '',
          });
        } else {
          this.draftForm.reset({ title: '', body: '' });
        }
        if (c.status === 'sent' && !this.isMgmt()) {
          this.api.markRead(this.condominiumId, id).subscribe({
            error: () => {},
          });
        }
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
        this.selected.set(null);
      },
    });
  }

  protected closeDetail(): void {
    void this.router.navigate([
      '/painel/condominio',
      this.condominiumId,
      'comunicacao',
    ]);
  }

  protected createDraft(): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .create(this.condominiumId, { title: 'Novo informativo' })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.reloadList();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected saveDraft(): void {
    const c = this.selected();
    if (!c || c.status !== 'draft' || this.draftForm.invalid) {
      this.draftForm.markAllAsTouched();
      return;
    }
    const v = this.draftForm.getRawValue();
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .update(this.condominiumId, c.id, {
        title: v.title.trim(),
        body: v.body,
      })
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.selected.set(updated);
          this.reloadList();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected sendSelected(): void {
    const c = this.selected();
    if (!c || c.status !== 'draft') return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.send(this.condominiumId, c.id).subscribe({
      next: (sent) => {
        this.busy.set(false);
        this.selected.set(sent);
        this.reloadList();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
  }

  protected onAttachmentSelected(ev: Event): void {
    const c = this.selected();
    if (!c || c.status !== 'draft') return;
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.uploadAttachment(this.condominiumId, c.id, file).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.selected.set(updated);
        this.reloadList();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
    input.value = '';
  }

  protected removeAttachment(att: CommunicationAttachmentRow): void {
    const c = this.selected();
    if (!c || c.status !== 'draft') return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .deleteAttachment(this.condominiumId, c.id, att.id)
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.selected.set(updated);
          this.reloadList();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected downloadAttachment(att: CommunicationAttachmentRow): void {
    this.busy.set(true);
    this.api
      .downloadAttachmentBlob(this.condominiumId, this.selected()!.id, att.id)
      .subscribe({
        next: (blob) => {
          this.busy.set(false);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = att.originalFilename || 'anexo';
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected safeHtml(html: string | null | undefined): SafeHtml {
    const h = html?.trim() ?? '';
    if (!h) {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }
    return this.sanitizer.bypassSecurityTrustHtml(h);
  }

  protected channelLabel(st: DeliveryChannelStatus): string {
    switch (st) {
      case 'pending':
        return 'pendente';
      case 'sent':
        return 'enviado';
      case 'failed':
        return 'falhou';
      case 'skipped':
        return '—';
      default:
        return st;
    }
  }

  protected recipientRead(r: CommunicationRecipientRow): string {
    if (r.readAt) {
      return `Lido (${formatDateTimeDdMmYyyyHhMm(r.readAt)})`;
    }
    return 'Ainda não lido';
  }

  protected fmtSentAt(iso: string | null | undefined): string {
    return formatDateTimeDdMmYyyyHhMm(iso);
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
