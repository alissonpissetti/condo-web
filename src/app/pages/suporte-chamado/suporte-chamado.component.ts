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
  type SupportTicketCategory,
  type SupportTicketMessageRow,
  type SupportTicketStatus,
} from '../../core/support-tickets-api.service';

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Erro / comportamento inesperado',
  correction: 'Correção de dados ou texto',
  improvement: 'Melhoria em algo existente',
  feature: 'Nova funcionalidade',
  other: 'Outro',
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

  protected readonly replyError = signal<string | null>(null);
  protected readonly replyBusy = signal(false);
  protected readonly replySuccess = signal<string | null>(null);

  protected readonly replyForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(20000)]],
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
    const painel = this.painelContext();
    if (painel && this.auth.isAuthenticated()) {
      this.api.getConversation(ticketId).subscribe({
        next: (res) => {
          this.ticket.set({
            id: res.ticket.id,
            title: res.ticket.title,
            body: res.ticket.body,
            status: res.ticket.status,
            category: res.ticket.category,
            createdAt: res.ticket.createdAt,
            condominiumName: res.ticket.condominiumName,
            updatedAt: res.ticket.updatedAt,
          });
          this.messages.set(res.messages);
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
            category: res.ticket.category,
            createdAt: res.ticket.createdAt,
            condominiumName: res.ticket.condominiumName,
          });
          this.messages.set(res.messages);
          this.loading.set(false);
        },
        error: (err: unknown) => this.failLoad(err),
      });
      return;
    }
    this.loading.set(false);
    this.loadError.set(
      painel
        ? 'Inicie sessão para ver este chamado.'
        : 'Use o link completo enviado por e-mail (inclui o parâmetro de segurança no endereço).',
    );
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

  protected submitReply(): void {
    const id = this.route.snapshot.paramMap.get('ticketId');
    if (!id || !this.canReply()) {
      return;
    }
    this.replyError.set(null);
    this.replySuccess.set(null);
    if (this.replyForm.invalid) {
      this.replyForm.markAllAsTouched();
      return;
    }
    this.replyBusy.set(true);
    this.api.postMessage(id, { body: this.replyForm.controls.body.value.trim() }).subscribe({
      next: (res) => {
        this.ticket.set({
          id: res.ticket.id,
          title: res.ticket.title,
          body: res.ticket.body,
          status: res.ticket.status,
          category: res.ticket.category,
          createdAt: res.ticket.createdAt,
          condominiumName: res.ticket.condominiumName,
          updatedAt: res.ticket.updatedAt,
        });
        this.messages.set(res.messages);
        this.replyForm.reset({ body: '' });
        this.replyBusy.set(false);
        this.replySuccess.set('A sua mensagem foi enviada.');
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
