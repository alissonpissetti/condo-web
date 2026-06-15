import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { Observable } from 'rxjs';
import {
  translateHttpErrorMessage,
  translateHttpErrorMessageAsync,
} from '../../../core/api-errors-pt';
import { FlashMessageService } from '../../../core/flash-message.service';
import { CondominiumAccessStore } from '../../../core/condominium-access.store';
import {
  FinancialApiService,
  type CondominiumBankAccount,
  type CondominiumFeeCharge,
  type CondominiumFeeSlipDeliveryAction,
  type CondominiumFeeSlipDeliveryLogRow,
  type SendFeeSlipsWhatsappResult,
} from '../../../core/financial-api.service';
import { formatDateDdMmYyyy } from '../../../core/date-display';
import { formatCentsBrl } from '../../../core/money-brl';

@Component({
  selector: 'app-painel-taxas-condominiais',
  templateUrl: './painel-taxas-condominiais.component.html',
  styleUrl: './painel-taxas-condominiais.component.scss',
})
export class PainelTaxasCondominiaisComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly flash = inject(FlashMessageService);
  private readonly api = inject(FinancialApiService);
  protected readonly condoAccess = inject(CondominiumAccessStore);

  protected readonly formatCentsBrl = formatCentsBrl;
  protected readonly formatDateDdMmYyyy = formatDateDdMmYyyy;

  protected readonly charges = signal<CondominiumFeeCharge[]>([]);
  protected readonly competenceYm = signal('');
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly actionBusy = signal(false);
  /** Resumo do último envio de slips por WhatsApp (gestão). */
  protected readonly slipWaInfo = signal<string | null>(null);
  protected readonly slipWaBusy = signal(false);

  protected readonly slipDeliveryLog = signal<CondominiumFeeSlipDeliveryLogRow[]>(
    [],
  );
  protected readonly slipDeliveryLogLoading = signal(false);
  protected readonly slipDeliveryLogError = signal<string | null>(null);

  /** Quitação: cobrança alvo do modal, arquivo anexado (opcional) e estado. */
  protected readonly settleTarget = signal<CondominiumFeeCharge | null>(null);
  protected readonly bankAccounts = signal<CondominiumBankAccount[]>([]);
  protected readonly settleBankAccountId = signal('');
  protected readonly settleReceiptFile = signal<File | null>(null);
  protected readonly settleError = signal<string | null>(null);
  protected readonly settleBusy = signal(false);

  /** Cobrança paga: substituir o anexo enviado pelo cliente (novo upload). */
  protected readonly replaceReceiptTarget = signal<CondominiumFeeCharge | null>(
    null,
  );
  protected readonly replaceReceiptFile = signal<File | null>(null);
  protected readonly replaceReceiptError = signal<string | null>(null);
  protected readonly replaceReceiptBusy = signal(false);

  /** Edição de vencimento (uma ou mais cobranças): alvos, valor e estado. */
  protected readonly dueEditTargets = signal<CondominiumFeeCharge[]>([]);
  protected readonly dueEditValue = signal<string>('');
  protected readonly dueEditError = signal<string | null>(null);
  protected readonly dueEditBusy = signal(false);

  /** IDs das cobranças selecionadas no modo em massa. */
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  /** ID da cobrança com o menu de ações (kebab) aberto, ou `null` quando fechado. */
  protected readonly openActionMenuId = signal<string | null>(null);

  protected readonly selectedCount = computed(() => this.selectedIds().size);

  protected readonly activeBankAccounts = computed(() =>
    this.bankAccounts().filter((a) => a.isActive),
  );

  protected readonly settleBankAccount = computed(() => {
    const id = this.settleBankAccountId().trim();
    if (!id) {
      return null;
    }
    return this.bankAccounts().find((a) => a.id === id) ?? null;
  });

  protected readonly selectedOpenUnitCount = computed(() => {
    const ids = this.selectedIds();
    const u = new Set<string>();
    for (const c of this.charges()) {
      if (c.status === 'open' && ids.has(c.id)) {
        u.add(c.unitId);
      }
    }
    return u.size;
  });

  protected readonly allSelectableSelected = computed(() => {
    const selectable = this.charges();
    const sel = this.selectedIds();
    if (selectable.length === 0) {
      return false;
    }
    return selectable.every((c) => sel.has(c.id));
  });

  protected toggleSelectAll(): void {
    const all = this.charges();
    if (this.allSelectableSelected()) {
      this.selectedIds.set(new Set());
    } else {
      this.selectedIds.set(new Set(all.map((c) => c.id)));
    }
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  protected toggleSelected(id: string, evt?: Event): void {
    if (evt) {
      evt.stopPropagation();
    }
    const next = new Set(this.selectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedIds.set(next);
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected toggleActionMenu(charge: CondominiumFeeCharge, evt: Event): void {
    evt.stopPropagation();
    const current = this.openActionMenuId();
    this.openActionMenuId.set(current === charge.id ? null : charge.id);
  }

  protected closeActionMenu(): void {
    if (this.openActionMenuId() !== null) {
      this.openActionMenuId.set(null);
    }
  }

  @HostListener('document:click')
  protected onDocumentClick(): void {
    this.closeActionMenu();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.settleTarget()) {
      this.closeSettle();
    }
    if (this.replaceReceiptTarget()) {
      this.closeReplaceReceipt();
    }
    if (this.dueEditTargets().length > 0) {
      this.closeDueEdit();
    }
    this.closeActionMenu();
    this.slipWaInfo.set(null);
  }

  /** Agregados para o resumo visual (total, pago, em aberto, % quitado). */
  protected readonly summary = computed(() => {
    let totalCents = 0n;
    let paidCents = 0n;
    let openCents = 0n;
    let paidCount = 0;
    let openCount = 0;
    for (const c of this.charges()) {
      let v = 0n;
      try {
        v = BigInt(c.amountDueCents || '0');
      } catch {
        v = 0n;
      }
      totalCents += v;
      if (c.status === 'paid') {
        paidCents += v;
        paidCount += 1;
      } else {
        openCents += v;
        openCount += 1;
      }
    }
    const total = Number(totalCents);
    const paidPct = total > 0 ? (Number(paidCents) / total) * 100 : 0;
    return {
      total: totalCents.toString(),
      paid: paidCents.toString(),
      open: openCents.toString(),
      paidCount,
      openCount,
      totalCount: paidCount + openCount,
      paidPct,
      paidPctLabel: `${Math.round(paidPct)}%`,
    };
  });

  protected readonly totalChargesFormatted = computed(() =>
    formatCentsBrl(this.summary().total),
  );

  private condoId = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      (() => { this.loadError.set('Condomínio inválido.'); this.flash.error('Condomínio inválido.'); })();
      return;
    }
    this.condoId = id;
    // Carrega por padrão a competência do mês anterior ao atual, que é a
    // última fechada (as cobranças do mês corrente ainda estão em formação).
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    this.competenceYm.set(`${y}-${m}`);
    this.api.listBankAccounts(this.condoId).subscribe({
      next: (rows) => this.bankAccounts.set(rows),
      error: () => this.bankAccounts.set([]),
    });
    this.load();
  }

  setCompetenceYm(v: string): void {
    this.competenceYm.set(v);
  }

  load(): void {
    this.loadError.set(null);
    this.slipWaInfo.set(null);
    this.loading.set(true);
    this.api.listCondominiumFees(this.condoId, this.competenceYm()).subscribe({
      next: (rows) => {
        this.charges.set(rows);
        this.loading.set(false);
        this.loadSlipDeliveryLog();
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        (() => { const m = this.msg(err); this.loadError.set(m); this.flash.error(m); })();
      },
    });
  }

  protected formatDateTime(value: string): string {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
      return value;
    }
    return dt.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  }

  protected slipDeliveryActionLabel(
    action: CondominiumFeeSlipDeliveryAction,
  ): string {
    switch (action) {
      case 'pdf_transparency':
        return 'PDF transparência (condomínio)';
      case 'pdf_unit_slip':
        return 'PDF da unidade';
      case 'whatsapp_sent':
        return 'WhatsApp enviado';
      case 'whatsapp_skipped':
        return 'WhatsApp não enviado';
      case 'whatsapp_failed':
        return 'Falha no WhatsApp';
      default:
        return action;
    }
  }

  protected slipDeliveryDetailLabel(
    row: CondominiumFeeSlipDeliveryLogRow,
  ): string {
    const d = row.detail;
    if (!d) {
      return '—';
    }
    const reason = d['reason'];
    if (typeof reason === 'string' && reason.trim()) {
      return reason.trim();
    }
    const err = d['error'];
    if (typeof err === 'string' && err.trim()) {
      return err.trim();
    }
    const last4 = d['phoneLast4'];
    if (typeof last4 === 'string' && last4.trim()) {
      return `Celular ···${last4.trim()}`;
    }
    const storageKey = d['storageKey'];
    if (typeof storageKey === 'string' && storageKey.trim()) {
      return storageKey.trim();
    }
    return '—';
  }

  private loadSlipDeliveryLog(): void {
    if (!this.condoAccess.canManage()) {
      this.slipDeliveryLog.set([]);
      this.slipDeliveryLogError.set(null);
      return;
    }
    const ym = this.competenceYm().trim();
    if (!ym) {
      this.slipDeliveryLog.set([]);
      return;
    }
    this.slipDeliveryLogLoading.set(true);
    this.slipDeliveryLogError.set(null);
    this.api.listCondominiumFeeSlipDeliveryLog(this.condoId, ym).subscribe({
      next: (rows) => {
        this.slipDeliveryLog.set(rows);
        this.slipDeliveryLogLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.slipDeliveryLogLoading.set(false);
        this.slipDeliveryLogError.set(this.msg(err));
      },
    });
  }

  closeMonth(): void {
    if (
      !confirm(
        'Executar fechamento desta competência? Serão gerados lançamentos de fundos (se ainda não existirem) e atualizadas as cobranças.',
      )
    ) {
      return;
    }
    this.runAction(
      this.api.closeCondominiumFeeMonth(this.condoId, this.competenceYm()),
    );
  }

  regenerateMonth(): void {
    if (
      !confirm(
        'Regenerar cobranças deste mês? Apaga cobranças em aberto e mensalidades de fundo ainda aguardando quitação; recalcula tudo. Mensalidades de fundo já quitadas não são apagadas. Não use se existir cobrança de unidade já paga.',
      )
    ) {
      return;
    }
    this.runAction(
      this.api.regenerateCondominiumFeeMonth(
        this.condoId,
        this.competenceYm(),
      ),
    );
  }

  private runAction(req: Observable<CondominiumFeeCharge[]>): void {
    this.actionBusy.set(true);
    req.subscribe({
      next: (rows) => {
        this.charges.set(rows);
        this.actionBusy.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  /** Abre o modal de quitação para anexar opcionalmente um comprovante. */
  openSettle(c: CondominiumFeeCharge): void {
    this.settleError.set(null);
    this.settleReceiptFile.set(null);
    const primary = this.activeBankAccounts()[0]?.id ?? '';
    this.settleBankAccountId.set(primary);
    this.settleTarget.set(c);
  }

  /** Abre o modal de edição de vencimento para uma cobrança. */
  openDueEdit(c: CondominiumFeeCharge): void {
    this.dueEditError.set(null);
    // Converte para AAAA-MM-DD pro input[type=date].
    this.dueEditValue.set((c.dueOn ?? '').slice(0, 10));
    this.dueEditTargets.set([c]);
  }

  /** Abre o modal de edição de vencimento para as cobranças selecionadas. */
  openDueEditForSelected(): void {
    const ids = this.selectedIds();
    if (ids.size === 0) {
      return;
    }
    const selected = this.charges().filter((c) => ids.has(c.id));
    if (selected.length === 0) {
      return;
    }
    this.dueEditError.set(null);
    // Se todas as cobranças compartilham o mesmo vencimento, pré-preenche; senão deixa vazio.
    const firstDue = selected[0].dueOn?.slice(0, 10) ?? '';
    const sameDue = selected.every((c) => (c.dueOn?.slice(0, 10) ?? '') === firstDue);
    this.dueEditValue.set(sameDue ? firstDue : '');
    this.dueEditTargets.set(selected);
  }

  closeDueEdit(): void {
    if (this.dueEditBusy()) {
      return;
    }
    this.dueEditTargets.set([]);
    this.dueEditValue.set('');
    this.dueEditError.set(null);
  }

  onDueEditValueChange(v: string): void {
    this.dueEditValue.set(v);
    if (this.dueEditError()) {
      this.dueEditError.set(null);
    }
  }

  confirmDueEdit(): void {
    const targets = this.dueEditTargets();
    if (targets.length === 0) {
      return;
    }
    const due = (this.dueEditValue() ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      this.dueEditError.set('Informe uma data válida (AAAA-MM-DD).');
      return;
    }

    this.dueEditBusy.set(true);
    this.dueEditError.set(null);
    this.api
      .updateCondominiumFeeDueDate(
        this.condoId,
        targets.map((c) => c.id),
        due,
      )
      .subscribe({
        next: (updated) => {
          // Merge do retorno com a lista atual, preservando a ordem.
          const byId = new Map(updated.map((c) => [c.id, c]));
          this.charges.update((rows) =>
            rows.map((r) => byId.get(r.id) ?? r),
          );
          // Limpa seleção quando era em massa (>1 cobrança).
          if (targets.length > 1) {
            this.selectedIds.set(new Set());
          }
          this.dueEditBusy.set(false);
          this.dueEditTargets.set([]);
          this.dueEditValue.set('');
        },
        error: (err: HttpErrorResponse) => {
          this.dueEditBusy.set(false);
          this.dueEditError.set(this.msg(err));
        },
      });
  }

  closeSettle(): void {
    if (this.settleBusy()) {
      return;
    }
    this.settleTarget.set(null);
    this.settleReceiptFile.set(null);
    this.settleError.set(null);
  }

  onSettleFileChange(evt: Event): void {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) {
      this.settleReceiptFile.set(null);
      return;
    }
    const allowed = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'application/pdf',
    ];
    if (!allowed.includes(file.type)) {
      this.settleError.set(
        'Formato não suportado. Envie uma imagem (PNG, JPG, WEBP) ou PDF.',
      );
      input.value = '';
      this.settleReceiptFile.set(null);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.settleError.set('O arquivo ultrapassa o limite de 8 MB.');
      input.value = '';
      this.settleReceiptFile.set(null);
      return;
    }
    this.settleError.set(null);
    this.settleReceiptFile.set(file);
  }

  clearSettleFile(): void {
    this.settleReceiptFile.set(null);
  }

  openReplaceReceipt(c: CondominiumFeeCharge): void {
    this.replaceReceiptError.set(null);
    this.replaceReceiptFile.set(null);
    this.replaceReceiptTarget.set(c);
  }

  closeReplaceReceipt(): void {
    if (this.replaceReceiptBusy()) {
      return;
    }
    this.replaceReceiptTarget.set(null);
    this.replaceReceiptFile.set(null);
    this.replaceReceiptError.set(null);
  }

  onReplaceReceiptFileChange(evt: Event): void {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) {
      this.replaceReceiptFile.set(null);
      return;
    }
    const allowed = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'application/pdf',
    ];
    if (!allowed.includes(file.type)) {
      this.replaceReceiptError.set(
        'Formato não suportado. Envie uma imagem (PNG, JPG, WEBP) ou PDF.',
      );
      input.value = '';
      this.replaceReceiptFile.set(null);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.replaceReceiptError.set('O arquivo ultrapassa o limite de 8 MB.');
      input.value = '';
      this.replaceReceiptFile.set(null);
      return;
    }
    this.replaceReceiptError.set(null);
    this.replaceReceiptFile.set(file);
  }

  clearReplaceReceiptFile(): void {
    this.replaceReceiptFile.set(null);
  }

  confirmReplaceReceipt(): void {
    const target = this.replaceReceiptTarget();
    const file = this.replaceReceiptFile();
    if (!target || !file) {
      if (target && !file) {
        this.replaceReceiptError.set('Selecione o novo comprovante (imagem ou PDF).');
      }
      return;
    }
    this.replaceReceiptError.set(null);
    this.replaceReceiptBusy.set(true);
    this.api.uploadTransactionReceipt(this.condoId, file).subscribe({
      next: ({ receiptStorageKey }) => {
        this.api
          .replaceCondominiumFeePaymentReceipt(this.condoId, target.id, {
            paymentReceiptStorageKey: receiptStorageKey,
          })
          .subscribe({
            next: (updated) => {
              this.charges.update((list) =>
                list.map((x) => (x.id === updated.id ? updated : x)),
              );
              this.replaceReceiptBusy.set(false);
              this.replaceReceiptTarget.set(null);
              this.replaceReceiptFile.set(null);
            },
            error: (err: HttpErrorResponse) => {
              this.replaceReceiptBusy.set(false);
              this.replaceReceiptError.set(this.msg(err));
            },
          });
      },
      error: (err: HttpErrorResponse) => {
        this.replaceReceiptBusy.set(false);
        this.replaceReceiptError.set(this.msg(err));
      },
    });
  }

  confirmSettle(): void {
    const target = this.settleTarget();
    if (!target) return;
    const bankAccountId = this.settleBankAccountId().trim();
    if (!bankAccountId) {
      this.settleError.set(
        'Selecione a conta bancária que recebeu o pagamento.',
      );
      return;
    }
    this.settleError.set(null);
    this.settleBusy.set(true);
    const file = this.settleReceiptFile();
    const run = (receiptKey: string | null) => {
      this.api
        .settleCondominiumFee(this.condoId, target.id, {
          paymentReceiptStorageKey: receiptKey ?? null,
          bankAccountId,
        })
        .subscribe({
          next: (updated) => {
            this.charges.update((list) =>
              list.map((x) => (x.id === updated.id ? updated : x)),
            );
            this.settleBusy.set(false);
            this.settleTarget.set(null);
            this.settleReceiptFile.set(null);
          },
          error: (err: HttpErrorResponse) => {
            this.settleBusy.set(false);
            this.settleError.set(this.msg(err));
          },
        });
    };
    if (file) {
      this.api.uploadTransactionReceipt(this.condoId, file).subscribe({
        next: ({ receiptStorageKey }) => run(receiptStorageKey),
        error: (err: HttpErrorResponse) => {
          this.settleBusy.set(false);
          this.settleError.set(this.msg(err));
        },
      });
    } else {
      run(null);
    }
  }

  /** Abre o comprovante anexado (imagem/PDF) em nova aba. */
  viewPaymentReceiptFile(c: CondominiumFeeCharge): void {
    this.actionBusy.set(true);
    this.api
      .condominiumFeePaymentReceiptFile(this.condoId, c.id)
      .subscribe({
        next: (blob) => {
          this.actionBusy.set(false);
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: (err: HttpErrorResponse) => {
          this.actionBusy.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  downloadTransparencyPdf(): void {
    const ym = this.competenceYm().trim();
    if (!ym) {
      this.flash.warning('Indique a competência.');
      return;
    }
    this.actionBusy.set(true);
    this.api.condominiumFeesTransparencyPdf(this.condoId, ym).subscribe({
      next: (blob) => {
        this.actionBusy.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transparencia-condominial-${ym}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        this.loadSlipDeliveryLog();
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        void translateHttpErrorMessageAsync(err, {
          network:
            'Sem conexão com o servidor. Verifique a internet e tente novamente.',
          default: 'Não foi possível gerar o PDF de transparência.',
        }).then((m) => this.flash.error(m));
      },
    });
  }

  /**
   * PDF da unidade: capa slip PIX (quando houver taxa em aberto); folha de
   * administração e agrupamentos; extrato financeiro do período; extrato de
   * despesas e taxa por agrupamento (unidade só em bloco próprio se valor diferente).
   */
  downloadUnitSlipPdf(c: CondominiumFeeCharge): void {
    const ym = this.competenceYm().trim();
    if (!ym) {
      this.flash.warning('Indique a competência.');
      return;
    }
    this.actionBusy.set(true);
    this.api
      .condominiumFeesTransparencyPdf(this.condoId, ym, c.unitId)
      .subscribe({
        next: (blob) => {
          this.actionBusy.set(false);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const unitTag = (c.unitIdentifier || c.unitId.slice(0, 8))
            .replace(/[^\w-]+/g, '_')
            .slice(0, 24);
          a.download = `taxa-${ym}-${unitTag}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          this.loadSlipDeliveryLog();
        },
        error: (err: HttpErrorResponse) => {
          this.actionBusy.set(false);
          void translateHttpErrorMessageAsync(err, {
            network:
              'Sem conexão com o servidor. Verifique a internet e tente novamente.',
            default: 'Não foi possível gerar o PDF da unidade.',
          }).then((m) => this.flash.error(m));
        },
      });
  }

  downloadReceipt(c: CondominiumFeeCharge): void {
    this.actionBusy.set(true);
    this.api.condominiumFeePaymentReceiptPdf(this.condoId, c.id).subscribe({
      next: (blob) => {
        this.actionBusy.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comprovante-taxa-${c.id.slice(0, 8)}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err: HttpErrorResponse) => {
        this.actionBusy.set(false);
        void translateHttpErrorMessageAsync(err, {
          network:
            'Sem conexão com o servidor. Verifique a internet e tente novamente.',
          default: 'Não foi possível baixar o comprovante.',
        }).then((m) => this.flash.error(m));
      },
    });
  }

  sendSlipsWhatsappAllOpen(): void {
    if (!this.condoAccess.canManage()) {
      return;
    }
    const open = this.charges().filter((c) => c.status === 'open');
    const n = new Set(open.map((c) => c.unitId)).size;
    if (n === 0) {
      this.flash.warning('Não há cobranças em aberto nesta competência.');
      return;
    }
    if (
      !confirm(
        `Enviar o PDF slip (PIX + relatório) por WhatsApp para as ${n} unidade(s) em aberto? Usa o celular do responsável financeiro, proprietário, responsáveis ou o WhatsApp de referência na unidade.`,
      )
    ) {
      return;
    }
    this.runSendSlipsWhatsapp(undefined);
  }

  sendSlipsWhatsappSelectedOpen(): void {
    if (!this.condoAccess.canManage()) {
      return;
    }
    const openSelected = this.charges().filter(
      (c) => c.status === 'open' && this.selectedIds().has(c.id),
    );
    const unitIds = [...new Set(openSelected.map((c) => c.unitId))];
    if (unitIds.length === 0) {
      this.flash.warning(
        'Selecione cobranças em aberto ou use «WhatsApp slips (todas em aberto)».',
      );
      return;
    }
    if (
      !confirm(
        `Enviar slip por WhatsApp para ${unitIds.length} unidade(s) das linhas selecionadas?`,
      )
    ) {
      return;
    }
    this.runSendSlipsWhatsapp(unitIds);
  }

  sendSlipsWhatsappOne(c: CondominiumFeeCharge): void {
    if (!this.condoAccess.canManage()) {
      return;
    }
    if (c.status !== 'open') {
      this.flash.warning(
        'Só é possível enviar slip por WhatsApp para cobranças em aberto.',
      );
      return;
    }
    if (
      !confirm(
        `Enviar o PDF slip por WhatsApp para a unidade «${c.unitIdentifier}»?`,
      )
    ) {
      return;
    }
    this.runSendSlipsWhatsapp([c.unitId]);
  }

  dismissSlipWaInfo(): void {
    this.slipWaInfo.set(null);
  }

  private formatSlipWaResult(r: SendFeeSlipsWhatsappResult): string {
    const parts: string[] = [`Enviados: ${r.sent}.`];
    if (r.skipped.length > 0) {
      parts.push(
        ` Sem número (${r.skipped.length}): ${r.skipped.map((s) => s.unitIdentifier).join(', ')}.`,
      );
    }
    if (r.failures.length > 0) {
      parts.push(
        ` Falha (${r.failures.length}): ${r.failures.map((f) => f.unitIdentifier).join(', ')}.`,
      );
    }
    return parts.join('');
  }

  private runSendSlipsWhatsapp(unitIds: string[] | undefined): void {
    const ym = this.competenceYm().trim();
    if (!ym) {
      this.flash.warning('Indique a competência.');
      return;
    }
    this.slipWaBusy.set(true);
    this.slipWaInfo.set(null);
    this.api
      .sendCondominiumFeeSlipsWhatsapp(this.condoId, {
        competenceYm: ym,
        unitIds,
      })
      .subscribe({
        next: (r) => {
          this.slipWaBusy.set(false);
          this.slipWaInfo.set(this.formatSlipWaResult(r));
          this.loadSlipDeliveryLog();
          if (unitIds?.length) {
            this.clearSelection();
          }
        },
        error: (err: HttpErrorResponse) => {
          this.slipWaBusy.set(false);
          void translateHttpErrorMessageAsync(err, {
            network:
              'Sem conexão com o servidor. Verifique a internet e tente novamente.',
            default: 'Não foi possível enviar os slips por WhatsApp.',
          }).then((m) => this.flash.error(m));
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
