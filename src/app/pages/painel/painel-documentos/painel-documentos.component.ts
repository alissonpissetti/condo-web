import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  PlanningApiService,
  type CondominiumDocumentRow,
} from '../../../core/planning-api.service';

@Component({
  selector: 'app-painel-documentos',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './painel-documentos.component.html',
  styleUrl: './painel-documentos.component.scss',
})
export class PainelDocumentosComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PlanningApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly docs = signal<CondominiumDocumentRow[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly loading = signal(true);
  protected readonly access = signal<{ kind: string; role?: string } | null>(
    null,
  );

  protected readonly publishForm = this.fb.nonNullable.group({
    documentId: ['', Validators.required],
    syndicUserId: [''],
    adminUserIds: [''],
  });

  private condominiumId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.api.access(id).subscribe({
      next: (a) => this.access.set(a.access as { kind: string; role?: string }),
      error: () => this.access.set(null),
    });
    this.reload();
  }

  protected isSyndicOrOwner(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    return a.kind === 'participant' && a.role === 'syndic';
  }

  reload(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.api.listDocuments(this.condominiumId).subscribe({
      next: (list) => {
        this.docs.set(list);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  download(d: CondominiumDocumentRow): void {
    this.busy.set(true);
    this.api.downloadDocumentBlob(this.condominiumId, d.id).subscribe({
      next: (blob) => {
        this.busy.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${d.title.replace(/\s+/g, '_')}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
  }

  onFinalFileSelected(ev: Event, documentId: string): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.uploadFinalMinutes(this.condominiumId, documentId, file).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
    input.value = '';
  }

  submitPublish(): void {
    if (this.publishForm.invalid) {
      this.publishForm.markAllAsTouched();
      return;
    }
    const v = this.publishForm.getRawValue();
    const admins = v.adminUserIds
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const body: { syndicUserId?: string; adminUserIds?: string[] } = {};
    const sid = v.syndicUserId.trim();
    if (sid) {
      body.syndicUserId = sid;
    }
    if (admins.length) {
      body.adminUserIds = admins;
    }
    this.busy.set(true);
    this.api
      .publishDocument(this.condominiumId, v.documentId, body)
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.reload();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem ligação ao servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
