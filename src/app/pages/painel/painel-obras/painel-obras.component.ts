import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { CondominiumAccessStore } from '../../../core/condominium-access.store';
import { CondominiumManagementService } from '../../../core/condominium-management.service';
import { CondominiumPlanFeaturesStore } from '../../../core/condominium-plan-features.store';
import { FinancialApiService } from '../../../core/financial-api.service';
import {
  SuppliersApiService,
  type Supplier,
} from '../../../core/suppliers-api.service';
import {
  WorksApiService,
  type ConstructionProject,
  type ConstructionProjectStatus,
  type ConstructionProjectUpdate,
} from '../../../core/works-api.service';
import { formatDateDdMmYyyy } from '../../../core/date-display';
import { forkJoin, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

const STATUS_OPTIONS: { value: ConstructionProjectStatus; label: string }[] = [
  { value: 'planned', label: 'Planejada' },
  { value: 'in_progress', label: 'Em execução' },
  { value: 'on_hold', label: 'Parada / em pausa' },
  { value: 'completed', label: 'Concluída' },
  { value: 'cancelled', label: 'Cancelada' },
];

@Component({
  selector: 'app-painel-obras',
  imports: [ReactiveFormsModule],
  templateUrl: './painel-obras.component.html',
  styleUrl: './painel-obras.component.scss',
})
export class PainelObrasComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(WorksApiService);
  private readonly condoMgmt = inject(CondominiumManagementService);
  protected readonly condoAccess = inject(CondominiumAccessStore);
  protected readonly planFeatures = inject(CondominiumPlanFeaturesStore);
  private readonly financialApi = inject(FinancialApiService);
  private readonly suppliersApi = inject(SuppliersApiService);

  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;
  protected readonly statusOptions = STATUS_OPTIONS;

  protected readonly projects = signal<ConstructionProject[]>([]);
  protected readonly detail = signal<ConstructionProject | null>(null);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly editingProject = signal(false);
  protected readonly editingUpdateId = signal<string | null>(null);
  protected readonly condoName = signal<string | null>(null);

  private readonly updateFileInput =
    viewChild<ElementRef<HTMLInputElement>>('updateFileInput');

  private condoId = '';

  protected readonly projectForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(500)]],
    description: [''],
    status: this.fb.nonNullable.control<ConstructionProjectStatus>('planned'),
    startedOn: [''],
    expectedEndOn: [''],
    completedOn: [''],
    supplierId: [''],
  });

  protected readonly updateForm = this.fb.nonNullable.group({
    occurredOn: ['', Validators.required],
    body: ['', [Validators.required, Validators.minLength(1)]],
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condoId = id;
    this.planFeatures.ensureLoaded(this.condoId);
    this.condoMgmt.getCondominium(id).subscribe({
      next: (c) => this.condoName.set(c.name),
      error: () => this.condoName.set(null),
    });
    this.loadSuppliersIfAllowed();
    this.reloadProjects();
  }

  protected statusLabel(s: ConstructionProjectStatus): string {
    return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
  }

  private loadSuppliersIfAllowed(): void {
    if (this.planFeatures.isBlocked('suppliers')) {
      this.suppliers.set([]);
      return;
    }
    this.suppliersApi.listSuppliers(this.condoId).subscribe({
      next: (rows) => this.suppliers.set(rows),
      error: () => this.suppliers.set([]),
    });
  }

  protected reloadProjects(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.api.listProjects(this.condoId).subscribe({
      next: (rows) => {
        this.projects.set(rows);
        this.loading.set(false);
        const sel = this.selectedId();
        if (sel && !rows.some((r) => r.id === sel)) {
          this.clearSelection();
        } else if (sel) {
          this.refreshDetail();
        }
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  protected selectProject(p: ConstructionProject): void {
    this.formError.set(null);
    this.editingProject.set(false);
    this.editingUpdateId.set(null);
    this.selectedId.set(p.id);
    this.refreshDetail();
  }

  protected clearSelection(): void {
    this.selectedId.set(null);
    this.detail.set(null);
    this.editingProject.set(false);
    this.editingUpdateId.set(null);
    this.resetProjectFormForCreate();
  }

  private refreshDetail(): void {
    const id = this.selectedId();
    if (!id) {
      this.detail.set(null);
      return;
    }
    this.api.getProject(this.condoId, id).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.patchProjectFormFromDetail(d);
        this.resetUpdateForm();
      },
      error: (err: HttpErrorResponse) => {
        this.formError.set(this.msg(err));
      },
    });
  }

  protected startNewProject(): void {
    if (!this.condoAccess.canManage()) {
      return;
    }
    this.formError.set(null);
    this.selectedId.set(null);
    this.detail.set(null);
    this.editingProject.set(true);
    this.editingUpdateId.set(null);
    this.projectForm.reset({
      title: '',
      description: '',
      status: 'planned',
      startedOn: '',
      expectedEndOn: '',
      completedOn: '',
      supplierId: '',
    });
  }

  protected startEditProject(): void {
    const d = this.detail();
    if (!d || !this.condoAccess.canManage()) {
      return;
    }
    this.editingProject.set(true);
    this.patchProjectFormFromDetail(d);
  }

  protected cancelProjectEdit(): void {
    const d = this.detail();
    if (d) {
      this.patchProjectFormFromDetail(d);
    } else {
      this.resetProjectFormForCreate();
    }
    this.editingProject.set(false);
  }

  private resetProjectFormForCreate(): void {
    this.projectForm.reset({
      title: '',
      description: '',
      status: 'planned',
      startedOn: '',
      expectedEndOn: '',
      completedOn: '',
      supplierId: '',
    });
  }

  private patchProjectFormFromDetail(d: ConstructionProject): void {
    this.projectForm.patchValue({
      title: d.title,
      description: d.description ?? '',
      status: d.status,
      startedOn: d.startedOn?.slice(0, 10) ?? '',
      expectedEndOn: d.expectedEndOn?.slice(0, 10) ?? '',
      completedOn: d.completedOn?.slice(0, 10) ?? '',
      supplierId: d.supplierId ?? d.supplier?.id ?? '',
    });
  }

  protected saveProject(): void {
    if (!this.condoAccess.canManage()) {
      return;
    }
    this.formError.set(null);
    if (this.projectForm.invalid) {
      this.formError.set('Preencha os campos obrigatórios.');
      return;
    }
    const v = this.projectForm.getRawValue();
    const body = {
      title: v.title.trim(),
      description: v.description.trim() || null,
      status: v.status,
      startedOn: v.startedOn.trim() ? v.startedOn.trim().slice(0, 10) : null,
      expectedEndOn: v.expectedEndOn.trim()
        ? v.expectedEndOn.trim().slice(0, 10)
        : null,
      completedOn: v.completedOn.trim()
        ? v.completedOn.trim().slice(0, 10)
        : null,
      supplierId: v.supplierId.trim() || null,
    };
    this.saving.set(true);
    const id = this.selectedId();
    const req =
      id && this.detail()
        ? this.api.updateProject(this.condoId, id, body)
        : this.api.createProject(this.condoId, body);
    req.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.editingProject.set(false);
        this.selectedId.set(saved.id);
        this.detail.set(saved);
        this.reloadProjects();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.formError.set(this.msg(err));
      },
    });
  }

  protected deleteProject(): void {
    const id = this.selectedId();
    if (!id || !this.condoAccess.canManage()) {
      return;
    }
    if (!confirm('Excluir esta obra e todo o histórico de atualizações?')) {
      return;
    }
    this.saving.set(true);
    this.api.deleteProject(this.condoId, id).subscribe({
      next: () => {
        this.saving.set(false);
        this.clearSelection();
        this.reloadProjects();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.formError.set(this.msg(err));
      },
    });
  }

  private resetUpdateForm(): void {
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    this.updateForm.reset({
      occurredOn: ymd,
      body: '',
    });
  }

  protected saveUpdate(): void {
    const pid = this.selectedId();
    if (!pid || !this.condoAccess.canManage() || this.updateForm.invalid) {
      this.formError.set('Indique data e texto da atualização.');
      return;
    }
    this.formError.set(null);
    const raw = this.updateForm.getRawValue();
    const fileEl = this.updateFileInput()?.nativeElement;
    const files = fileEl?.files?.length
      ? Array.from(fileEl.files)
      : [];
    const upload$ =
      files.length > 0
        ? forkJoin(
            files.map((f) =>
              this.financialApi.uploadTransactionReceipt(this.condoId, f),
            ),
          )
        : of([] as { receiptStorageKey: string }[]);
    this.saving.set(true);
    upload$
      .pipe(
        switchMap((uploaded) => {
          const keys = uploaded.map((u) => u.receiptStorageKey).filter(Boolean);
          const editId = this.editingUpdateId();
          if (editId) {
            const cur = this.detail()?.updates?.find((x) => x.id === editId);
            const prev = cur ? this.attachmentKeys(cur) : [];
            const patch: Parameters<WorksApiService['updateUpdate']>[3] = {
              occurredOn: raw.occurredOn.slice(0, 10),
              body: raw.body.trim(),
            };
            if (keys.length > 0) {
              patch.attachmentStorageKeys = [...prev, ...keys];
            }
            return this.api.updateUpdate(this.condoId, pid, editId, patch);
          }
          return this.api.createUpdate(this.condoId, pid, {
            occurredOn: raw.occurredOn.slice(0, 10),
            body: raw.body.trim(),
            attachmentStorageKeys: keys.length ? keys : undefined,
          });
        }),
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editingUpdateId.set(null);
          this.resetUpdateForm();
          const el = this.updateFileInput()?.nativeElement;
          if (el) {
            el.value = '';
          }
          this.refreshDetail();
          this.reloadProjects();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.formError.set(this.msg(err));
        },
      });
  }

  protected onUpdateSubmit(ev: Event): void {
    ev.preventDefault();
    this.saveUpdate();
  }

  protected startEditUpdate(u: ConstructionProjectUpdate): void {
    if (!this.condoAccess.canManage()) {
      return;
    }
    this.editingUpdateId.set(u.id);
    this.updateForm.patchValue({
      occurredOn: u.occurredOn.slice(0, 10),
      body: u.body,
    });
  }

  protected cancelUpdateEdit(): void {
    this.editingUpdateId.set(null);
    this.resetUpdateForm();
  }

  protected deleteUpdate(u: ConstructionProjectUpdate): void {
    const pid = this.selectedId();
    if (!pid || !this.condoAccess.canManage()) {
      return;
    }
    if (!confirm('Remover esta atualização?')) {
      return;
    }
    this.saving.set(true);
    this.api.deleteUpdate(this.condoId, pid, u.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.refreshDetail();
        this.reloadProjects();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.formError.set(this.msg(err));
      },
    });
  }

  protected attachmentKeys(u: ConstructionProjectUpdate): string[] {
    if (Array.isArray(u.attachmentStorageKeys) && u.attachmentStorageKeys.length) {
      return u.attachmentStorageKeys;
    }
    return [];
  }

  protected downloadAttachment(key: string): void {
    this.financialApi
      .downloadTransactionReceipt(this.condoId, key)
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `obra-anexo-${key.slice(-20)}`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err: HttpErrorResponse) => {
          this.formError.set(this.msg(err));
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
