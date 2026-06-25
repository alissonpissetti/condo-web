const PREFIX = 'condo.tx-create-draft.v1';

export type TxCreateDraftAllocKind =
  | 'all_units_equal'
  | 'unit_ids'
  | 'grouping_ids'
  | 'all_units_except'
  | 'none';

export type TxKind = 'expense' | 'income' | 'investment' | 'yield';

export type TxCreateDraft = {
  formExpanded?: boolean;
  txKind: TxKind;
  entryMode: 'single' | 'recurring' | 'transfer';
  transferFromBankAccountId: string;
  transferToBankAccountId: string;
  transferFromFundId: string;
  transferToFundId: string;
  recurringMode: 'by_installment' | 'by_total';
  recurringCount: number;
  recurringInstallmentReais: string;
  recurringTotalReais: string;
  amountReais: string;
  occurredOn: string;
  titleTx: string;
  descriptionTx: string;
  fundIdForm: string;
  bankAccountIdForm: string;
  supplierIdForm?: string;
  supplierNameForm?: string;
  supplierPixKeyTypeForm?: string;
  supplierPixKeyValueForm?: string;
  allocKind: TxCreateDraftAllocKind;
  selectedUnitIds: string[];
  selectedGroupingIds: string[];
  excludeUnitIds: string[];
};

export function txCreateDraftKey(condominiumId: string): string {
  return `${PREFIX}:${condominiumId}`;
}

export function readTxCreateDraft(key: string): TxCreateDraft | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as TxCreateDraft;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeTxCreateDraft(key: string, value: TxCreateDraft): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearTxCreateDraft(key: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Evita restaurar rascunho vazio (só estado por defeito). */
export function txCreateDraftHasContent(draft: TxCreateDraft): boolean {
  if (draft.formExpanded) {
    return true;
  }
  if (draft.titleTx.trim() || draft.descriptionTx.trim()) {
    return true;
  }
  if (draft.amountReais.trim()) {
    return true;
  }
  if (
    draft.recurringInstallmentReais.trim() ||
    draft.recurringTotalReais.trim()
  ) {
    return true;
  }
  if (draft.fundIdForm.trim() || draft.bankAccountIdForm.trim()) {
    return true;
  }
  if (
    (draft.supplierIdForm ?? '').trim() ||
    (draft.supplierNameForm ?? '').trim() ||
    (draft.supplierPixKeyTypeForm ?? '').trim() ||
    (draft.supplierPixKeyValueForm ?? '').trim()
  ) {
    return true;
  }
  if (draft.allocKind !== 'all_units_equal') {
    return true;
  }
  if (
    draft.selectedUnitIds.length > 0 ||
    draft.selectedGroupingIds.length > 0 ||
    draft.excludeUnitIds.length > 0
  ) {
    return true;
  }
  if (draft.entryMode === 'recurring' || draft.entryMode === 'transfer') {
    return true;
  }
  if (
    draft.transferFromBankAccountId.trim() ||
    draft.transferToBankAccountId.trim() ||
    draft.transferFromFundId.trim() ||
    draft.transferToFundId.trim()
  ) {
    return true;
  }
  if (draft.txKind !== 'expense') {
    return true;
  }
  return false;
}
