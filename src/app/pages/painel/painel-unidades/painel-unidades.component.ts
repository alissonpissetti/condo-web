import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import { FlashMessageService } from '../../../core/flash-message.service';
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
import {
  FinancialApiService,
} from '../../../core/financial-api.service';
import { translateHttpErrorMessageAsync } from '../../../core/api-errors-pt';

@Component({
  selector: 'app-painel-unidades',
  imports: [ReactiveFormsModule, FormsModule, BrPhoneMaskDirective],
  templateUrl: './painel-unidades.component.html',
  styleUrl: './painel-unidades.component.scss',
})
export class PainelUnidadesComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly api = inject(CondominiumManagementService);
  private readonly navData = inject(CondominiumNavDataService);
  private readonly planningApi = inject(PlanningApiService);
  private readonly financialApi = inject(FinancialApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  protected readonly rows = signal<GroupingWithUnits[]>([]);
  protected readonly access = signal<CondoAccess | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly pdfBusyUnitId = signal<string | null>(null);

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

  protected readonly unitContactEditId = signal<string | null>(null);
  protected readonly unitContactForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [optionalBrMobilePhoneValidator]],
  });

  private condominiumId = '';
  private fragmentSub?: Subscription;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      (() => { this.loadError.set('Condomínio inválido.'); this.flash.error('Condomínio inválido.'); })();
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

  reload(options?: { silent?: boolean }): void {
    this.loadError.set(null);
    if (!options?.silent) {
      this.loading.set(true);
    }
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
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
  }

  private findUnitRow(groupingId: string, unitId: string): UnitRow | null {
    const group = this.rows().find((g) => g.id === groupingId);
    return group?.units.find((u) => u.id === unitId) ?? null;
  }

  /** Atualiza uma unidade na árvore local sem recarregar a página inteira. */
  private patchUnitInRows(groupingId: string, updated: UnitRow): void {
    this.rows.update((groups) =>
      groups.map((g) => {
        if (g.id !== groupingId) {
          return g;
        }
        return {
          ...g,
          units: g.units.map((unit) => {
            if (unit.id !== updated.id) {
              return unit;
            }
            const merged = this.mergeUnitRow(unit, updated);
            return merged;
          }),
        };
      }),
    );
  }

  /** Comparação estável de UUIDs no `<select>` (evita mismatch de maiúsculas/minúsculas). */
  private normalizePersonId(id: string | null | undefined): string | null {
    if (id === undefined || id === null) {
      return null;
    }
    const t = String(id).trim();
    return t.length ? t.toLowerCase() : null;
  }

  private personIdsEqual(
    a: string | null | undefined,
    b: string | null | undefined,
  ): boolean {
    const na = this.normalizePersonId(a);
    const nb = this.normalizePersonId(b);
    if (na === null && nb === null) {
      return true;
    }
    return na !== null && na === nb;
  }

  private mergeUnitRow(previous: UnitRow, incoming: UnitRow): UnitRow {
    const responsiblePeople =
      incoming.responsiblePeople?.length
        ? incoming.responsiblePeople
        : previous.responsiblePeople;

    const financialResponsiblePersonId =
      this.resolveFinancialResponsiblePersonId(incoming, previous);

    const financialResponsiblePerson = this.resolveFinancialResponsiblePerson(
      financialResponsiblePersonId,
      responsiblePeople,
      incoming.financialResponsiblePerson,
      incoming.financialResponsibleName,
    );

    const financialResponsibleName =
      incoming.financialResponsibleName !== undefined
        ? incoming.financialResponsibleName
        : financialResponsiblePerson?.fullName ??
          previous.financialResponsibleName ??
          null;

    const { financialResponsiblePerson: _dropPerson, ...incomingRest } =
      incoming;

    return {
      ...previous,
      ...incomingRest,
      responsiblePeople,
      financialResponsiblePersonId,
      financialResponsiblePerson,
      financialResponsibleName,
    };
  }

  private resolveFinancialResponsiblePerson(
    personId: string | null,
    responsiblePeople: UnitPersonRef[] | undefined,
    fromApi: UnitPersonRef | null | undefined,
    displayName: string | null | undefined,
  ): UnitPersonRef | null {
    if (!personId) {
      return null;
    }
    const fromList = responsiblePeople?.find((p) =>
      this.personIdsEqual(p.id, personId),
    );
    if (fromList) {
      return fromList;
    }
    if (fromApi?.id && this.personIdsEqual(fromApi.id, personId)) {
      return fromApi;
    }
    const name = displayName?.trim();
    if (name) {
      return { id: personId, fullName: name };
    }
    return { id: personId, fullName: '—' };
  }

  /** Valor do `<select>` (responsável principal); `ngModel` exige string estável. */
  protected financialPrincipalSelectValue(u: UnitRow): string {
    const id = this.resolveFinancialResponsiblePersonId(u, u);
    return id ?? '';
  }

  /** Valor de cada `<option>` (mesma normalização do modelo). */
  protected financialPrincipalOptionValue(personId: string): string {
    return this.normalizePersonId(personId) ?? '';
  }

  /**
   * ID do responsável principal. Se `financialResponsiblePersonId` vier na resposta
   * (incluindo `null`), não usa relação antiga que ainda pode vir no JSON.
   */
  private resolveFinancialResponsiblePersonId(
    source: UnitRow,
    fallback: UnitRow,
  ): string | null {
    if (source.financialResponsiblePersonId !== undefined) {
      return this.normalizePersonId(source.financialResponsiblePersonId);
    }
    if (fallback.financialResponsiblePersonId !== undefined) {
      return this.normalizePersonId(fallback.financialResponsiblePersonId);
    }
    const fromRelation = this.normalizePersonId(
      source.financialResponsiblePerson?.id,
    );
    if (fromRelation) {
      return fromRelation;
    }
    return this.normalizePersonId(fallback.financialResponsiblePerson?.id);
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
          this.flash.success('Telefone atualizado.');
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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
    this.busy.set(true);
    this.api.createGrouping(this.condominiumId, { name }).subscribe({
      next: () => {
        this.newGroupingName.set('');
        this.busy.set(false);
        this.reload();
        this.navData.refresh(this.condominiumId, { force: true });
        this.flash.success('Agrupamento criado.');
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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
    this.busy.set(true);
    this.api.deleteGrouping(this.condominiumId, g.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
        this.navData.refresh(this.condominiumId, { force: true });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  deleteUnit(groupingId: string, u: UnitRow): void {
    if (!this.canManageCondominium()) return;
    const ok = confirm(`Excluir a unidade «${u.identifier}»?`);
    if (!ok) return;
    this.busy.set(true);
    this.api.deleteUnit(this.condominiumId, groupingId, u.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload();
        this.navData.refresh(this.condominiumId, { force: true });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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

  protected hasUnitContactReference(u: UnitRow): boolean {
    return !!(
      u.responsibleDisplayName?.trim() || u.pendingWhatsappPhone?.trim()
    );
  }

  protected isEditingUnitContact(unitId: string): boolean {
    return this.unitContactEditId() === unitId;
  }

  protected startEditUnitContact(u: UnitRow): void {
    if (!this.canManageCondominium()) return;
    this.unitContactEditId.set(u.id);
    this.unitContactForm.reset({
      name: u.responsibleDisplayName?.trim() ?? '',
      phone: toNationalPhoneDigits(u.pendingWhatsappPhone ?? ''),
    });
  }

  protected cancelUnitContact(): void {
    this.unitContactEditId.set(null);
    this.unitContactForm.reset({ name: '', phone: '' });
  }

  protected saveUnitContactReference(
    groupingId: string,
    unitId: string,
  ): void {
    if (!this.canManageCondominium()) return;
    this.unitContactForm.markAllAsTouched();
    if (this.unitContactForm.invalid) return;
    const { name, phone } = this.unitContactForm.getRawValue();
    const nameTrim = (name ?? '').trim();
    const raw = (phone ?? '').replace(/\D/g, '');
    this.busy.set(true);
    this.api
      .updateUnit(this.condominiumId, groupingId, unitId, {
        responsibleDisplayName: nameTrim.length ? nameTrim : null,
        pendingWhatsappPhone: raw.length ? raw : null,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.cancelUnitContact();
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  protected clearUnitContactReference(groupingId: string, u: UnitRow): void {
    if (!this.canManageCondominium() || !this.hasUnitContactReference(u)) {
      return;
    }
    const ok = confirm(
      `Remover o contato de referência da unidade «${u.identifier}»?`,
    );
    if (!ok) return;
    this.busy.set(true);
    this.api
      .updateUnit(this.condominiumId, groupingId, u.id, {
        responsibleDisplayName: null,
        pendingWhatsappPhone: null,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.cancelUnitContact();
          this.reload();
          this.navData.refresh(this.condominiumId, { force: true });
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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

  protected onFinancialPrincipalModelChange(
    groupingId: string,
    unitId: string,
    raw: string,
  ): void {
    if (!this.canManageCondominium()) {
      return;
    }
    const u = this.findUnitRow(groupingId, unitId);
    if (!u) {
      return;
    }
    const snapshot = { ...u };
    const nextId = this.normalizePersonId(raw);
    const cur = this.resolveFinancialResponsiblePersonId(u, u);
    if (this.personIdsEqual(nextId, cur)) {
      return;
    }
    const picked = nextId
      ? (u.responsiblePeople?.find((p) => this.personIdsEqual(p.id, nextId)) ??
        null)
      : null;
    const apiPersonId = picked?.id ?? nextId;
    this.patchUnitInRows(groupingId, {
      ...u,
      financialResponsiblePersonId: apiPersonId,
      financialResponsiblePerson: picked,
      financialResponsibleName: picked?.fullName ?? null,
    });
    this.busy.set(true);
    this.api
      .updateUnit(this.condominiumId, groupingId, unitId, {
        financialResponsiblePersonId: apiPersonId,
      })
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.patchUnitInRows(groupingId, {
            ...updated,
            financialResponsiblePersonId: apiPersonId,
          });
          this.navData.refresh(this.condominiumId, { force: true });
          this.flash.success('Responsável principal atualizado.');
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
          this.patchUnitInRows(groupingId, snapshot);
          this.reload({ silent: true });
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
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
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
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  downloadClearanceDeclaration(u: UnitRow): void {
    if (this.pdfBusyUnitId()) {
      return;
    }
    this.pdfBusyUnitId.set(u.id);
    this.financialApi
      .condominiumClearanceDeclarationPdf(this.condominiumId, u.id)
      .subscribe({
        next: (blob) => {
          this.pdfBusyUnitId.set(null);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const unitTag = (u.identifier || u.id.slice(0, 8))
            .replace(/[^\w-]+/g, '_')
            .slice(0, 24);
          a.download = `declaracao-quitacao-${unitTag}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err: HttpErrorResponse) => {
          this.pdfBusyUnitId.set(null);
          void translateHttpErrorMessageAsync(err, {
            network:
              'Sem conexão com o servidor. Verifique a internet e tente novamente.',
            default: 'Não foi possível gerar a declaração de quitação.',
          }).then((m) => this.flash.error(m));
        },
      });
  }

  isClearancePdfBusy(unitId: string): boolean {
    return this.pdfBusyUnitId() === unitId;
  }

  isEditingUnit(id: string): boolean {
    return this.editingUnitId() === id;
  }

  canDeleteGrouping(): boolean {
    return this.rows().length > 1;
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
