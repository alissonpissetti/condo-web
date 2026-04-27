import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  CondominiumLibraryApiService,
  type CondominiumLibraryDocumentRow,
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
  private readonly api = inject(CondominiumLibraryApiService);
  private readonly planningApi = inject(PlanningApiService);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly docs = signal<CondominiumLibraryDocumentRow[]>([]);
  protected readonly access = signal<CondoAccess | null>(null);
  protected readonly removingId = signal<string | null>(null);
  protected readonly uploadDisplayName = signal('');

  private condominiumId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.reload();
  }

  protected canDelete(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    return a.kind === 'participant' && a.role === 'syndic';
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
    this.actionError.set(null);
    this.busy.set(true);
    this.api
      .upload(this.condominiumId, file, this.uploadDisplayName())
      .subscribe({
      next: () => {
        this.busy.set(false);
        this.uploadDisplayName.set('');
        input.value = '';
        this.reloadList();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
      });
  }

  protected download(doc: CondominiumLibraryDocumentRow): void {
    this.actionError.set(null);
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
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
  }

  protected remove(doc: CondominiumLibraryDocumentRow): void {
    if (!this.canDelete()) return;
    const ok = confirm(`Remover o documento “${doc.originalFilename}”?`);
    if (!ok) return;
    this.actionError.set(null);
    this.removingId.set(doc.id);
    this.api.remove(this.condominiumId, doc.id).subscribe({
      next: () => {
        this.removingId.set(null);
        this.reloadList();
      },
      error: (err: HttpErrorResponse) => {
        this.removingId.set(null);
        this.actionError.set(this.msg(err));
      },
    });
  }

  private reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      access: this.planningApi.access(this.condominiumId),
      docs: this.api.list(this.condominiumId),
    }).subscribe({
      next: ({ access, docs }) => {
        this.access.set(access.access);
        this.docs.set(docs);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  private reloadList(): void {
    this.api.list(this.condominiumId).subscribe({
      next: (docs) => this.docs.set(docs),
      error: () => {
        /* mantém estado atual */
      },
    });
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
