import { DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { catchError, EMPTY, finalize, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';

export interface PublicCommunicationView {
  condominiumName: string;
  title: string;
  bodyHtml: string | null;
  sentAt: string | null;
  attachments: {
    id: string;
    originalFilename: string;
    sizeBytes: number;
    fileUrl: string | null;
  }[];
}

@Component({
  selector: 'app-comunicado-publico',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './comunicado-publico.component.html',
  styleUrl: './comunicado-publico.component.scss',
})
export class ComunicadoPublicoComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly data = signal<PublicCommunicationView | null>(null);

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token')?.trim();
    if (!token) {
      this.loading.set(false);
      this.error.set('Link inválido: falta o token.');
      return;
    }
    const url = `${environment.apiUrl}/public/communications/view`;
    this.http
      .get<PublicCommunicationView>(url, { params: { token } })
      .pipe(
        timeout(25_000),
        catchError((err: unknown) => {
          const isTimeout = err instanceof Error && err.name === 'TimeoutError';
          if (isTimeout) {
            this.error.set(
              'O servidor demorou demais a responder. Verifique se a condo-api está a correr e se environment.apiUrl aponta para o URL certo (ex.: http://localhost:3000).',
            );
          } else if (err instanceof HttpErrorResponse) {
            this.error.set(
              translateHttpErrorMessage(err, {
                network:
                  'Sem ligação à API (rede ou bloqueio do navegador). Confirme que a API responde no URL em environment.apiUrl.',
                default: `Não foi possível abrir o comunicado (código ${err.status}).`,
              }),
            );
          } else {
            this.error.set(
              'Não foi possível abrir o comunicado. Verifique se o link está correto.',
            );
          }
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (res) => {
          this.data.set(res);
        },
      });
  }

  protected bodyHtml(): SafeHtml {
    const b = this.data()?.bodyHtml?.trim();
    if (!b) {
      return this.sanitizer.bypassSecurityTrustHtml(
        '<p class="muted">(Sem texto neste comunicado.)</p>',
      );
    }
    return this.sanitizer.bypassSecurityTrustHtml(b);
  }

  protected fmtSent(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    try {
      return new Date(iso).toLocaleString('pt-BR');
    } catch {
      return iso;
    }
  }
}
