import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  formatBrPhoneDisplay,
  optionalBrMobilePhoneValidator,
  toNationalPhoneDigits,
} from '../../../core/br-phone-mask';
import { BrPhoneMaskDirective } from '../../../core/br-phone-mask.directive';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
  type UnitPersonRef,
  type UnitRow,
} from '../../../core/condominium-management.service';
import { CondominiumNavDataService } from '../../../core/condominium-nav-data.service';
import { controlErrorMessagesPt } from '../../../core/form-errors-pt';
import { condoAccessAllowsManagement } from '../../../core/condo-access.util';
import {
  PlanningApiService,
  type CondoAccess,
} from '../../../core/planning-api.service';

@Component({
  selector: 'app-painel-unidades',
  imports: [ReactiveFormsModule, BrPhoneMaskDirective],
  templateUrl: './painel-unidades.component.html',
  styleUrl: './painel-unidades.component.scss',
})
export class PainelUnidadesComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CondominiumManagementService);
  private readonly navData = inject(CondominiumNavDataService);
  private readonly planningApi = inject(PlanningApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  protected readonly rows = signal<GroupingWithUnits[]>([]);
  protected readonly access = signal<CondoAccess | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly newGroupingName = signal('');
  protected readonly editingGroupingId = signal<string | null>(null);
  protected readonly groupingNameDraft = signal('');

  protected readonly editingUnitId = signal<string | null>(null);
  protected readonly unitDraft = signal<{
    identifier: string;
    notes: string;
  }>({ identifier: '', notes: '' });

  protected readonly newUnitDraft = signal<
    Record<string, { identifier: string; notes: string }>
  >({});

  protected readonly phoneEditContext = signal<{
    groupingId: string;
    unitId: string;
    personId: string;
  } | null>(null);

  protected readonly phoneEditForm = this.fb.nonNullable.group({
    phone: ['', [optionalBrMobilePhoneValidator]],
  });

  protected readonly pendingWaEditUnitId = signal<string | null>(null);
  protected readonly unitPendingWaForm = this.fb.nonNullable.group({
    phone: ['', [optionalBrMobilePhoneValidator]],
  });

  private condominiumId = '';
  private fragmentSub?: Subscription;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.reload();
    this.fragmentSub = this.route.fragment.subscribe((f) => {
      if (!f) return;
      requestAnimationFrame(() => {
        document.getElementById(`unit-${f}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  }

  ngOnDestroy(): void {
    this.fragmentSub?.unsubscribe();
  }

  reload(): void {
    this.loadError.set(null);
    this.loading.set(true);
    forkJoin({
      rows: this.api.loadGroupingsWithUnits(this.condominiumId),
      access: this.planningApi.access(this.condominiumId),
    }).subscribe({
      next: ({ rows, access }) => {
        this.rows.set(rows);
        this.access.set(access.access);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.messageFromHttp(err));
      },
    });
  }

  /** Titular ou síndico: alinhado à API de atualização de telefone. */
  protected canEditResidentPhones(): boolean {
    const a = this.access();
    if (!a) {
      return false;
    }
    if (a.kind === 'owner') {
      return true;
    }
    return a.kind === 'participant' && a.role === 'syndic';
  }

  /** Titular, síndico, subsíndico ou administrador: estrutura e vínculos de unidades. */
  protected canManageCondominium(): boolean {
    const a = this.access();
    return a !== null && condoAccessAllowsManagement(a);
  }

  protected displayPersonPhone(phone: string | null | undefined): string {
    const d = toNationalPhoneDigits(phone ?? '');
    return d ? formatBrPhoneDisplay(d) : '';
  }

  protected hasDisplayPhone(phone: string | null | undefined): boolean {
    return toNationalPhoneDigits(phone ?? '').length > 0;
  }

  protected isEditingPhone(
    groupingId: string,
    unitId: string,
    personId: string,
  ): boolean {
    const c = this.phoneEditContext();
    return !!(
      c &&
      c.groupingId === groupingId &&
      c.unitId === unitId &&
      c.personId === personId
    );
  }

  protected startEditResidentPhone(
    groupingId: string,
    u: UnitRow,
    person: UnitPersonRef,
  ): void {
    if (!this.canEditResidentPhones()) {
      return;
    }
    this.clearActionError();
    this.phoneEditContext.set({
      groupingId,
      unitId: u.id,
      personId: person.id,
    });
    const digits = toNationalPhoneDigits(person.phone ?? '');
    this.phoneEditForm.reset({ phone: digits });
  }

  protected cancelPhoneEdit(): void {
    this.phoneEditContext.set(null);
    this.phoneEditForm.reset({ phone: '' });
  }

  protected saveResidentPhone(
    groupingId: string,
    unitId: string,
    personId: string,
  ): void {
    if (!this.canEditResidentPhones()) {
      return;
    }
    this.phoneEditForm.markAllAsTouched();
    if (this.phoneEditForm.invalid) {
      return;
    }
    const raw = (this.phoneEditForm.getRawValue().phone ?? '').replace(
      /\D/g,
      '',
    );
    this.clearActionError();
    this.busy.set(true);
    this.api
      .patchUnitPersonPhone(this.condominiumId, groupingId, unitId, personId, {
        phone: raw,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.cancelPhoneEdit();
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  setNewGroupingName(v: string): void {
    this.newGroupingName.set(v);
  }

  createGrouping(): void {
    if (!this.canManageCondominium()) return;
    const name = this.newGroupingName().trim();
    if (!name) return;
    this.clearActionError();
    this.busy.set(true);
    this.api.createGrouping(this.condominiumId, { name }).subscribe({
      next: () => {
        this.newGroupingName.set('');
        this.busy.set(false);
        this.reload();
        this.navData.refresh(this.condominiumId, { force: true });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.messageFromHttp(err));
      },
    });
  }

  startEditGrouping(g: GroupingWithUnits): void {
    if (!this.canManageCondominium()) return;
    this.editingGroupingId.set(g.id);
    this.groupingNameDraft.set(g.name);
  }

  cancelEditGrouping(): void {
    this.editingGroupingId.set(null);
  }

  onGroupingNameInput(ev: Event): void {
    this.groupingNameDraft.set((ev.target as HTMLInputElement).value);
  }

  patchUnitDraft(
    patch: Partial<{ identifier: string; notes: string }>,
  ): void {
    this.unitDraft.update((d) => ({ ...d, ...patch }));
  }

  saveGroupingName(groupingId: string): void {
    if (!this.canManageCondominium()) return;
    const name = this.groupingNameDraft().trim();
    if (!name) return;
    this.clearActionError();
    this.busy.set(true);
    this.api
      .updateGrouping(this.condominiumId, groupingId, { name })
      .subscribe({
        next: () => {
          this.editingGroupingId.set(null);
          this.busy.set(false);
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  deleteGrouping(g: GroupingWithUnits): void {
    if (!this.canManageCondominium()) return;
    if (this.rows().length <= 1) return;
    const ok = confirm(
      `Excluir o agrupamento «${g.name}» e todas as suas unidades?`,
    );
    if (!ok) return;
    this.clearActionError();
    this.busy.set(true);
    this.api.deleteGrouping(this.condominiumId, g.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
        this.navData.refresh(this.condominiumId, { force: true });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.messageFromHttp(err));
      },
    });
  }

  newUnitFor(groupingId: string): { identifier: string; notes: string } {
    const map = this.newUnitDraft();
    return map[groupingId] ?? { identifier: '', notes: '' };
  }

  patchNewUnit(
    groupingId: string,
    patch: Partial<{ identifier: string; notes: string }>,
  ): void {
    const map = { ...this.newUnitDraft() };
    const cur = map[groupingId] ?? { identifier: '', notes: '' };
    map[groupingId] = { ...cur, ...patch };
    this.newUnitDraft.set(map);
  }

  createUnit(groupingId: string): void {
    if (!this.canManageCondominium()) return;
    const d = this.newUnitFor(groupingId);
    const identifier = d.identifier.trim();
    if (!identifier) return;
    this.clearActionError();
    this.busy.set(true);
    const notes = d.notes.trim() || null;
    this.api
      .createUnit(this.condominiumId, groupingId, {
        identifier,
        notes,
      })
      .subscribe({
        next: () => {
          const map = { ...this.newUnitDraft() };
          delete map[groupingId];
          this.newUnitDraft.set(map);
          this.busy.set(false);
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  startEditUnit(u: UnitRow): void {
    if (!this.canManageCondominium()) return;
    this.editingUnitId.set(u.id);
    this.unitDraft.set({
      identifier: u.identifier,
      notes: u.notes ?? '',
    });
  }

  cancelEditUnit(): void {
    this.editingUnitId.set(null);
  }

  saveUnit(groupingId: string, unitId: string): void {
    if (!this.canManageCondominium()) return;
    const d = this.unitDraft();
    const identifier = d.identifier.trim();
    if (!identifier) return;
    this.clearActionError();
    this.busy.set(true);
    this.api
      .updateUnit(this.condominiumId, groupingId, unitId, {
        identifier,
        notes: d.notes.trim() || null,
      })
      .subscribe({
        next: () => {
          this.editingUnitId.set(null);
          this.busy.set(false);
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  deleteUnit(groupingId: string, u: UnitRow): void {
    if (!this.canManageCondominium()) return;
    const ok = confirm(`Excluir a unidade «${u.identifier}»?`);
    if (!ok) return;
    this.clearActionError();
    this.busy.set(true);
    this.api.deleteUnit(this.condominiumId, groupingId, u.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
        this.navData.refresh(this.condominiumId, { force: true });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.messageFromHttp(err));
      },
    });
  }

  /** Proprietário ou responsável com ficha na base. */
  protected unitHasLinkedPerson(u: UnitRow): boolean {
    return !!(
      u.ownerPerson?.id ||
      (u.responsiblePeople?.length ?? 0) > 0 ||
      u.responsiblePerson?.id
    );
  }

  protected isEditingUnitPendingWa(unitId: string): boolean {
    return this.pendingWaEditUnitId() === unitId;
  }

  protected startEditUnitPendingWa(u: UnitRow): void {
    if (!this.canManageCondominium()) return;
    this.clearActionError();
    this.pendingWaEditUnitId.set(u.id);
    const digits = toNationalPhoneDigits(u.pendingWhatsappPhone ?? '');
    this.unitPendingWaForm.reset({ phone: digits });
  }

  protected cancelUnitPendingWa(): void {
    this.pendingWaEditUnitId.set(null);
    this.unitPendingWaForm.reset({ phone: '' });
  }

  protected saveUnitPendingWhatsapp(groupingId: string, unitId: string): void {
    if (!this.canManageCondominium()) return;
    this.unitPendingWaForm.markAllAsTouched();
    if (this.unitPendingWaForm.invalid) return;
    const raw = (this.unitPendingWaForm.getRawValue().phone ?? '').replace(
      /\D/g,
      '',
    );
    this.clearActionError();
    this.busy.set(true);
    this.api
      .updateUnit(this.condominiumId, groupingId, unitId, {
        pendingWhatsappPhone: raw.length ? raw : null,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.cancelUnitPendingWa();
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  protected clearUnitPendingWhatsapp(groupingId: string, u: UnitRow): void {
    if (!this.canManageCondominium() || !u.pendingWhatsappPhone) return;
    this.clearActionError();
    this.busy.set(true);
    this.api
      .updateUnit(this.condominiumId, groupingId, u.id, {
        pendingWhatsappPhone: null,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.cancelUnitPendingWa();
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  protected hasResponsibleEntries(u: UnitRow): boolean {
    return (
      (u.responsiblePeople?.length ?? 0) > 0 ||
      !!u.responsiblePersonId ||
      !!(u.responsibleDisplayName?.trim())
    );
  }

  /**
   * Faixa «remover tudo» só quando há mais de uma pessoa ou combinação pessoa + nome livre
   * (um único responsável usa só o ícone da linha; nome livre só tem ícone na própria linha).
   */
  protected showClearAllResponsibles(u: UnitRow): boolean {
    const n = u.responsiblePeople?.length ?? 0;
    if (n > 1) {
      return true;
    }
    if (n >= 1 && u.responsibleDisplayName?.trim()) {
      return true;
    }
    if (!!u.responsiblePerson?.id && u.responsibleDisplayName?.trim()) {
      return true;
    }
    return false;
  }

  /** Quantidade de responsáveis com ficha (para escolher o principal em taxas). */
  protected responsibleWithProfileCount(u: UnitRow): number {
    return u.responsiblePeople?.length ?? 0;
  }

  /** Com dois ou mais responsáveis identificados, é preciso designar qual nome usar em taxas. */
  protected needsFinancialPrincipalPicker(u: UnitRow): boolean {
    return this.responsibleWithProfileCount(u) >= 2;
  }

  protected onFinancialPrincipalChange(
    groupingId: string,
    u: UnitRow,
    evt: Event,
  ): void {
    if (!this.canManageCondominium()) {
      return;
    }
    const raw = (evt.target as HTMLSelectElement).value.trim();
    const nextId = raw.length ? raw : null;
    const cur = u.financialResponsiblePersonId ?? null;
    if (nextId === cur) {
      return;
    }
    this.clearActionError();
    this.busy.set(true);
    this.api
      .updateUnit(this.condominiumId, groupingId, u.id, {
        financialResponsiblePersonId: nextId,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
          this.reload();
        },
      });
  }

  removeOneResponsible(
    groupingId: string,
    u: UnitRow,
    personId: string,
    personName: string,
  ): void {
    if (!this.canManageCondominium()) return;
    const ok = confirm(
      `Remover «${personName}» da lista de responsáveis da unidade «${u.identifier}»?`,
    );
    if (!ok) return;
    this.clearActionError();
    this.busy.set(true);
    this.api
      .removeOneUnitResponsible(
        this.condominiumId,
        groupingId,
        u.id,
        personId,
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  clearResponsible(groupingId: string, u: UnitRow): void {
    if (!this.canManageCondominium()) return;
    if (!this.hasResponsibleEntries(u)) return;
    const ok = confirm(
      `Confirma remover todos os responsáveis da unidade «${u.identifier}» (incluindo nome livre, se houver)? O proprietário, se existir, não é alterado.`,
    );
    if (!ok) return;
    this.clearActionError();
    this.busy.set(true);
    this.api
      .clearUnitResponsible(this.condominiumId, groupingId, u.id)
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.messageFromHttp(err));
        },
      });
  }

  isEditingUnit(id: string): boolean {
    return this.editingUnitId() === id;
  }

  canDeleteGrouping(): boolean {
    return this.rows().length > 1;
  }

  private clearActionError(): void {
    this.actionError.set(null);
  }

  private messageFromHttp(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
